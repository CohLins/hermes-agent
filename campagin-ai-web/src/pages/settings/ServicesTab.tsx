import { useState } from "react";
import { App } from "antd";
import { listServiceConfigs, parseServiceConfig, saveServiceConfig } from "@/api/settings";
import BrandTabs from "@/components/BrandTabs";
import JsonConfigPanel from "@/components/JsonConfigPanel";
import LoadState from "@/components/LoadState";
import Panel from "@/components/Panel";
import StatusPill from "@/components/StatusPill";
import { useAsync } from "@/hooks/useAsync";
import type { ServiceConfig } from "@/types";

export default function ServicesTab() {
  const { message } = App.useApp();
  const state = useAsync(listServiceConfigs, []);
  const [brand, setBrand] = useState("au");
  const [saving, setSaving] = useState(false);

  const current = (state.data ?? []).find((x) => x.brand === brand) ?? state.data?.[0];

  return (
    <Panel className="settings-panel" odId="service-config-panel">
      <div className="settings-panel-head">
        <div>
          <h3>服务配置</h3>
          <p>按品牌维护服务配置 JSON，切换品牌后编辑对应品牌的服务名。</p>
        </div>
        <StatusPill tone="success">
          {current ? `${current.config.service_name.length} 个服务` : "本地 Mock"}
        </StatusPill>
      </div>
      <LoadState loading={state.loading} error={state.error} onRetry={state.reload} rows={6}>
        {current ? (
          <>
            <BrandTabs
              items={(state.data ?? []).map((x) => ({ brand: x.brand, label: x.label }))}
              value={current.brand}
              onChange={setBrand}
              odId="brand-tabs"
            />
            <JsonConfigPanel<ServiceConfig>
              value={current.config}
              label={`${current.label} · JSON 服务配置`}
              footnote="service_name 取日志中的 app_name；Agent 会优先在这里配置的品牌与服务中路由查询。"
              parse={parseServiceConfig}
              saving={saving}
              odId="service-json-input"
              onError={(msg) => message.error(msg)}
              onSave={async (next) => {
                setSaving(true);
                try {
                  await saveServiceConfig(current.brand, next);
                  message.success(`${current.label} 服务配置已保存`);
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
