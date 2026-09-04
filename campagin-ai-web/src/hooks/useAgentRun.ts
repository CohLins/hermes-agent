import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSession,
  getMessages,
  getRun,
  openRunEvents,
  respondApproval,
  startRun,
  stopRun,
} from "@/api/agent";
import { readPendingRun } from "@/api/pendingRuns";
import { useSession } from "@/contexts/useSession";
import { isTerminalRunStatus } from "@/types/agent";
import type { HistoryEntry } from "@/api/agent";
import type { AgentMessage, RunEvent, Turn } from "@/types/agent";

/** 待审批弹窗的数据，来自 approval.request 事件。 */
export interface PendingApproval {
  runId: string;
  command: string;
  description: string;
  choices: string[];
}

const POLL_INTERVAL = 2000;

/** tool 消息的 content 是 {"output":...,"exit_code":...} 这样的 JSON，取 output 当预览。 */
function toolPreview(content: string): string {
  try {
    const parsed = JSON.parse(content) as { output?: unknown };
    if (typeof parsed.output === "string") return parsed.output;
  } catch {
    // 不是 JSON 就原样显示。
  }
  return content;
}

/**
 * 把 /messages 的平铺消息还原成一问一答。
 *
 * 三类消息都要用上：
 *   user       → 新起一轮
 *   assistant  → content 是回答（发起工具调用的那条 content 为空）；
 *                reasoning / reasoning_content 是**真正的**思考，只有落库才有
 *                （SSE 的 reasoning.available 拿不到，见 dropEchoedReasoning）
 *   tool       → 还原成一条已完成的工具行（实时流里有耗时，历史里没有）
 */
function messagesToTurns(messages: AgentMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const msg of messages) {
    const content = (msg.content ?? "").trim();
    if (msg.role === "user") {
      if (!content) continue;
      turns.push({
        id: `history-${turns.length}`,
        question: content,
        answer: "",
        reasoning: [],
        tools: [],
        phase: "completed",
        // DB 里的 timestamp 是 unix 秒。
        startedAt: msg.timestamp ? msg.timestamp * 1000 : Date.now(),
        lastEventAt: msg.timestamp ? msg.timestamp * 1000 : Date.now(),
      });
      continue;
    }

    const current = turns[turns.length - 1];
    if (!current) continue;

    if (msg.role === "tool") {
      current.tools.push({
        id: `history-tool-${current.tools.length}`,
        tool: msg.tool_name ?? "未知工具",
        preview: content ? toolPreview(content) : null,
        done: true,
      });
      continue;
    }
    if (msg.role !== "assistant") continue;

    const thinking = (msg.reasoning ?? msg.reasoning_content ?? "").trim();
    if (thinking) current.reasoning.push(thinking);
    if (content) current.answer = current.answer ? `${current.answer}\n\n${content}` : content;
  }
  return turns;
}

/** /v1/runs 不读 session 历史，必须把已有轮次显式带上，否则 agent 每轮失忆。 */
function buildHistory(turns: Turn[]): HistoryEntry[] {
  const history: HistoryEntry[] = [];
  for (const turn of turns) {
    if (!turn.question.trim()) continue;
    history.push({ role: "user", content: turn.question });
    if (turn.answer.trim()) history.push({ role: "assistant", content: turn.answer });
  }
  return history;
}

/**
 * 去掉与最终答案重复的那条「思考」。
 *
 * reasoning.available 并不是 reasoning token：agent/conversation_loop.py:4655
 * 把每轮 assistant_message.content 截断 500 字当作它发出来。所以最后一轮必然
 * 是最终答案的副本（无工具调用时就只剩这一条，等于把答案说两遍）。
 * 中间轮的内容才是有价值的过程输出，保留。
 */
function dropEchoedReasoning(reasoning: string[], answer: string): string[] {
  const final = answer.trim();
  if (!final) return reasoning;
  return reasoning.filter((text) => {
    const t = text.trim();
    if (!t) return false;
    // 服务端截到 500 字，所以是「答案以它开头」而不是全等。
    return !final.startsWith(t);
  });
}

function patchTurn(turns: Turn[], turnId: string, patch: (turn: Turn) => Turn): Turn[] {
  return turns.map((turn) => (turn.id === turnId ? patch(turn) : turn));
}

