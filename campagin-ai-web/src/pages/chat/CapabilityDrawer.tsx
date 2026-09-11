import { useMemo, useState } from "react";
import { Drawer, Empty, Input, Tabs, Tag } from "antd";
import { getCapabilities, listToolsets } from "@/api/agent";
import { listSkills } from "@/api/capability";
import LoadState from "@/components/LoadState";
import { useAsync } from "@/hooks/useAsync";
import type { AgentCapabilities } from "@/types/agent";
import type { Skill } from "@/types/capability";

export type CapabilityTab = "skills" | "toolsets" | "runtime";

interface Props {
  open: boolean;
  tab: CapabilityTab;
  onTabChange: (tab: CapabilityTab) => void;
  onClose: () => void;
  /** 当前会话真实使用的模型（来自会话行，不是 /v1/models）。 */
  sessionModel?: string | null;
}

/**
 * `/skills`、`/tools`、`/model` 打开的能力面板。
 *
 * 数据全部来自 api_server 的只读端点，与飞书助手是同一个 profile：
 *   /v1/skills      profile 的 skills/ 目录
 *   /v1/toolsets    api_server 这个 platform 实际解析出的工具集
 *   /v1/capabilities 运行时信息
 * 59 个技能 / 25 组工具集塞不进聊天气泡，所以单独开抽屉并支持搜索。
 */
export default function CapabilityDrawer({
  open,
  tab,
  onTabChange,
  onClose,
  sessionModel,
}: Props) {
  const [keyword, setKeyword] = useState("");

  // open 作为 deps：抽屉关掉再打开会重新拉，能反映 profile 侧的改动。
  const skills = useAsync<Skill[]>(() => (open ? listSkills() : Promise.resolve([])), [open]);
  const toolsets = useAsync(() => (open ? listToolsets() : Promise.resolve([])), [open]);
  const caps = useAsync<AgentCapabilities>(
    () => (open ? getCapabilities() : Promise.resolve({})),
    [open],
  );

  const q = keyword.trim().toLowerCase();

  const skillGroups = useMemo(() => {
    const matched = (skills.data ?? []).filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.category ?? "").toLowerCase().includes(q),
    );
    const byCategory = new Map<string, typeof matched>();
    for (const skill of matched) {
      const key = skill.category ?? "其他";
      const list = byCategory.get(key) ?? [];
      list.push(skill);
      byCategory.set(key, list);
    }
    return [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [skills.data, q]);

  const toolsetList = useMemo(() => {
    const matched = (toolsets.data ?? []).filter(
      (t) =>
        !q ||
        t.name.toLowerCase().includes(q) ||
        (t.label ?? "").toLowerCase().includes(q) ||
        (t.tools ?? []).some((x) => x.toLowerCase().includes(q)),
    );
    // 启用的排前面，一眼看到 agent 实际有什么。
    return [...matched].sort((a, b) => Number(b.enabled) - Number(a.enabled));
  }, [toolsets.data, q]);

  const enabledCount = (toolsets.data ?? []).filter((t) => t.enabled).length;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      destroyOnHidden
      title={
        <div>
          <p className="eyebrow">AGENT CAPABILITY</p>
          <h2 style={{ fontSize: 22 }}>能力清单</h2>
        </div>
      }
    >
      <p className="cap-note">
        与飞书助手同一个 profile，技能与 MCP 是共享的同一份。
      </p>

      <Tabs
        activeKey={tab}
        onChange={(key) => onTabChange(key as CapabilityTab)}
        items={[
          {
            key: "skills",
            label: `技能 ${skills.data ? skills.data.length : ""}`,
            children: (
              <LoadState loading={skills.loading} error={skills.error} onRetry={skills.reload}>
                <Input
                  allowClear
                  placeholder="搜索技能名、说明或分类"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  style={{ marginBottom: 14 }}
                  aria-label="搜索技能"
                />
                {skillGroups.length === 0 ? (
                  <Empty description="没有匹配的技能" />
                ) : (
                  skillGroups.map(([category, items]) => (
                    <div className="cap-group" key={category}>
                      <div className="cap-group-head">
                        <span>{category}</span>
                        <span className="num">{items.length}</span>
                      </div>
                      {items.map((skill) => (
                        <div className="cap-row" key={skill.name}>
                          <code>{skill.name}</code>
                          <p>{skill.description || "（无说明）"}</p>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </LoadState>
            ),
          },
          {
            key: "toolsets",
            label: `工具集 ${toolsets.data ? `${enabledCount}/${toolsets.data.length}` : ""}`,
            children: (
              <LoadState
                loading={toolsets.loading}
                error={toolsets.error}
                onRetry={toolsets.reload}
              >
                <Input
                  allowClear
                  placeholder="搜索工具集或具体工具名"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  style={{ marginBottom: 14 }}
                  aria-label="搜索工具"
                />
                {toolsetList.length === 0 ? (
                  <Empty description="没有匹配的工具集" />
                ) : (
                  toolsetList.map((ts) => (
                    <div className={`cap-row toolset${ts.enabled ? " on" : ""}`} key={ts.name}>
                      <code>{ts.label || ts.name}</code>
                      <Tag color={ts.enabled ? "success" : "default"}>
                        {ts.enabled ? "已启用" : "未启用"}
                      </Tag>
                      <p>
                        {(ts.tools ?? []).length > 0
                          ? (ts.tools ?? []).join(" · ")
                          : ts.description || "（无工具）"}
                      </p>
                    </div>
                  ))
                )}
              </LoadState>
            ),
          },
          {
            key: "runtime",
            label: "运行时",
            children: (
              <LoadState loading={caps.loading} error={caps.error} onRetry={caps.reload}>
                <div className="cap-row">
                  <code>会话模型</code>
                  <p>{sessionModel || "（还没有会话，发一条消息后可见）"}</p>
                </div>
                <div className="cap-row">
                  <code>profile</code>
                  <p>
                    {caps.data?.profile || "—"}
                    <br />
                    <span className="cap-sub">
                      技能、MCP 和 config 都读这个 profile；profile 之间不继承。
                    </span>
                  </p>
                </div>
                <div className="cap-row">
                  <code>对外模型名</code>
                  <p>
                    {caps.data?.model || "—"}
                    <br />
                    <span className="cap-sub">
                      /v1/models 对外暴露的名字。没配 API_SERVER_MODEL_NAME 时它回的是
                      profile 名，不是真实模型 —— 真实模型看上面的会话模型。
                    </span>
                  </p>
                </div>
                <div className="cap-row">
                  <code>执行模式</code>
                  <p>
                    {caps.data?.runtime?.mode || "—"} · 工具在
                    {caps.data?.runtime?.tool_execution === "server" ? "服务端" : "客户端"}执行
                  </p>
                </div>
                <div className="cap-row">
                  <code>鉴权</code>
                  <p>
                    {caps.data?.auth?.required ? "需要" : "不需要"}
                    {caps.data?.auth?.type ? ` · ${caps.data.auth.type}` : ""}
                    <br />
                    <span className="cap-sub">请求头由 dev server 注入，浏览器不持有 key。</span>
                  </p>
                </div>
                <div className="cap-group">
                  <div className="cap-group-head">
                    <span>服务端特性</span>
                  </div>
                  <div className="cap-features">
                    {Object.entries(caps.data?.features ?? {}).map(([name, on]) => (
                      <Tag key={name} color={on ? "success" : "default"}>
                        {name}
                      </Tag>
                    ))}
                  </div>
                </div>
              </LoadState>
            ),
          },
        ]}
      />
    </Drawer>
  );
}
