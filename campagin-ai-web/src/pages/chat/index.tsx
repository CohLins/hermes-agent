import { useEffect, useRef, useState } from "react";
import { App, Button, Skeleton, Tooltip } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { getChatSuggestions } from "@/api/chat";
import { forkSession, listModels, renameSession } from "@/api/agent";
import EmptyBlock from "@/components/EmptyBlock";
import Markdown from "@/components/Markdown";
import { CURRENT_USER, PRODUCT_MARK } from "@/constants";
import { useSession } from "@/contexts/useSession";
import { useAgentRun } from "@/hooks/useAgentRun";
import { useAsync } from "@/hooks/useAsync";
import ApprovalModal from "./ApprovalModal";
import CapabilityDrawer, { type CapabilityTab } from "./CapabilityDrawer";
import MessageActions from "./MessageActions";
import ModelPicker from "./ModelPicker";
import RunProgress from "./RunProgress";
import Composer from "./Composer";
import TurnDetail from "./TurnDetail";
import { DECLINE_PHRASE, detectConfirmRequest } from "./confirmPrompt";
import { formatTokens } from "./format";
import { parseCommand, type SlashCommand } from "./slashCommands";
import type { Turn } from "@/types/agent";

const PHASE_LABEL: Record<Turn["phase"], string> = {
  idle: "",
  running: "执行中",
  completed: "回答完成",
  failed: "执行失败",
  cancelled: "已中断",
  detached: "结果已断开",
};

