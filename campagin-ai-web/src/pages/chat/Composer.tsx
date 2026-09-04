import { useState } from "react";
import { Button, Input, Tooltip } from "antd";
import { ArrowUpOutlined, StopOutlined } from "@ant-design/icons";
import SlashMenu from "./SlashMenu";
import { filterCommands, parseCommand, slashQuery, type SlashCommand } from "./slashCommands";
import type { KeyboardEvent, ReactNode } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** 普通提问、以及已敲完的本地命令都走这里，由 chat 页判断分流。 */
  onSend: () => void;
  /** 执行中点按钮触发：abort 前端流 + POST /v1/runs/{id}/stop。 */
  onStop: () => void;
  sending: boolean;
  placeholder: string;
  hint: string;
  /** 底栏左侧的模型指示 / 切换器。 */
  modelSlot?: ReactNode;
}

/** 输入框里那条命令提示条的内容。 */
interface CommandBadge {
  known: boolean;
  name: string;
  label: string;
  note: string;
}

/**
 * @param menuHasMatches 下拉菜单此刻是否有候选项。
 *
 * 只有菜单正在给候选时才让位给它（用户还在敲 `/sk`，两处都提示会打架）。
 * 菜单空了就必须由提示条接手报错 —— 否则像 `/reset` 这种「hermes 有、
 * 本平台没有」的命令，在按下 Enter 之前完全没有任何警告，看起来就像
 * 一条普通消息，一发出去模型就会把它演一遍。
 */
function commandBadge(value: string, menuHasMatches: boolean): CommandBadge | null {
  const text = value.trim();
  if (!text.startsWith("/")) return null;

  const parsed = parseCommand(text);
  if (!parsed && slashQuery(text) !== null && menuHasMatches) return null;

  if (!parsed) {
    return {
      known: false,
      name: text.split(/\s+/)[0],
      label: "不是本平台的命令",
      note: "hermes 的斜杠命令在这条通道上不生效，Enter 会被拦下",
    };
  }
  const { cmd, arg } = parsed;
  if (cmd.takesArg && !arg.trim()) {
    return {
      known: true,
      name: `/${cmd.name}`,
      label: cmd.label,
      note: `还缺参数 —— ${cmd.hint.split("——")[0].trim()}`,
    };
  }
  return {
    known: true,
    name: `/${cmd.name}`,
    label: cmd.kind === "action" ? cmd.label : "提问模板",
    note: cmd.kind === "action" ? "Enter 在本地执行，不会发给 agent" : "Enter 发送给 agent",
  };
}

/**
 * Enter 发送、Shift + Enter 换行。
 * 执行中按钮切成「中断」，输入框仍可打字，但 Enter 不发送。
 *
 * 斜杠命令的交互：`/` 唤出菜单 → ↑↓ 选择 → Enter/Tab **只填充到输入框**
 * （不直接执行，给用户一次确认和改参数的机会）→ 再按 Enter 才执行。
 * 输入框上方会出现一条提示，说明这条命令会不会发给 agent。
 */
export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  sending,
  placeholder,
  hint,
  modelSlot,
}: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const query = slashQuery(value);
  const matches = query === null ? [] : filterCommands(query);
  const menuOpen = query !== null && !dismissed;
  // 过滤后列表变短，高亮可能越界。渲染期钳制，不用 effect 同步 state。
  const safeIndex = matches.length === 0 ? 0 : Math.min(activeIndex, matches.length - 1);
  const badge = commandBadge(value, matches.length > 0);

  const change = (next: string) => {
    // 重新敲出 `/` 时要让菜单回来，所以每次输入都解除手动关闭。
    if (dismissed) setDismissed(false);
    if (activeIndex !== 0) setActiveIndex(0);
    onChange(next);
  };

  /** 选中只填充，绝不直接执行 —— 误触一条 /new 会把当前会话丢掉。 */
  const pick = (cmd: SlashCommand) => {
    setActiveIndex(0);
    // 直接调 onChange（不走 change），dismissed 保持 true，菜单收起。
    setDismissed(true);
    if (cmd.kind === "template") {
      onChange(cmd.template ?? "");
      return;
    }
    onChange(cmd.takesArg ? `/${cmd.name} ` : `/${cmd.name}`);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((safeIndex + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((safeIndex - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        pick(matches[safeIndex]);
        return;
      }
    }
    if (menuOpen && e.key === "Escape") {
      e.preventDefault();
      setDismissed(true);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sending) onSend();
    }
  };

  return (
    <div className="composer-wrap">
      {menuOpen ? (
        <SlashMenu
          commands={matches}
          activeIndex={safeIndex}
          onPick={pick}
          onHover={setActiveIndex}
        />
      ) : null}

      <div className="composer" data-od-id="chat-composer">
        {badge ? (
          <div
            className={`composer-cmd${badge.known ? "" : " unknown"}`}
            data-od-id="chat-command-badge"
          >
            <code>{badge.name}</code>
            <span className="composer-cmd-label">{badge.label}</span>
            <span className="composer-cmd-note">{badge.note}</span>
          </div>
        ) : null}

        <Input.TextArea
          value={value}
          onChange={(e) => change(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoSize={{ minRows: 2, maxRows: 8 }}
          aria-label="输入想查询的问题"
          className={badge ? "is-command" : undefined}
        />
        <div className="composer-foot">
          {modelSlot}
          <span className="composer-hint">
            {sending
              ? "执行中 · Enter 已暂停，可点右侧中断"
              : menuOpen
                ? "命令模式 · ↑↓ 选择，Enter/Tab 填入，Esc 退出"
                : hint}
          </span>
          {sending ? (
            <Tooltip title="中断本轮执行">
              <Button
                type="primary"
                danger
                shape="circle"
                icon={<StopOutlined />}
                onClick={onStop}
                aria-label="中断"
              />
            </Tooltip>
          ) : (
            <Button
              type="primary"
              shape="circle"
              icon={<ArrowUpOutlined />}
              onClick={onSend}
              aria-label="发送"
            />
          )}
        </div>
      </div>
    </div>
  );
}
