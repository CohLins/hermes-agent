/**
 * 能力管理的服务端契约（gateway/platforms/api_server.py）。
 *
 *   GET /v1/skills          _handle_skills       → tools/skills_tool.list_skills_detailed
 *   GET /v1/skills/detail   _handle_skill_detail → tools/skills_tool.read_skill_document
 *   GET /v1/mcp/servers     _handle_mcp_servers  → hermes_cli/mcp_config.mcp_server_summary
 *
 * 字段取自服务端白名单，不要凭猜测扩字段。
 *
 * 这三个端点只读**当前 profile**：skill 来自 `<HERMES_HOME>/skills` +
 * config 的 `skills.external_dirs`，MCP 来自该 profile config.yaml 的
 * `mcp_servers`。仓库里的 `skills/` 只是安装期种子，运行时不参与；仓库根的
 * `.mcp.json` 属于 Claude Code，hermes 不读它。
 */

/** 配置就绪度，值来自 tools/skills_tool.SkillReadinessStatus。 */
export type SkillReadiness = "available" | "setup_needed";

/**
 * bundled = 随 hermes 发行、由仓库 `skills/` 种子装入（登记在 `.bundled_manifest`）；
 * custom  = 自己写的或 Skills Hub 装的。
 */
export type SkillProvenance = "bundled" | "custom";

export interface Skill {
  name: string;
  description: string;
  /** skill 所在的分类目录名；顶层 skill 为 null。 */
  category: string | null;
  /** frontmatter 的 version。不保证有（实测 60 个里 47 个有），没有就别显示。 */
  version: string | null;
  tags: string[];
  /** false = 被 config 的 skills.disabled / platform_disabled 关掉了。 */
  enabled: boolean;
  provenance: SkillProvenance;
  readiness: SkillReadiness;
  /** 尚未设置的必需环境变量名。服务端只给名字，从不给值。 */
  missing_env: string[];
  /** frontmatter setup.help 的文案，用于告诉用户怎么补配置。 */
  setup_help: string | null;
}

/** GET /v1/skills/detail 的返回：列表元数据 + SKILL.md 正文。 */
export interface SkillDocument {
  name: string;
  description: string;
  category: string | null;
  version: string | null;
  tags: string[];
  provenance: SkillProvenance;
  /** SKILL.md 原文（含 frontmatter），按 Markdown 渲染。 */
  content: string;
  /** 正文超过服务端上限（256 KB）被截断。 */
  truncated: boolean;
}

export interface McpServer {
  name: string;
  transport: "http" | "stdio" | "unknown";
  url: string | null;
  /** 只有命令名：服务端刻意去掉了绝对路径，不向浏览器暴露 home 布局。 */
  command: string | null;
  args: string[];
  /** 值已由 hermes_cli/config.redact_key 脱敏。 */
  env: Record<string, string>;
  /** "oauth" / "header" / null。 */
  auth: string | null;
  /**
   * 配置项 enabled 标记的宽松解读（`is not False`）。展示用，判定别用它 ——
   * 权威是 globally_enabled，它走 tools_config._parse_enabled_flag，
   * 还认 "false"/"0"/"no"/"off" 这些字符串，且那才是运行时实际采用的口径。
   */
  enabled: boolean;
  /** null = 没做工具筛选，即该 server 的全部工具都可用。 */
  tools: string[] | null;
  /** 运行时口径的「全局启用」：tools_config.enabled_mcp_server_names 的成员。 */
  globally_enabled: boolean;
  /**
   * api_server 这个平台解析出的工具集里是否真的含它。
   * 全局 enabled 但平台不可见是真实存在的情况（平台显式 allowlist、或 no_mcp 哨兵），
   * 只看 enabled 会把它误报成可用。
   */
  available_to_platform: boolean;
  /** 仅 auth: "oauth" 有意义（磁盘上有没有 token）；其余为 null。 */
  token_present: boolean | null;
}