/** tool.started / tool.completed 只带工具名，按「最后一条同名未完成」配对。 */
function completeTool(tools: Turn["tools"], tool: string, duration?: number, failed?: boolean) {
  const index = tools.map((x) => x.tool === tool && !x.done).lastIndexOf(true);
  if (index < 0) {
    return [...tools, { id: `${tool}-${tools.length}`, tool, duration, failed, done: true }];
  }
  const next = [...tools];
  next[index] = { ...next[index], duration, failed, done: true };
  return next;
}

export interface AgentRunState {
  turns: Turn[];
  /** 当前有 run 在跑（含等待审批）。 */
  busy: boolean;
  /** 正在加载某个历史会话的消息。 */
  historyLoading: boolean;
  historyError: string | undefined;
  approval: PendingApproval | null;
  send: (question: string, model?: string | null) => Promise<void>;
  stop: () => Promise<void>;
  /** 截断该轮及其后所有轮次，用同一个问题重跑。 */
  retry: (turnId: string, model?: string | null) => Promise<void>;
  /** 截断该轮及其后所有轮次，返回原问题交给输入框编辑；无此轮返回空串。 */
  editTurn: (turnId: string) => string;
  resolveApproval: (choice: string, all: boolean) => Promise<void>;
  dismissError: (turnId: string) => void;
}

/**
 * 一次对话的完整生命周期：起 run、订阅 SSE、累积增量、中断、审批、断流恢复。
 *
 * 事件语义见 api_server.py：message.delta(:4880)、reasoning.available(:4764)、
 * tool.started(:4747)、tool.completed(:4755)、approval.request(:4938)、
 * run.completed(:5036)/failed(:5022)/cancelled(:5007)。没有 run.started，
 * 也没有 done/error —— 流靠服务端关闭结束。
 */