export default function ChatPage() {
  const { message } = App.useApp();
  const { sessionId, openSession, refreshSessions, sessions } = useSession();
  const { data: suggestions } = useAsync(getChatSuggestions, []);
  const {
    turns,
    busy,
    historyLoading,
    historyError,
    approval,
    send,
    stop,
    retry,
    editTurn,
    dismissError,
    resolveApproval,
  } = useAgentRun();
  const [input, setInput] = useState("");
  const [capTab, setCapTab] = useState<CapabilityTab | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const { data: models } = useAsync(listModels, []);

  // 会话行里的 model 才是真实模型（gpt-5.6-terra）；/v1/models 的基准条目是 profile 名。
  // 新对话还没有会话行，退回用最近一条会话的模型 —— 它们都来自同一份 config 默认值。
  const sessionModel =
    (sessions.find((x) => x.id === sessionId)?.model ?? sessions[0]?.model) || undefined;

  const modelSlot = (
    <ModelPicker
      models={models ?? []}
      selected={model}
      onSelect={setModel}
      sessionModel={sessionModel}
      disabled={busy}
    />
  );

  // 新消息出现时滚到底。ref 只在 effect 里读，不在渲染期赋值。
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  /** 本地命令：全部在前端执行，一条都不发给 agent。 */
  const runCommand = (cmd: SlashCommand, arg: string) => {
    if (cmd.action === "new") {
      openSession(null);
      setInput("");
      return;
    }
    if (cmd.action === "stop") {
      if (!busy) {
        message.info("当前没有正在执行的任务");
        return;
      }
      setInput("");
      void stop();
      return;
    }
    if (cmd.action === "skills" || cmd.action === "tools" || cmd.action === "model") {
      setCapTab(cmd.action === "model" ? "runtime" : cmd.action === "tools" ? "toolsets" : "skills");
      setInput("");
      return;
    }
    if (cmd.action === "fork") {
      if (!sessionId) {
        message.warning("还没有会话可以分叉，先发一条消息");
        return;
      }
      setInput("");
      forkSession(sessionId)
        .then((forked) => {
          refreshSessions();
          openSession(forked.id);
          message.success("已分叉，上下文已带过来");
        })
        .catch((err: unknown) => {
          message.error(err instanceof Error ? err.message : "分叉失败");
        });
      return;
    }
    if (cmd.action === "rename") {
      if (!sessionId) {
        message.warning("还没有会话可以重命名，先发一条消息");
        return;
      }
      const title = arg.trim();
      if (!title) {
        message.warning("用法：/rename 新标题");
        return;
      }
      setInput("");
      renameSession(sessionId, title)
        .then(() => {
          refreshSessions();
          message.success("已重命名");
        })
        // 标题在 state.db 里唯一，重名会返回 400 invalid_title。
        .catch((err: unknown) => {
          message.error(err instanceof Error ? err.message : "重命名失败");
        });
    }
  };

  const onSend = () => {
    const question = input.trim();
    if (!question) {
      message.warning("请先输入想查询的问题");
      return;
    }

    if (question.startsWith("/")) {
      const parsed = parseCommand(question);
      if (parsed) {
        runCommand(parsed.cmd, parsed.arg);
        return;
      }
      // 不拦的话模型会把 hermes 的斜杠命令「演」一遍：/v1/runs 绕开了
      // gateway 的命令中间件，`/new` 只会得到一句「已开始新的会话」而
      // session 根本没换。宁可挡住，也不给假的成功反馈。
      message.warning("这不是本平台支持的命令。hermes 的斜杠命令在这条通道上不生效——输入 / 看可用命令，或直接把问题写出来。");
      return;
    }

    setInput("");
    void send(question, model);
  };

  const onStop = () => {
    void stop();
  };

  const onCopied = (ok: boolean) => {
    if (ok) message.success("已复制");
    else message.error("复制失败，请手动选中内容复制");
  };

  /** 一键回复。用于 agent 在正文里索要口头确认的场景。 */
  const quickReply = (text: string) => {
    if (busy) return;
    setInput("");
    void send(text, model);
  };

  /** 编辑重发：把原问题放回输入框，该轮及之后从本地上下文移除。 */
  const onEdit = (turnId: string) => {
    const question = editTurn(turnId);
    if (question) setInput(question);
  };

  if (historyLoading) {
    return (
      <section data-od-id="view-home">
        <div className="chat-thread">
          <Skeleton active avatar paragraph={{ rows: 4 }} />
          <Skeleton active avatar paragraph={{ rows: 3 }} style={{ marginTop: 24 }} />
        </div>
      </section>
    );
  }

  if (historyError) {
    return (
      <section data-od-id="view-home">
        <div className="chat-thread">
          <EmptyBlock title="会话加载失败" desc={historyError} />
        </div>
      </section>
    );
  }

  if (turns.length === 0) {
    return (
      <section data-od-id="view-home">
        <div className="welcome" data-od-id="chat-empty">
          <p className="eyebrow">AGENT WORKSPACE</p>
          <h1>今天，想先排查什么问题？</h1>
          <p>用自然语言查询日志、定位异常，或快速了解服务运行状态。</p>
          <div className="suggestion-cards" data-od-id="chat-suggestions">
            {(suggestions ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                className="suggestion-card"
                data-od-id={`chat-suggestion-${item.id}`}
                onClick={() => setInput(item.question)}
              >
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
                <div className="suggestion-card-foot">
                  <span className="suggestion-card-meta">{item.meta}</span>
                  <span className="suggestion-card-hint">填入问题 →</span>
                </div>
              </button>
            ))}
          </div>
          <Composer
            value={input}
            onChange={setInput}
            onSend={onSend}
            onStop={onStop}
            sending={busy}
            placeholder="描述你遇到的问题，或输入 / 查看快捷命令"
            hint="Enter 发送 · Shift + Enter 换行 · / 唤出命令"
            modelSlot={modelSlot}
          />
        </div>
        <ApprovalModal approval={approval} onResolve={resolveApproval} />
        <CapabilityDrawer
          open={capTab !== null}
          tab={capTab ?? "skills"}
          onTabChange={setCapTab}
          onClose={() => setCapTab(null)}
          sessionModel={sessionModel}
        />
      </section>
    );
  }

  return (
    <section data-od-id="view-home">
      <div className="chat-thread" data-od-id="chat-result">
        {turns.map((turn) => {
          const confirmRequest =
            turn.phase === "completed" ? detectConfirmRequest(turn.answer) : null;
          return (
          <div key={turn.id}>
            <div className="message user">
              <div className="msg-col">
                <div className="bubble">{turn.question}</div>
                <MessageActions
                  text={turn.question}
                  at={turn.startedAt}
                  onEdit={() => onEdit(turn.id)}
                  disabled={busy}
                  onCopied={onCopied}
                />
              </div>
            </div>

            <TurnDetail turn={turn} />

            {turn.phase === "running" && turn.recovered ? (
              <div className="tool-row">
                <span className="running-dot" />
                后台仍在执行 —— 这一轮的实时流已断开，结果出来后会自动补上。
              </div>
            ) : null}

            {turn.phase === "detached" ? (
              <div className="tool-row">这一轮的实时流已断开，重新进入会话可看到落库结果。</div>
            ) : null}

            {/*
              气泡一律渲染，不再用「有回答才渲染」做条件。
              原来的条件在「终态 + 空回答」时为假，于是执行中还在的气泡会整块
              消失，页面看起来就是自己跳了一下 —— 内容消失比内容难看糟糕得多。
            */}
            {
              <div className="message">
                <div className="user-avatar">{PRODUCT_MARK}</div>
                <div className="msg-col">
                  <div className="bubble agent">
                    <div className="agent-label">
                      {PHASE_LABEL[turn.phase]}
                      {turn.usage?.total_tokens ? (
                        <>
                          {"　"}
                          {/*
                            服务端给的是 agent.session_*（api_server.py:4998-5002），
                            是**会话累计**而不是本轮消耗。原来直接写「N tokens」，
                            看着像这一条回答烧了 188 万 token，必须标清楚。
                          */}
                          <Tooltip title="本会话累计消耗（服务端给的是 session 级累计，不是这一轮）">
                            <span className="num agent-usage">
                              会话累计 {formatTokens(turn.usage.total_tokens)}
                            </span>
                          </Tooltip>
                        </>
                      ) : null}
                    </div>

                    {/*
                      进行中的实时进度：当前动作、计数、最近几条、最新叙述、停滞提示。
                      放在 Markdown 之后 —— 回答开始流出时它会自动收缩成一行，
                      主体位置留给正文。
                    */}
                    {turn.phase === "running" ? <RunProgress turn={turn} /> : null}

                    {turn.answer ? (
                      <Markdown
                        className={turn.phase === "running" ? "streaming" : undefined}
                        // 流式中 ```mermaid 里只有半截图定义，MermaidBlock 要靠
                        // 这个标记显示占位而不是报语法错。
                        streaming={turn.phase === "running"}
                      >
                        {turn.answer}
                      </Markdown>
                    ) : null}

                    {/* 终态但一个字都没有：在气泡里说明，而不是把气泡拿掉。 */}
                    {turn.phase !== "running" && !turn.answer && !turn.error ? (
                      <p className="agent-empty">
                        本轮没有产生文字回答
                        {turn.tools.length > 0 ? "，工具输出在上方明细里" : ""}
                        {turn.phase === "cancelled" ? "（已中断）" : ""}
                      </p>
                    ) : null}

                    {turn.error ? (
                      <p className="turn-error">
                        {turn.error}
                        {"　"}
                        <button
                          type="button"
                          className="suggestion"
                          onClick={() => dismissError(turn.id)}
                        >
                          移除这条
                        </button>
                      </p>
                    ) : null}
                  </div>

                  {/*
                    agent 在正文里等口头确认时给一键按钮。
                    只在最后一轮出现：从历史某一轮点确认，发出去的上下文是
                    完整历史，语义会错乱。
                  */}
                  {turn.phase === "completed" &&
                  turn.id === turns[turns.length - 1]?.id &&
                  confirmRequest ? (
                    <div className="quick-replies" data-od-id="chat-confirm">
                      <Tooltip title={`agent 在等你确认：「${confirmRequest.excerpt}」`}>
                        <Button
                          type="primary"
                          size="small"
                          icon={<CheckOutlined />}
                          onClick={() => quickReply(confirmRequest.phrase)}
                          disabled={busy}
                        >
                          {confirmRequest.phrase}
                        </Button>
                      </Tooltip>
                      <Button
                        size="small"
                        icon={<CloseOutlined />}
                        onClick={() => quickReply(DECLINE_PHRASE)}
                        disabled={busy}
                      >
                        先不要执行
                      </Button>
                      <span className="quick-replies-hint">或直接在下方补充说明</span>
                    </div>
                  ) : null}

                  {turn.phase === "running" ? null : (
                    <MessageActions
                      text={turn.answer || turn.error || ""}
                      at={turn.startedAt}
                      onRetry={() => void retry(turn.id, model)}
                      disabled={busy}
                      onCopied={onCopied}
                    />
                  )}
                </div>
              </div>
            }
          </div>
          );
        })}

        <div ref={bottomRef} />

        <Composer
          value={input}
          onChange={setInput}
          onSend={onSend}
          onStop={onStop}
          sending={busy}
          placeholder={`继续追问，${CURRENT_USER.name} · 输入 / 查看快捷命令`}
          hint={sessionId ? "Shift + Enter 换行 · / 唤出命令" : "Enter 发送 · / 唤出命令"}
          modelSlot={modelSlot}
        />
      </div>
      <ApprovalModal approval={approval} onResolve={resolveApproval} />
      <CapabilityDrawer
        open={capTab !== null}
        tab={capTab ?? "skills"}
        onTabChange={setCapTab}
        onClose={() => setCapTab(null)}
        sessionModel={sessionModel}
      />
    </section>
  );
}
