import type { SlashCommand } from "./slashCommands";

interface Props {
  commands: SlashCommand[];
  activeIndex: number;
  onPick: (cmd: SlashCommand) => void;
  onHover: (index: number) => void;
}

const KIND_TAG: Record<SlashCommand["kind"], string> = {
  action: "本地命令",
  template: "提问模板",
};

/**
 * 输入 `/` 时弹出的命令面板。
 *
 * 用 onMouseDown 而不是 onClick：onClick 在 textarea 失焦之后才触发，
 * 那时输入框已经收起菜单，点不中。
 */
export default function SlashMenu({ commands, activeIndex, onPick, onHover }: Props) {
  if (commands.length === 0) {
    return (
      <div className="slash-menu" data-od-id="chat-slash-menu">
        <div className="slash-empty">没有匹配的命令。直接输入问题即可提问。</div>
      </div>
    );
  }

  return (
    <div className="slash-menu" data-od-id="chat-slash-menu" role="listbox">
      <div className="slash-note">
        hermes 的 <code>/compact</code>、<code>/undo</code> 等命令在这条通道上不生效，
        下面这些才会真正执行。
      </div>
      {commands.map((cmd, i) => (
        <button
          key={cmd.kind + cmd.name}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          className={`slash-item${i === activeIndex ? " active" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(cmd);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span className="slash-name">
            /{cmd.name}
            {cmd.takesArg ? " …" : ""}
          </span>
          <span className="slash-label">{cmd.label}</span>
          <span className={`slash-kind ${cmd.kind}`}>{KIND_TAG[cmd.kind]}</span>
          <span className="slash-hint">{cmd.hint}</span>
        </button>
      ))}
      <div className="slash-foot">↑↓ 选择 · Enter/Tab 确认 · Esc 关闭</div>
    </div>
  );
}