export function useAgentRun(): AgentRunState {
  const { sessionId, openSession, refreshSessions, setSessionRunning } = useSession();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [hydratedFor, setHydratedFor] = useState<string | null | undefined>(undefined);
  const [historyError, setHistoryError] = useState<string | undefined>(undefined);

  // 当前会话与 run 的实时值：回调和轮询循环里要读，不能靠闭包快照。
  const sessionRef = useRef<string | null>(sessionId);
  // turns 的实时镜像：send 要用它算 conversation_history。
  // 不能用闭包里的 turns —— ① retry 截断后 setTurns 还没生效，闭包是旧值；
  // ② turns 每来一条 message.delta 就变，放进依赖数组会让 send 每帧重建。
  const turnsRef = useRef<Turn[]>(turns);
  const hydratedRef = useRef<string | null | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    sessionRef.current = sessionId;
    turnsRef.current = turns;
  });

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      abortRef.current?.abort();
      if (pollRef.current !== null) window.clearTimeout(pollRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /**
   * run 结束后把真实的思考过程补回来。
   *
   * SSE 的 reasoning.available 传的是 assistant 文本的回显，不是 reasoning
   * （agent/conversation_loop.py:4655）；而真正的 reasoning 会落进 state.db
   * 的 assistant 消息里。所以终态时补拉一次 /messages，取最后一轮的 reasoning。
   * 拉不到就保持原样，不影响已经展示的回答。
   */
  const backfillReasoning = useCallback((forSession: string, turnId: string) => {
    getMessages(forSession)
      .then((messages) => {
        if (unmountedRef.current || sessionRef.current !== forSession) return;
        const restored = messagesToTurns(messages);
        const last = restored[restored.length - 1];
        if (!last || last.reasoning.length === 0) return;
        setTurns((prev) =>
          patchTurn(prev, turnId, (turn) => ({ ...turn, reasoning: last.reasoning })),
        );
      })
      .catch(() => undefined);
  }, []);

  /**
   * 断流恢复：轮询 GET /v1/runs/{id} 直到终态。
   *
   * SSE 流是一次性的（服务端断开即 pop 队列），所以刷新后只能补最终答案，
   * 中断期间的 tool.* 与 reasoning 明细拿不回来。
   */
  const pollRun = useCallback(
    (runId: string, turnId: string, forSession: string) => {
      stopPolling();
      const tick = () => {
        getRun(runId)
          .then((status) => {
            if (unmountedRef.current || sessionRef.current !== forSession) return;
            if (!isTerminalRunStatus(status.status)) {
              pollRef.current = window.setTimeout(tick, POLL_INTERVAL);
              return;
            }
            setSessionRunning(forSession, null);
            setBusy(false);
            setApproval(null);
            runRef.current = null;
            setTurns((prev) =>
              patchTurn(prev, turnId, (turn) => {
                const answer = status.output?.trim() ? status.output : turn.answer;
                return {
                  ...turn,
                  phase:
                    status.status === "completed"
                      ? "completed"
                      : status.status === "cancelled"
                        ? "cancelled"
                        : "failed",
                  answer,
                  reasoning: dropEchoedReasoning(turn.reasoning, answer),
                  error: status.error,
                  usage: status.usage ?? turn.usage,
                  endedAt: Date.now(),
                };
              }),
            );
            if (status.status === "completed") backfillReasoning(forSession, turnId);
            refreshSessions();
          })
          .catch(() => {
            if (unmountedRef.current || sessionRef.current !== forSession) return;
            // 404 说明记录已过 3600 秒 TTL；放弃恢复，已落库的消息下次进会话时会读到。
            setSessionRunning(forSession, null);
            setBusy(false);
            runRef.current = null;
            setTurns((prev) =>
              patchTurn(prev, turnId, (turn) => ({
                ...turn,
                phase: "detached",
                endedAt: Date.now(),
                error: turn.answer ? undefined : "这轮的执行结果已无法追回，重新进入会话可看到落库的消息。",
              })),
            );
          });
      };
      tick();
    },
    [backfillReasoning, refreshSessions, setSessionRunning, stopPolling],
  );

  // 切换会话（含刷新后的首次挂载）时加载消息。
  // setState 全部发生在 then/catch 里，不在 effect 体内同步调用。
  useEffect(() => {
    if (hydratedRef.current === sessionId) return;
    abortRef.current?.abort();
    abortRef.current = null;
    runRef.current = null;
    stopPolling();

    const target = sessionId;
    let cancelled = false;
    const load = target ? getMessages(target) : Promise.resolve<AgentMessage[]>([]);

    load
      .then((messages) => {
        if (cancelled) return;
        const restored = messagesToTurns(messages);
        setHydratedFor(target);
        setHistoryError(undefined);
        setApproval(null);
        setBusy(false);

        // 这个会话还有没跑完的 run（刷新、或切走又切回来）→ 接上轮询。
        const pending = target ? readPendingRun(target) : null;
        if (!pending) {
          hydratedRef.current = target;
          turnsRef.current = restored;
          setTurns(restored);
          return;
        }

        const turnId = `recovered-${pending.runId}`;
        const last = restored[restored.length - 1];
        // 关键：/messages 里**已经有**这条 user 消息了（run 一开始就落库）。
        // 原来无条件再追加一条 recovered turn，结果同一个问题出现两次，
        // 还丢掉了 DB 里已经攒下的工具明细与推理。
        // 命中就把最后一轮「升级」成进行中，保留它已有的内容。
        const sameQuestion = last && last.question.trim() === pending.question.trim();
        const next: Turn[] = sameQuestion
          ? [
              ...restored.slice(0, -1),
              { ...last, id: turnId, phase: "running", runId: pending.runId, recovered: true },
            ]
          : [
              ...restored,
              {
                id: turnId,
                question: pending.question,
                answer: "",
                reasoning: [],
                tools: [],
                phase: "running",
                runId: pending.runId,
                recovered: true,
                startedAt: pending.startedAt ?? Date.now(),
                lastEventAt: Date.now(),
              },
            ];
        hydratedRef.current = target;
        turnsRef.current = next;
        setTurns(next);
        setBusy(true);
        runRef.current = pending.runId;
        pollRun(pending.runId, turnId, target!);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        hydratedRef.current = target;
        setHydratedFor(target);
        setTurns([]);
        setHistoryError(err instanceof Error ? err.message : "会话消息加载失败");
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, pollRun, stopPolling]);

  /**
   * 把一条 SSE 事件折进 turn 状态。
   *
   * 返回 true 表示这是终态事件。调用方靠它判断「流结束了但服务端从没说过结果」，
   * 那种情况必须转轮询兜底，否则气泡永远停在执行中。
   */
  const applyEvent = useCallback(
    (event: RunEvent, turnId: string, runId: string, forSession: string): boolean => {
      // 任何事件都刷新活跃时间，停滞提示靠它。
      setTurns((prev) =>
        patchTurn(prev, turnId, (turn) => ({ ...turn, lastEventAt: Date.now() })),
      );
      switch (event.event) {
        case "message.delta":
          setTurns((prev) =>
            patchTurn(prev, turnId, (turn) => ({ ...turn, answer: turn.answer + event.delta })),
          );
          break;
        case "reasoning.available":
          if (event.text?.trim()) {
            setTurns((prev) =>
              patchTurn(prev, turnId, (turn) => ({
                ...turn,
                reasoning: [...turn.reasoning, event.text],
              })),
            );
          }
          break;
        case "tool.started":
          setTurns((prev) =>
            patchTurn(prev, turnId, (turn) => ({
              ...turn,
              tools: [
                ...turn.tools,
                {
                  id: `${event.tool}-${turn.tools.length}`,
                  tool: event.tool,
                  preview: event.preview,
                  startedAt: Date.now(),
                  done: false,
                },
              ],
            })),
          );
          break;
        case "tool.completed":
          setTurns((prev) =>
            patchTurn(prev, turnId, (turn) => ({
              ...turn,
              tools: completeTool(turn.tools, event.tool, event.duration, event.error === true),
            })),
          );
          break;
        case "approval.request":
          setApproval({
            runId,
            command: event.command ?? "",
            description: event.description ?? "",
            choices:
              event.choices && event.choices.length > 0
                ? event.choices
                : ["once", "session", "always", "deny"],
          });
          break;
        case "approval.responded":
          setApproval(null);
          break;
        case "run.completed":
          setSessionRunning(forSession, null);
          setApproval(null);
          setTurns((prev) =>
            patchTurn(prev, turnId, (turn) => {
              // 少数模型不走增量，只在终态给完整 output。
              const answer = turn.answer || (event.output ?? "");
              return {
                ...turn,
                phase: "completed",
                answer,
                reasoning: dropEchoedReasoning(turn.reasoning, answer),
                usage: event.usage,
                endedAt: Date.now(),
              };
            }),
          );
          backfillReasoning(forSession, turnId);
          return true;
        case "run.failed":
          setSessionRunning(forSession, null);
          setApproval(null);
          setTurns((prev) =>
            patchTurn(prev, turnId, (turn) => ({
              ...turn,
              phase: "failed",
              error: event.error ?? "执行失败",
              endedAt: Date.now(),
            })),
          );
          return true;
        case "run.cancelled":
          setSessionRunning(forSession, null);
          setApproval(null);
          setTurns((prev) =>
            patchTurn(prev, turnId, (turn) => ({
              ...turn,
              phase: "cancelled",
              endedAt: Date.now(),
            })),
          );
          return true;
      }
      return false;
    },
    [backfillReasoning, setSessionRunning],
  );

  const send = useCallback(
    async (question: string, model?: string | null) => {
      const text = question.trim();
      if (!text || runRef.current) return;

      // 新对话：先建会话拿 id。提前写 hydratedRef，否则 sessionId 一变，
      // 上面的加载 effect 会把正在流的 turn 冲掉。
      let targetSession = sessionRef.current;
      const turnId = `turn-${Date.now()}`;
      // 流异常转轮询时，run 还在后台跑：finally 不能清 busy / runRef，
      // 否则用户能在同一会话里并发起第二个 run。
      let handedToPoll = false;
      setBusy(true);
      setTurns((prev) => [
        ...prev,
        {
          id: turnId,
          question: text,
          answer: "",
          reasoning: [],
          tools: [],
          phase: "running",
          startedAt: Date.now(),
          lastEventAt: Date.now(),
        },
      ]);

      try {
        if (!targetSession) {
          const created = await createSession();
          targetSession = created.id;
          sessionRef.current = created.id;
          hydratedRef.current = created.id;
          setHydratedFor(created.id);
          openSession(created.id);
        }

        const history = buildHistory(turnsRef.current);
        const runId = await startRun({
          input: text,
          sessionId: targetSession,
          history,
          model: model ?? undefined,
        });
        runRef.current = runId;
        setSessionRunning(targetSession, { runId, question: text, startedAt: Date.now() });
        setTurns((prev) => patchTurn(prev, turnId, (turn) => ({ ...turn, runId })));

        const controller = new AbortController();
        abortRef.current = controller;
        const forSession = targetSession;

        let sawTerminal = false;
        try {
          for await (const event of openRunEvents(runId, controller.signal)) {
            if (unmountedRef.current) break;
            if (applyEvent(event, turnId, runId, forSession)) sawTerminal = true;
          }
          // 流「正常结束」但服务端从没发过终态事件 —— 服务端 sweep、代理层 socket
          // 超时、sentinel 丢失都会走到这里，而几分钟的长流正是高危区间。
          // 原来这条路没有任何处理，finally 只清 busy/runRef，于是 turn.phase
          // 永远留在 running，气泡一直转圈。转轮询问服务端真实状态。
          if (!sawTerminal && !unmountedRef.current) {
            handedToPoll = true;
            pollRun(runId, turnId, forSession);
            return;
          }
        } catch (err) {
          // 中断是预期路径：AbortError 由 stop() 触发，终态事件由 /stop 那边送达。
          if (!(err instanceof DOMException && err.name === "AbortError")) {
            // 流断了但 run 可能还在跑（例如网络抖动）→ 转轮询把结果补回来。
            if (!unmountedRef.current) {
              handedToPoll = true;
              pollRun(runId, turnId, forSession);
            }
            return;
          }
        }
      } catch (err: unknown) {
        setSessionRunning(sessionRef.current ?? "", null);
        setTurns((prev) =>
          patchTurn(prev, turnId, (turn) => ({
            ...turn,
            phase: "failed",
            error: err instanceof Error ? err.message : "发送失败，请重试",
            endedAt: Date.now(),
          })),
        );
      } finally {
        if (!unmountedRef.current) {
          abortRef.current = null;
          setApproval(null);
          refreshSessions();
          // 交给轮询的分支由 pollRun 负责收尾。
          if (!handedToPoll) {
            runRef.current = null;
            setBusy(false);
          }
        }
      }
    },
    [applyEvent, openSession, pollRun, refreshSessions, setSessionRunning],
  );

  /**
   * 中断。两件事都要做：abort 只断前端的流，agent 会继续把这轮跑完；
   * POST /stop 才真正调到 agent.interrupt()。
   */
  const stop = useCallback(async () => {
    const runId = runRef.current;
    if (!runId) return;
    try {
      await stopRun(runId);
    } catch {
      // /stop 失败（run 已结束）不影响下面断流。
    }
    abortRef.current?.abort();
    const target = sessionRef.current;
    if (target) setSessionRunning(target, null);
    setTurns((prev) =>
      prev.map((turn) =>
        turn.runId === runId && turn.phase === "running"
          ? { ...turn, phase: "cancelled", endedAt: Date.now() }
          : turn,
      ),
    );
    setApproval(null);
    setBusy(false);
    runRef.current = null;
  }, [setSessionRunning]);

  const resolveApproval = useCallback(
    async (choice: string, all: boolean) => {
      const runId = approval?.runId;
      if (!runId) return;
      setApproval(null);
      try {
        await respondApproval(runId, choice, all);
      } catch (err) {
        setTurns((prev) =>
          prev.map((turn) =>
            turn.runId === runId
              ? { ...turn, error: err instanceof Error ? err.message : "审批回写失败" }
              : turn,
          ),
        );
      }
    },
    [approval],
  );

  /**
   * 截断到 turnId 之前（不含）。
   *
   * conversation_history 由剩余 turns 现算（/v1/runs 不读 session 历史），
   * 所以本地截断就等于截断 agent 下一轮看到的上下文 —— DB 里的旧消息不参与。
   * 返回被截掉那一轮的问题文本。
   */
  const truncateFrom = useCallback((turnId: string): string => {
    const list = turnsRef.current;
    const index = list.findIndex((turn) => turn.id === turnId);
    if (index < 0) return "";
    const next = list.slice(0, index);
    // 同步更新 ref：紧接着调用的 send 必须读到截断后的上下文，
    // 而 setTurns 要等到下一次渲染才生效。
    turnsRef.current = next;
    setTurns(next);
    return list[index].question;
  }, []);

  const retry = useCallback(
    async (turnId: string, model?: string | null) => {
      // 正在跑时不允许重试：会和进行中的 run 抢 runRef / busy 状态。
      if (runRef.current) return;
      const question = truncateFrom(turnId);
      if (!question) return;
      await send(question, model);
    },
    [send, truncateFrom],
  );

  const editTurn = useCallback(
    (turnId: string): string => {
      if (runRef.current) return "";
      return truncateFrom(turnId);
    },
    [truncateFrom],
  );

  const dismissError = useCallback((turnId: string) => {
    setTurns((prev) => prev.filter((turn) => turn.id !== turnId));
  }, []);

  return {
    turns,
    busy,
    historyLoading: sessionId !== hydratedFor,
    historyError,
    approval,
    send,
    stop,
    retry,
    editTurn,
    resolveApproval,
    dismissError,
  };
}
