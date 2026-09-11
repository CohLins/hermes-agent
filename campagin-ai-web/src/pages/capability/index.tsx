import { useMemo, useState } from "react";
import { App, Button, Input, Modal, Select, Tabs, Tag } from "antd";
import { getCapabilities } from "@/api/agent";
import { getSkillDetail, listMcpServers, listSkills } from "@/api/capability";
import LoadState from "@/components/LoadState";
import Markdown from "@/components/Markdown";
import PageHead from "@/components/PageHead";
import StatusPill from "@/components/StatusPill";
import { toneOfCapabilityStatus } from "@/components/statusTone";
import EmptyBlock from "@/components/EmptyBlock";
import { useAsync } from "@/hooks/useAsync";
import type { McpServer, Skill } from "@/types/capability";
import {
  CAPABILITY_STATUSES,
  mcpStatus,
  mcpStatusReason,
  skillStatus,
  skillStatusReason,
  type CapabilityStatus,
} from "./status";

type TabKey = "skill" | "mcp";
type StatusFilter = "all" | CapabilityStatus;

export default function CapabilityPage() {
  const { message } = App.useApp();
  const [tab, setTab] = useState<TabKey>("skill");
  // 搜索与筛选是页面级状态，切 Tab 时保留（plan.md 验收项）。
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [activeSkill, setActiveSkill] = useState<Skill>();
  const [activeMcp, setActiveMcp] = useState<McpServer>();

  // include_disabled=true：管理页要看到全貌，包括被关掉的。
  const skillState = useAsync(() => listSkills(true), []);
  const mcpState = useAsync(listMcpServers, []);
  // 清单是 profile 级的，标出来才解释得清「为什么是这个数量」。
  const caps = useAsync(getCapabilities, []);

  const filteredSkills = useMemo(
    () =>
      filterList(skillState.data ?? [], keyword, status, skillStatus, (s) =>
        [s.name, s.description, s.category ?? "", ...s.tags].join(" "),
      ),
    [skillState.data, keyword, status],
  );
  const filteredMcps = useMemo(
    () =>
      filterList(mcpState.data ?? [], keyword, status, mcpStatus, (s) =>
        [s.name, s.transport, s.url ?? "", s.command ?? ""].join(" "),
      ),
    [mcpState.data, keyword, status],
  );

  const clearFilters = () => {
    setKeyword("");
    setStatus("all");
  };

  const refresh = () => {
    skillState.reload();
    mcpState.reload();
    message.success("已重新读取当前 profile 的能力配置");
  };

  return (
    <section data-od-id="view-capability">
      <PageHead
        eyebrow="CAPABILITIES"
        title="能力管理"
        desc={
          caps.data?.profile
            ? `profile「${caps.data.profile}」实际加载的 Skill 与 MCP，与该 profile 的飞书助手共享同一份配置。`
            : "agent 当前 profile 实际加载的 Skill 与 MCP，与飞书助手共享同一份配置。"
        }
        extra={<Button onClick={refresh}>刷新列表</Button>}
      />

      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={[
          { key: "skill", label: `Skill ${skillState.data?.length ?? 0}` },
          { key: "mcp", label: `MCP ${mcpState.data?.length ?? 0}` },
        ]}
      />

      <div className="toolbar">
        <Input
          className="toolbar-search"
          placeholder={tab === "skill" ? "搜索名称、说明、分类或标签" : "搜索名称、传输方式或命令"}
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索能力"
        />
        <Select<StatusFilter>
          value={status}
          onChange={setStatus}
          style={{ width: 150 }}
          options={[
            { value: "all", label: "全部状态" },
            ...CAPABILITY_STATUSES.map((s) => ({ value: s, label: s })),
          ]}
          aria-label="状态筛选"
        />
      </div>

      {tab === "skill" ? (
        <LoadState loading={skillState.loading} error={skillState.error} onRetry={skillState.reload}>
          {filteredSkills.length === 0 ? (
            <EmptyBlock
              title="没有匹配的能力"
              desc="请调整关键词或清除筛选后重试。"
              action={<Button onClick={clearFilters}>清除筛选</Button>}
            />
          ) : (
            <div className="cards" data-od-id="skill-cards">
              {filteredSkills.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className="card"
                  data-od-id={`skill-card-${item.name}`}
                  onClick={() => setActiveSkill(item)}
                >
                  <div className="card-top">
                    <h3>{item.name}</h3>
                    <StatusPill tone={toneOfCapabilityStatus(skillStatus(item))}>
                      {skillStatus(item)}
                    </StatusPill>
                  </div>
                  <p className="card-desc">{item.description || "（无说明）"}</p>
                  <div className="meta-row">
                    {/* 版本位语义固定：frontmatter 没写 version 就明说没写，
                        不要拿别的信息来顶这一格（那会让同一位置一会儿是版本
                        一会儿是来源）。 */}
                    <span className="num">
                      {item.version ? `v${stripLeadingV(item.version)}` : "未标版本"}
                    </span>
                    <span>
                      {provenanceLabel(item)} · {item.category ?? "未分类"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </LoadState>
      ) : (
        <LoadState loading={mcpState.loading} error={mcpState.error} onRetry={mcpState.reload}>
          {filteredMcps.length === 0 ? (
            <EmptyBlock
              title="没有配置 MCP"
              desc="当前 profile 的 config.yaml 里没有匹配的 mcp_servers 条目。"
              action={<Button onClick={clearFilters}>清除筛选</Button>}
            />
          ) : (
            <div className="cards" data-od-id="mcp-cards">
              {filteredMcps.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className="card"
                  data-od-id={`mcp-card-${item.name}`}
                  onClick={() => setActiveMcp(item)}
                >
                  <div className="card-top">
                    <h3>{item.name}</h3>
                    <StatusPill tone={toneOfCapabilityStatus(mcpStatus(item))}>
                      {mcpStatus(item)}
                    </StatusPill>
                  </div>
                  <p className="card-desc">{mcpEndpointSummary(item)}</p>
                  <div className="meta-row">
                    <span className="num">{item.transport}</span>
                    <span>{item.tools ? `${item.tools.length} 个工具` : "全部工具"}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </LoadState>
      )}

      <SkillDetailModal skill={activeSkill} onClose={() => setActiveSkill(undefined)} />

      <Modal
        open={!!activeMcp}
        onCancel={() => setActiveMcp(undefined)}
        footer={null}
        width={720}
        title={
          <div>
            <p className="eyebrow">MCP DETAIL</p>
            <h2 style={{ fontSize: 22 }}>{activeMcp?.name}</h2>
          </div>
        }
      >
        {activeMcp ? <McpDetail server={activeMcp} /> : null}
      </Modal>
    </section>
  );
}

/**
 * Skill 详情：打开时才拉 SKILL.md。
 *
 * 列表端点刻意不带正文 —— 几十个 skill 每个几十 KB markdown，一次拉全是几 MB
 * 无人阅读的流量。
 */
function SkillDetailModal({ skill, onClose }: { skill?: Skill; onClose: () => void }) {
  const name = skill?.name ?? "";
  const detail = useAsync(
    () => (name ? getSkillDetail(name) : Promise.resolve(undefined)),
    [name],
  );
  const reason = skill ? skillStatusReason(skill) : null;

  return (
    <Modal
      open={!!skill}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnHidden
      title={
        <div>
          <p className="eyebrow">SKILL DETAIL</p>
          <h2 style={{ fontSize: 22 }}>{skill?.name}</h2>
        </div>
      }
    >
      {skill ? (
        <>
          <div className="meta-row" style={{ marginBottom: 12 }}>
            <span className="num">{skill.version ? `v${stripLeadingV(skill.version)}` : "无版本号"}</span>
            <span>{skill.category ?? "未分类"}</span>
            <StatusPill tone={toneOfCapabilityStatus(skillStatus(skill))}>
              {skillStatus(skill)}
            </StatusPill>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Tag>{provenanceLabel(skill)}</Tag>
            {skill.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
          {reason ? <p className="field-help" style={{ marginBottom: 12 }}>{reason}</p> : null}
          <LoadState loading={detail.loading} error={detail.error} onRetry={detail.reload} rows={6}>
            <div style={{ maxHeight: "60vh", overflow: "auto" }}>
              <Markdown>{detail.data?.content ?? ""}</Markdown>
              {detail.data?.truncated ? (
                <p className="field-help">正文过长已截断，完整内容见该 skill 的 SKILL.md。</p>
              ) : null}
            </div>
          </LoadState>
        </>
      ) : null}
    </Modal>
  );
}

function McpDetail({ server }: { server: McpServer }) {
  const reason = mcpStatusReason(server);
  const envEntries = Object.entries(server.env);

  return (
    <div style={{ maxHeight: "60vh", overflow: "auto" }}>
      <div className="detail-block">
        <h3>连接状态</h3>
        <p>
          <StatusPill tone={toneOfCapabilityStatus(mcpStatus(server))}>
            {mcpStatus(server)}
          </StatusPill>
          {"　"}
          {server.available_to_platform ? "api_server 平台可调用" : "api_server 平台不可调用"}
        </p>
        {reason ? <p style={{ marginTop: 8 }}>{reason}</p> : null}
        <p className="field-help" style={{ marginTop: 8 }}>
          状态来自配置解析，本页不发起真实连接探测。
        </p>
      </div>
      <div className="detail-block">
        <h3>接入方式</h3>
        <p>{mcpEndpointSummary(server)}</p>
        {server.args.length > 0 ? (
          <div className="code" style={{ marginTop: 10 }}>
            {[server.command, ...server.args].join(" ")}
          </div>
        ) : null}
        <p className="field-help" style={{ marginTop: 8 }}>
          {server.auth ? `鉴权方式：${server.auth}` : "未配置鉴权"}
          {server.auth === "oauth"
            ? server.token_present
              ? " · 本地已有 token"
              : " · 本地没有 token"
            : ""}
        </p>
      </div>
      <div className="detail-block">
        <h3>工具选择</h3>
        <p>{server.tools ? server.tools.join(" · ") : "未做筛选，该 server 的全部工具都可用。"}</p>
      </div>
      <div className="detail-block">
        <h3>环境变量</h3>
        {envEntries.length === 0 ? (
          <p>未配置环境变量。</p>
        ) : (
          <div className="code" style={{ marginTop: 4 }}>
            {envEntries.map(([key, value]) => `${key} = ${value}`).join("\n")}
          </div>
        )}
        <p className="field-help" style={{ marginTop: 8 }}>
          值已由服务端脱敏，浏览器拿不到明文；命令只显示名称，不含绝对路径。
        </p>
      </div>
    </div>
  );
}

function mcpEndpointSummary(server: McpServer): string {
  if (server.url) return server.url;
  if (server.command) return `本地命令 ${server.command}`;
  return "配置不完整：既没有 url 也没有 command";
}

function provenanceLabel(skill: Skill): string {
  return skill.provenance === "bundled" ? "内置" : "自定义";
}

/** frontmatter 里 version 有写 "2.2.0" 也有写 "v2.2.0"，统一由渲染处补前缀。 */
function stripLeadingV(version: string): string {
  return version.startsWith("v") || version.startsWith("V") ? version.slice(1) : version;
}

function filterList<T>(
  list: T[],
  keyword: string,
  status: StatusFilter,
  statusOf: (item: T) => CapabilityStatus,
  searchTextOf: (item: T) => string,
): T[] {
  const q = keyword.trim().toLowerCase();
  return list.filter((item) => {
    const matchKeyword = !q || searchTextOf(item).toLowerCase().includes(q);
    const matchStatus = status === "all" || statusOf(item) === status;
    return matchKeyword && matchStatus;
  });
}
