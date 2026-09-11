/**
 * 能力管理（Skill / MCP）的只读端点封装。
 *
 * 与聊天页抽屉共用同一份 listSkills —— 能力清单只能有一个数据源。
 * 本期没有写操作：启停、连接探测、增删改都不走这里。
 */

import { request } from "./http";
import type { McpServer, Skill, SkillDocument } from "@/types/capability";

/**
 * 当前 profile 下 agent 能用的 skill（与飞书助手同一份）。
 *
 * `includeDisabled` 为 true 时把被 config 关掉的 skill 也带回来（`enabled:false`），
 * 默认只返回 agent 实际会加载的那些。
 */
export async function listSkills(includeDisabled = false): Promise<Skill[]> {
  const query = includeDisabled ? "?include_disabled=1" : "";
  const body = await request<{ data: Skill[] }>(`/v1/skills${query}`);
  return body.data ?? [];
}

/**
 * 单个 skill 的 SKILL.md 正文。
 *
 * 列表刻意不带正文：几十个 skill 每个几十 KB markdown，一次拉全是几 MB 的
 * 无用流量，所以详情按需取。
 */
export function getSkillDetail(name: string): Promise<SkillDocument> {
  return request<SkillDocument>(`/v1/skills/detail?name=${encodeURIComponent(name)}`);
}

/** 当前 profile config.yaml 里配置的 MCP server（敏感值已脱敏）。 */
export async function listMcpServers(): Promise<McpServer[]> {
  const body = await request<{ data: McpServer[] }>("/v1/mcp/servers");
  return body.data ?? [];
}
