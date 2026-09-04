import { useState } from "react";
import { App, Button, Input, Modal } from "antd";
import { listProjects, parseProjectConfig, saveProject } from "@/api/settings";
import EmptyBlock from "@/components/EmptyBlock";
import LoadState from "@/components/LoadState";
import Panel from "@/components/Panel";
import StatusPill from "@/components/StatusPill";
import { projectTemplate } from "@/mock/projects";
import { useAsync } from "@/hooks/useAsync";

interface Editor {
  /** null 表示新增项目。 */
  index: number | null;
  draft: string;
}

export default function ProjectsTab() {
  const { message } = App.useApp();
  const state = useAsync(listProjects, []);
  const [editor, setEditor] = useState<Editor>();
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      const next = parseProjectConfig(editor.draft);
      await saveProject(editor.index, next);
      message.success(editor.index === null ? "项目已添加" : "项目配置已保存");
      setEditor(undefined);
      state.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "JSON 格式有误，请检查后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel className="settings-panel" odId="project-config-panel">
      <div className="settings-panel-head">
        <div>
          <h3>项目配置</h3>
          <p>每个项目独立维护服务、业务识别词与代码检索范围。</p>
        </div>
        <Button
          type="primary"
          onClick={() => setEditor({ index: null, draft: JSON.stringify(projectTemplate, null, 2) })}
        >
          ＋ 新增项目
        </Button>
      </div>

      <LoadState loading={state.loading} error={state.error} onRetry={state.reload} rows={8}>
        {(state.data ?? []).length === 0 ? (
          <EmptyBlock title="暂无项目配置" desc="点击「新增项目」补充第一个项目。" />
        ) : (
          <div className="project-grid">
            {(state.data ?? []).map((item, index) => (
              <article className="project-card" key={item.project} data-od-id={`project-card-${item.project}`}>
                <div className="project-card-head">
                  <div>
                    <h3>{item.project}</h3>
                    <div className="project-key">项目标识 · {String(index + 1).padStart(2, "0")}</div>
                  </div>
                  <StatusPill tone="success">已配置</StatusPill>
                </div>
                <div className="project-card-body">
                  <div className="project-field">
                    <span className="project-field-label">服务</span>
                    <div className="project-services">
                      {item.service_name.map((x) => (
                        <span key={x}>{x}</span>
                      ))}
                    </div>
                  </div>
                  <div className="project-field">
                    <span className="project-field-label">品牌与别名</span>
                    <div className="project-tags">
                      {[...item.brands, ...item.aliases].map((x) => (
                        <span className="project-tag" key={x}>
                          {x}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="project-field">
                    <span className="project-field-label">业务域</span>
                    <div className="project-tags">
                      {item.domains.map((x) => (
                        <span className="project-tag" key={x}>
                          {x}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="project-card-foot">
                  <span>
                    {item.git.branch || "未设置分支"} · {item.log_skill || "未设置日志 Skill"}
                  </span>
                  <Button
                    size="small"
                    onClick={() => setEditor({ index, draft: JSON.stringify(item, null, 2) })}
                  >
                    查看 JSON
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </LoadState>

      <Modal
        open={!!editor}
        title={editor?.index === null ? "新增项目" : "项目 JSON"}
        okText={editor?.index === null ? "添加项目" : "保存 JSON"}
        cancelText="取消"
        confirmLoading={saving}
        width={760}
        onCancel={() => setEditor(undefined)}
        onOk={submit}
        destroyOnHidden
      >
        <p className="json-note">
          {editor?.index === null
            ? "补充一个项目对象，保存后会加入当前页面的项目列表。"
            : "可复制当前配置进行补充；JSON 仅用于本地 Mock 展示。"}
        </p>
        <Input.TextArea
          className="json-editor"
          data-od-id="project-json-input"
          value={editor?.draft ?? ""}
          spellCheck={false}
          autoSize={{ minRows: 16 }}
          onChange={(e) => setEditor((prev) => (prev ? { ...prev, draft: e.target.value } : prev))}
          aria-label="项目配置 JSON"
        />
      </Modal>
    </Panel>
  );
}
