import { useState } from "react";
import { App } from "antd";
import { listTopicConfigs, parseTopicConfig, saveTopicConfig } from "@/api/settings";
import BrandTabs from "@/components/BrandTabs";
import JsonConfigPanel from "@/components/JsonConfigPanel";
import LoadState from "@/components/LoadState";
import Panel from "@/components/Panel";
import StatusPill from "@/components/StatusPill";
import { useAsync } from "@/hooks/useAsync";
import type { TopicConfig } from "@/types";

export default function TopicsTab() {
  const { message } = App.useApp();
  const state = useAsync(listTopicConfigs, []);
  const [brand, setBrand] = useState("au");
  const [saving, setSaving] = useState(false);

  const current = (state.data ?? []).find((x) => x.brand === brand) ?? state.data?.[0];

  return (
    <Panel className="settings-panel" odId="topic-config-panel">
      <div className="settings-panel-head">
        <div>
          <h3>Topic 配置</h3>
          <p>按品牌维护 Topic、Consumer Group 与积压阈值 JSON。</p>
        </div>
        <StatusPill tone="success">
          {current ? `${current.config.topics.length} 个 Topic` : "本地 Mock"}
        </StatusPill>
      </div>
      <LoadState loading={state.loading} error={state.error} onRetry={state.reload} rows={8}>
        {current ? (
          <>
            <BrandTabs
              items={(state.data ?? []).map((x) => ({ brand: x.brand, label: x.label }))}
              value={current.brand}
              onChange={setBrand}
              odId="topic-brand-tabs"
            />
            <JsonConfigPanel<TopicConfig>
              value={current.config}
              label={`${current.label} · JSON Topic 配置`}
              footnote={
                <>
                  阈值默认为 <span className="num">-1</span>，表示不设置告警阈值；保存只影响当前品牌。
                </>
              }
              parse={parseTopicConfig}
              saving={saving}
              odId="topic-json-input"
              onError={(msg) => message.error(msg)}
              onSave={async (next) => {
                setSaving(true);
                try {
                  await saveTopicConfig(current.brand, next);
                  message.success(`${current.label} Topic 配置已保存`);
                  state.reload();
                } finally {
                  setSaving(false);
                }
              }}
            />
          </>
        ) : null}
      </LoadState>
    </Panel>
  );
}
