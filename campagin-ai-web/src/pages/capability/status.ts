/**
 * 能力状态的统一推导。
 *
 * 服务端给的是分解事实（enabled / readiness / available_to_platform / token_present），
 * 三态标签由前端合成，避免每个渲染点各自拼一套判断。
 */

import type { McpServer, Skill } from "@/types/capability";

export type CapabilityStatus = "已启用" | "待配置" | "未启用";

export const CAPABILITY_STATUSES: CapabilityStatus[] = ["已启用", "待配置", "未启用"];

export function skillStatus(skill: Skill): CapabilityStatus {
  if (!skill.enabled) return "未启用";
  return skill.readiness === "setup_needed" ? "待配置" : "已启用";
}

export function mcpStatus(server: McpServer): CapabilityStatus {
  // globally_enabled 才是运行时口径（见 types/capability.ts 的字段说明）。
  if (!server.globally_enabled) return "未启用";
  // 全局开着但本平台拿不到，等于 agent 调不了它。
  if (!server.available_to_platform) return "待配置";
  // oauth server 没 token 就是没连上，即便配置齐全。
  if (server.auth === "oauth" && server.token_present === false) return "待配置";
  return "已启用";
}

/** 详情里解释「为什么是这个状态」，没有异常时返回 null。 */
export function skillStatusReason(skill: Skill): string | null {
  if (!skill.enabled) {
    return "已在 config.yaml 的 skills.disabled / platform_disabled 中关闭，agent 不会加载它。";
  }
  if (skill.readiness === "setup_needed") {
    const names = skill.missing_env.join("、");
    const help = skill.setup_help ? ` ${skill.setup_help}` : "";
    return `缺少必需的环境变量：${names}。请在该 profile 的 .env 中补齐后重启 gateway。${help}`;
  }
  return null;
}

export function mcpStatusReason(server: McpServer): string | null {
  if (!server.globally_enabled) {
    return "该 MCP 在 config.yaml 里被置为 enabled: false，agent 不会连接它。";
  }
  if (!server.available_to_platform) {
    return "全局已启用，但 api_server 这个平台解析出的工具集不含它（平台显式 allowlist 或 no_mcp 哨兵），agent 当前调不到。";
  }
  if (server.auth === "oauth" && server.token_present === false) {
    return "OAuth 授权尚未完成（本地没有 token），需要先执行 hermes mcp login。";
  }
  return null;
}
