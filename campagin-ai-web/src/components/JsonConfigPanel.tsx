import { Button, Input, Space } from "antd";
import { useState } from "react";
import type { ReactNode } from "react";

interface Props<T> {
  /** 当前配置对象，序列化后填入编辑区。 */
  value: T;
  label: string;
  footnote: ReactNode;
  /** 保存前的校验与反序列化；抛错时错误信息直接提示给用户。 */
  parse: (raw: string) => T;
  onSave: (next: T) => Promise<void> | void;
  onError: (message: string) => void;
  odId?: string;
  saving?: boolean;
}

/**
 * Topic 配置、服务配置与项目 JSON 共用的编辑面板：
 * 默认只读，点「编辑」后可改，保存前先校验 JSON（原型里这段逻辑写了三遍）。
 */
export default function JsonConfigPanel<T>({
  value,
  label,
  footnote,
  parse,
  onSave,
  onError,
  odId,
  saving,
}: Props<T>) {
  const serialized = JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(serialized);
  const [editing, setEditing] = useState(false);
  const [lastSerialized, setLastSerialized] = useState(serialized);

  // 切换品牌或外部数据刷新时重置编辑态：在渲染期比较上一次的值，
  // 而不是放到 effect 里同步 setState（React 官方的 props 变化调整状态写法）。
  if (lastSerialized !== serialized) {
    setLastSerialized(serialized);
    setDraft(serialized);
    setEditing(false);
  }

  const save = async () => {
    try {
      const next = parse(draft);
      await onSave(next);
      setEditing(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : "JSON 格式有误，请检查后重试");
    }
  };

  return (
    <>
      <div className="json-wrap">
        <div className="json-label">
          <span>{label}</span>
          <span>{editing ? "编辑中 · 保存前会校验格式" : "只读 · 点击编辑后可修改"}</span>
        </div>
        <Input.TextArea
          className="json-editor"
          data-od-id={odId}
          value={draft}
          readOnly={!editing}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={label}
          autoSize={{ minRows: 14 }}
        />
      </div>
      <p className="json-footnote">{footnote}</p>
      <div className="config-actions">
        <Space>
          {editing ? (
            <Button
              onClick={() => {
                setDraft(serialized);
                setEditing(false);
              }}
            >
              取消
            </Button>
          ) : (
            <Button onClick={() => setEditing(true)}>编辑</Button>
          )}
          <Button type="primary" onClick={save} disabled={!editing} loading={saving}>
            保存
          </Button>
        </Space>
      </div>
    </>
  );
}
