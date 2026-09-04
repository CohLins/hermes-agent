import { useMemo, useState } from "react";
import { Input } from "antd";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { CURRENT_USER, PRODUCT_MARK, PRODUCT_NAME } from "@/constants";
import { useAsync } from "@/hooks/useAsync";
import { listChatSessions } from "@/api/chat";
import { activeNavKey, navItems, navLabels } from "./navItems";
import type { ChatSession } from "@/types";

const GROUP_ORDER: ChatSession["group"][] = ["今天", "最近 7 天", "更早"];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const current = activeNavKey(location.pathname);
  const [keyword, setKeyword] = useState("");
  const [activeSession, setActiveSession] = useState("s1");
  const { data: sessions } = useAsync(listChatSessions, []);

  const grouped = useMemo(() => {
    const all = sessions ?? [];
    const q = keyword.trim().toLowerCase();
    const matched = q ? all.filter((x) => x.title.toLowerCase().includes(q)) : all;
    return GROUP_ORDER.map((group) => ({
      group,
      items: matched.filter((x) => x.group === group),
    })).filter((x) => x.items.length > 0);
  }, [sessions, keyword]);

  return (
    <aside className="history" data-od-id="conversation-sidebar">
      <div className="brand">
        <div className="brand-mark">{PRODUCT_MARK}</div>
        <span className="brand-name">{PRODUCT_NAME}</span>
        <span className="brand-meta">Mock</span>
      </div>

      <nav className="workspace-nav" data-od-id="module-sidebar">
        <div className="nav-kicker">工作台目录</div>
        {navItems.map((item) => (
          <NavLink
            key={item.key}
            to={item.to}
            className={`nav-item${current === item.key ? " active" : ""}`}
            data-od-id={`nav-${item.key}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{navLabels[item.key] ?? item.title}</span>
          </NavLink>
        ))}
      </nav>

      <div className="history-body">
        <div className="history-heading">历史对话</div>
        <Input
          className="history-search"
          placeholder="搜索历史对话"
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索历史对话"
        />
        {grouped.length === 0 ? (
          <div className="group-label">没有匹配的历史对话，试试开始一次新查询。</div>
        ) : (
          grouped.map((section) => (
            <div key={section.group}>
              <div className="group-label">{section.group}</div>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`chat-item${activeSession === item.id ? " active" : ""}`}
                  onClick={() => {
                    setActiveSession(item.id);
                    navigate("/");
                  }}
                >
                  {item.title}
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="history-foot">
        <div className="user-box">
          <div className="user-avatar">{CURRENT_USER.avatar}</div>
          <div className="user-text">
            <div className="user-name">{CURRENT_USER.name}</div>
            <div className="user-role">{CURRENT_USER.role}</div>
          </div>
          <NavLink to="/settings" className="nav-icon user-settings" aria-label="打开设置">
            设
          </NavLink>
        </div>
      </div>
    </aside>
  );
}
