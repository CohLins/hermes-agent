import { chatSuggestions } from "@/mock/chat";

/**
 * 输入框的斜杠命令。
 *
 * 重要前提：**hermes 自己的斜杠命令在这条通道上不生效**。
 * `/v1/runs` 直接调 agent.run_conversation（api_server.py:4979），绕开了
 * gateway 的 inbound 中间件——斜杠命令是在那里被 hermes_cli.commands
 * .resolve_command 解析并执行的。实测发 `/new` 模型只会回「已开始新的会话」
 * 而 session id 不变；发 `/help` 它会列出 /compact、/undo 等一串**并不存在**
 * 的能力。所以这里只放两种真能干活的东西：
 *
 *   action   —— 前端本地执行，有对应端点或本地动作，绝不发给 agent
 *   template —— 填入输入框的提问模板，用户改完自己发
 *
 * 明确做不到的（路由表里没有端点，别再加进来）：
 *   /compress、/compact 压缩上下文  —— api_server 全无此端点，上下文压缩是
 *                                      agent 内部自动行为，HTTP 上触发不了。
 *                                      上下文太长就 /new 或 /fork。
 *   /undo、/retry、/steer、/agents、/resume、/goal —— 同理，只在 gateway 的
 *                                      inbound 管道里存在。
 */

export type SlashKind = "action" | "template";

export interface SlashCommand {
  /** 不含斜杠。 */
  name: string;
  label: string;
  hint: string;
  kind: SlashKind;
  /** action：本地动作标识。 */
  action?: "new" | "stop" | "rename" | "skills" | "tools" | "model" | "fork";
  /** action 是否需要参数（需要则从菜单选中时只补全命令，不执行）。 */
  takesArg?: boolean;
  /** template：填入输入框的完整问句。 */
  template?: string;
}

const ACTIONS: SlashCommand[] = [
  {
    name: "new",
    label: "新建会话",
    hint: "开一个新对话，当前会话保留在左侧历史里",
    kind: "action",
    action: "new",
  },
  {
    name: "stop",
    label: "中断执行",
    hint: "停掉本轮 agent（等同点右下角的中断按钮）",
    kind: "action",
    action: "stop",
  },
  {
    name: "rename",
    label: "重命名会话",
    hint: "/rename 新标题 —— 标题在库里唯一，重名会失败",
    kind: "action",
    action: "rename",
    takesArg: true,
  },
  {
    name: "skills",
    label: "列举技能",
    hint: "GET /v1/skills —— profile 的 skills 目录，与飞书助手同一份",
    kind: "action",
    action: "skills",
  },
  {
    name: "tools",
    label: "可用工具",
    hint: "GET /v1/toolsets —— api_server 实际解析出的工具集及启用状态",
    kind: "action",
    action: "tools",
  },
  {
    name: "model",
    label: "运行时信息",
    hint: "会话模型、执行模式、鉴权与服务端特性",
    kind: "action",
    action: "model",
  },
  {
    name: "fork",
    label: "分叉会话",
    hint: "POST /api/sessions/{id}/fork —— 保留上下文另开一路（不是压缩）",
    kind: "action",
    action: "fork",
  },
];

/** 模板直接复用首页的建议卡片，保持单一来源。 */
const TEMPLATES: SlashCommand[] = chatSuggestions.map((item) => ({
  name: item.id,
  label: item.title,
  hint: item.question,
  kind: "template" as const,
  template: item.question,
}));

export const SLASH_COMMANDS: SlashCommand[] = [...ACTIONS, ...TEMPLATES];

/** 输入是否处于「正在敲斜杠命令」的状态：以 / 开头，且还没敲到参数。 */
export function slashQuery(input: string): string | null {
  if (!input.startsWith("/")) return null;
  const rest = input.slice(1);
  // 出现空格说明已进入参数部分（如 `/rename 我的会话`），菜单该收起。
  if (/\s/.test(rest)) return null;
  return rest.toLowerCase();
}

export function filterCommands(query: string): SlashCommand[] {
  if (!query) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(query) ||
      cmd.label.toLowerCase().includes(query) ||
      cmd.hint.toLowerCase().includes(query),
  );
}

export interface ParsedCommand {
  cmd: SlashCommand;
  arg: string;
}

/**
 * 把已敲完的输入解析成命令。
 *
 * 返回 undefined 表示「以 / 开头但不是我们支持的命令」——调用方必须提示用户，
 * 不能直接发给 agent，否则模型会把 hermes 的斜杠命令演一遍（见文件头）。
 */
export function parseCommand(input: string): ParsedCommand | undefined {
  const text = input.trim();
  if (!text.startsWith("/")) return undefined;
  const [head, ...restParts] = text.slice(1).split(/\s+/);
  const cmd = SLASH_COMMANDS.find((x) => x.name.toLowerCase() === head.toLowerCase());
  if (!cmd) return undefined;
  return { cmd, arg: restParts.join(" ") };
}
