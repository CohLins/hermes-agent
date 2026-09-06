import { useMemo, useState } from "react";
import { App, Button, Dropdown, Input, Modal, Skeleton } from "antd";
import { EllipsisOutlined, PlusOutlined } from "@ant-design/icons";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { deleteSession, renameSession } from "@/api/agent";
import { CURRENT_USER, PRODUCT_MARK, PRODUCT_NAME } from "@/constants";
import { useSession } from "@/contexts/useSession";
import { useAuth } from "@/contexts/useAuth";
import { activeNavKey, navItems, navLabels } from "./navItems";
import type { AgentSession } from "@/types/agent";

const DAY = 86_400;

/** 服务端给的是 unix 秒（last_active / started_at），分组在前端现算。 */
function groupOf(session: AgentSession): string {
  const at = session.last_active ?? session.started_at;
  if (!at) return "更早";
  const startOfToday = new Date().setHours(0, 0, 0, 0) / 1000;
  if (at >= startOfToday) return "今天";
  if (at >= startOfToday - 6 * DAY) return "最近 7 天";
  return "更早";
}

const GROUP_ORDER = ["今天", "最近 7 天", "更早"] as const;

/** 服务端不自动生成标题；preview 是首条用户消息前 60 字。 */
function titleOf(session: AgentSession): string {
  return session.title?.trim() || session.preview?.trim() || session.id;
}

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const current = activeNavKey(location.pathname);
  const { sessionId, openSession, sessions, sessionsLoading, refreshSessions, runningSessions } =
    useSession();
  const { user, logout } = useAuth();
  const [keyword, setKeyword] = useState("");
  const [renaming, setRenaming] = useState<AgentSession | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const grouped = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const matched = q
      ? sessions.filter((x) => titleOf(x).toLowerCase().includes(q))
      : sessions;
    return GROUP_ORDER.map((group) => ({
      group,
      items: matched.filter((x) => groupOf(x) === group),
    })).filter((x) => x.items.length > 0);
  }, [sessions, keyword]);

  const goChat = (id: string | null) => {
    openSession(id);
    if (location.pathname !== "/") navigate("/");
  };

  const submitRename = async () => {
    if (!renaming) return;
    const title = draftTitle.trim();
    if (!title) {
      message.warning("标题不能为空");
      return;
    }
    setSaving(true);
    try {
      await renameSession(renaming.id, title);
      setRenaming(null);
      refreshSessions();
      message.success("已重命名");
    } catch (err) {
      // 服务端 title 有唯一约束，重复会返回 400 invalid_title。
      message.error(err instanceof Error ? err.message : "重命名失败");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (session: AgentSession) => {
    modal.confirm({
      title: "删除这个会话？",
      content: `「${titleOf(session)}」的消息记录会一并从 state.db 删除，无法恢复。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteSession(session.id);
          if (sessionId === session.id) openSession(null);
          refreshSessions();
          message.success("已删除");
        } catch (err) {
          message.error(err instanceof Error ? err.message : "删除失败");
        }
      },
    });
  };

  return (
    <aside className="history" data-od-id="conversation-sidebar">
      <div className="brand">
        <div className="brand-mark">{PRODUCT_MARK}</div>
        <span className="brand-name">{PRODUCT_NAME}</span>
      </div>

      <nav className="workspace-nav" data-od-id="module-sidebar">
        <div className="nav-kicker">工作台目录</div>
        {navItems.map((item) => (
          <NavLink
            key={item.key}
            to={item.to}
            className={`nav-item${current === item.key ? " active" : ""}`}
            data-od-id={`nav-${item.key}`}
            // 点「对话首页」就是开一个新对话；要回到某轮历史请点下面的会话条目。
            onClick={item.key === "home" ? () => openSession(null) : undefined}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{navLabels[item.key] ?? item.title}</span>
          </NavLink>
        ))}
      </nav>

      <div className="history-body">
        <div className="history-heading">
          <span>历史对话</span>
          <Button
            size="small"
            type="text"
            icon={<PlusOutlined />}
            onClick={() => goChat(null)}
            disabled={sessionId === null && location.pathname === "/"}
            data-od-id="chat-new"
          >
            新建
          </Button>
        </div>
        <Input
          className="history-search"
          placeholder="搜索历史对话"
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索历史对话"
        />

        {sessionsLoading ? (
          <Skeleton active title={false} paragraph={{ rows: 5 }} style={{ padding: "8px 4px" }} />
        ) : grouped.length === 0 ? (
          <div className="group-label">
            {keyword ? "没有匹配的历史对话。" : "还没有对话，发一条消息就会出现在这里。"}
          </div>
        ) : (
          grouped.map((section) => (
            <div key={section.group}>
              <div className="group-label">{section.group}</div>
              {section.items.map((item) => (
                <div className="chat-item-row" key={item.id}>
                  <button
                    type="button"
                    className={`chat-item${sessionId === item.id ? " active" : ""}`}
                    onClick={() => goChat(item.id)}
                    title={
                      runningSessions.includes(item.id)
                        ? `${titleOf(item)}（后台执行中）`
                        : titleOf(item)
                    }
                  >
                    {/* 切走之后 run 仍在跑，这个点是唯一的可见线索。 */}
                    {runningSessions.includes(item.id) ? (
                      <span className="running-dot" aria-label="执行中" />
                    ) : null}
                    {titleOf(item)}
                  </button>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [
                        { key: "rename", label: "重命名" },
                        { key: "delete", label: "删除", danger: true },
                      ],
                      onClick: ({ key }) => {
                        if (key === "rename") {
                          setRenaming(item);
                          setDraftTitle(item.title?.trim() ?? "");
                        } else {
                          confirmDelete(item);
                        }
                      },
                    }}
                  >
                    <Button
                      size="small"
                      type="text"
                      icon={<EllipsisOutlined />}
                      aria-label="会话操作"
                    />
                  </Dropdown>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="history-foot">
        <div className="user-box">
          <div className="user-avatar">{CURRENT_USER.avatar}</div>
          <div className="user-text">
            <div className="user-name">{user?.email ?? CURRENT_USER.name}</div>
            <button type="button" className="user-role user-logout" onClick={() => void logout()}>
              退出登录
            </button>
          </div>
          <NavLink to="/settings" className="nav-icon user-settings" aria-label="打开设置">
            设
          </NavLink>
        </div>
      </div>

      <Modal
        title="重命名会话"
        open={renaming !== null}
        onCancel={() => setRenaming(null)}
        onOk={submitRename}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
      >
        <Input
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onPressEnter={submitRename}
          placeholder="输入新的会话标题"
          maxLength={120}
          aria-label="会话标题"
        />
        <p style={{ marginTop: 8, marginBottom: 0, color: "var(--muted)" }}>
          标题在 state.db 里是唯一的，与已有会话重名会保存失败。
        </p>
      </Modal>
    </aside>
  );
}
