import { useMemo, useState } from "react";
import { App, Button, Input, Modal, Select, Tabs } from "antd";
import { listMcps, listSkills } from "@/api/capability";
import LoadState from "@/components/LoadState";
import Markdown from "@/components/Markdown";
import PageHead from "@/components/PageHead";
import StatusPill from "@/components/StatusPill";
import { toneOfCapabilityStatus } from "@/components/statusTone";
import EmptyBlock from "@/components/EmptyBlock";
import { useAsync } from "@/hooks/useAsync";
import type { McpServer, Skill } from "@/types";

type TabKey = "skill" | "mcp";
type StatusFilter = "all" | "enabled" | "pending";

export default function CapabilityPage() {
  const { message } = App.useApp();
  const [tab, setTab] = useState<TabKey>("skill");
  // 搜索与筛选是页面级状态，切 Tab 时保留（plan.md 验收项）。
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [activeSkill, setActiveSkill] = useState<Skill>();
  const [activeMcp, setActiveMcp] = useState<McpServer>();

  const skillState = useAsync(listSkills, []);
  const mcpState = useAsync(listMcps, []);

  const filteredSkills = useMemo(
    () => filterList(skillState.data ?? [], keyword, status, (x) => x.status),
    [skillState.data, keyword, status],
  );
  const filteredMcps = useMemo(
    () => filterList(mcpState.data ?? [], keyword, status, (x) => x.status),
    [mcpState.data, keyword, status],
  );

  const clearFilters = () => {
    setKeyword("");
    setStatus("all");
  };

  const refresh = () => {
    skillState.reload();
    mcpState.reload();
    message.success("列表已刷新，仍为本地模拟数据");
  };

  return (
    <section data-od-id="view-capability">
      <PageHead
        eyebrow="CAPABILITIES"
        title="能力管理"
        desc="在同一页面切换 Skill 与 MCP，查看能力说明和配置状态。"
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
          placeholder="搜索名称或描述"
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索名称或描述"
        />
        <Select<StatusFilter>
          value={status}
          onChange={setStatus}
          style={{ width: 150 }}
          options={[
            { value: "all", label: "全部状态" },
            { value: "enabled", label: "已启用" },
            { value: "pending", label: "待配置" },
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
                  key={item.id}
                  type="button"
                  className="card"
                  data-od-id={`skill-card-${item.id}`}
                  onClick={() => setActiveSkill(item)}
                >
                  <div className="card-top">
                    <h3>{item.name}</h3>
                    <StatusPill tone={toneOfCapabilityStatus(item.status)}>{item.status}</StatusPill>
                  </div>
                  <p className="card-desc">{item.description}</p>
                  <div className="meta-row">
                    <span className="num">{item.version}</span>
                    <span>{item.scene}</span>
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
              title="没有匹配的能力"
              desc="请调整关键词或清除筛选后重试。"
              action={<Button onClick={clearFilters}>清除筛选</Button>}
            />
          ) : (
            <div className="cards" data-od-id="mcp-cards">
              {filteredMcps.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="card"
                  data-od-id={`mcp-card-${item.id}`}
                  onClick={() => setActiveMcp(item)}
                >
                  <div className="card-top">
                    <h3>{item.name}</h3>
                    <StatusPill tone={toneOfCapabilityStatus(item.status)}>{item.status}</StatusPill>
                  </div>
                  <p className="card-desc">{item.description}</p>
                  <div className="meta-row">
                    <span>{item.configSummary}</span>
                    <span>最近检查 {item.lastCheckedAt}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </LoadState>
      )}

      <Modal
        open={!!activeSkill}
        onCancel={() => setActiveSkill(undefined)}
        footer={null}
        width={760}
        title={
          <div>
            <p className="eyebrow">SKILL DETAIL</p>
            <h2 style={{ fontSize: 22 }}>{activeSkill?.name}</h2>
          </div>
        }
      >
        {activeSkill ? (
          <>
            <div className="meta-row" style={{ marginBottom: 12 }}>
              <span className="num">{activeSkill.version}</span>
              <span>{activeSkill.scene}</span>
              <StatusPill tone={toneOfCapabilityStatus(activeSkill.status)}>{activeSkill.status}</StatusPill>
            </div>
            <div style={{ maxHeight: "60vh", overflow: "auto" }}>
              <Markdown>{activeSkill.markdown}</Markdown>
            </div>
          </>
        ) : null}
      </Modal>

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
        {activeMcp ? (
          <div style={{ maxHeight: "60vh", overflow: "auto" }}>
            <div className="detail-block">
              <h3>功能描述</h3>
              <p>{activeMcp.description}</p>
            </div>
            <div className="detail-block">
              <h3>连接状态</h3>
              <p>
                <StatusPill tone={toneOfCapabilityStatus(activeMcp.status)}>{activeMcp.status}</StatusPill>
                {"\u3000"}最近检查：{activeMcp.lastCheckedAt}
              </p>
              {activeMcp.status === "待配置" ? (
                <p style={{ marginTop: 8 }}>
                  该 MCP 尚未完成配置，Agent 暂时无法调用；阶段一不提供真实连接。
                </p>
              ) : null}
            </div>
            <div className="detail-block">
              <h3>所需权限</h3>
              <p>{activeMcp.permissions.join(" · ")}</p>
            </div>
            <div className="detail-block">
              <h3>配置方式</h3>
              <p>{activeMcp.configSummary}</p>
              <div className="code" style={{ marginTop: 10 }}>
                {activeMcp.connection.map((x) => `${x.key} = ${x.value}`).join("\n")}
              </div>
              <p className="field-help" style={{ marginTop: 8 }}>
                敏感值默认遮蔽，阶段一不保存任何密钥。
              </p>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

function filterList<T extends { name: string; description: string }>(
  list: T[],
  keyword: string,
  status: StatusFilter,
  statusOf: (item: T) => string,
): T[] {
  const q = keyword.trim().toLowerCase();
  return list.filter((item) => {
    const matchKeyword = !q || `${item.name}${item.description}`.toLowerCase().includes(q);
    const matchStatus =
      status === "all" || (status === "enabled" ? statusOf(item) === "已启用" : statusOf(item) === "待配置");
    return matchKeyword && matchStatus;
  });
}
