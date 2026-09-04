import { Dropdown, Tooltip } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { isBaseModel } from "@/types/agent";
import type { AgentModel } from "@/types/agent";

interface Props {
  models: AgentModel[];
  /** 用户选中的 alias；null 表示用 config 默认模型。 */
  selected: string | null;
  onSelect: (alias: string | null) => void;
  /** 当前会话真实跑的模型，来自会话行（不是 /v1/models）。 */
  sessionModel?: string;
  disabled: boolean;
}

const CONFIG_PATH = "platforms.api_server.extra.model_routes";

/**
 * 输入框左下角的模型指示 / 切换器。
 *
 * 切换是真机制：`POST /v1/runs` 带 `model: <alias>` → _resolve_route 查
 * model_routes → _create_agent 覆盖 model/provider（api_server.py:1720、1812）。
 * 但可选项完全取决于 config.yaml 里有没有配 `model_routes`：没配时
 * /v1/models 只返回一条基准条目，此时降级成纯展示，并把配置路径提示出来 ——
 * 给一个点了没反应的下拉框是最糟的。
 */
export default function ModelPicker({
  models,
  selected,
  onSelect,
  sessionModel,
  disabled,
}: Props) {
  const routes = models.filter((m) => !isBaseModel(m));
  const picked = selected ? routes.find((m) => m.id === selected) : undefined;

  // 显示优先级：用户选的 alias 的真实模型 → 会话正在用的模型 → 未知。
  const shown = picked?.root ?? picked?.id ?? sessionModel ?? "默认模型";

  if (routes.length === 0) {
    return (
      <Tooltip
        title={
          <span>
            当前只有 config.yaml 的默认模型。要在这里切换，需在
            <code style={{ margin: "0 4px" }}>{CONFIG_PATH}</code>
            下配置 alias，然后重启 gateway —— 配好后这里会自动变成下拉框。
          </span>
        }
      >
        <span className="model-pick static" data-od-id="chat-model">
          <span className="model-dot" />
          {shown}
        </span>
      </Tooltip>
    );
  }

  return (
    <Dropdown
      disabled={disabled}
      trigger={["click"]}
      menu={{
        selectedKeys: [selected ?? "__default__"],
        items: [
          {
            key: "__default__",
            label: (
              <span>
                默认模型
                {sessionModel ? <span className="model-sub">{sessionModel}</span> : null}
              </span>
            ),
          },
          { type: "divider" },
          ...routes.map((m) => ({
            key: m.id,
            label: (
              <span>
                {m.id}
                {m.root && m.root !== m.id ? <span className="model-sub">{m.root}</span> : null}
              </span>
            ),
          })),
        ],
        onClick: ({ key }) => onSelect(key === "__default__" ? null : key),
      }}
    >
      <button
        type="button"
        className="model-pick"
        disabled={disabled}
        data-od-id="chat-model"
        aria-label="切换模型"
      >
        <span className="model-dot" />
        {shown}
        <DownOutlined />
      </button>
    </Dropdown>
  );
}
