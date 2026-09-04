import { Tabs } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import PageHead from "@/components/PageHead";
import PersonalTab from "./PersonalTab";
import ProjectsTab from "./ProjectsTab";
import ServicesTab from "./ServicesTab";
import TopicsTab from "./TopicsTab";
import type { SettingsTabKey } from "@/types";

const TABS: { key: SettingsTabKey; label: string }[] = [
  { key: "personal", label: "个人配置" },
  { key: "topics", label: "Topic 配置" },
  { key: "services", label: "服务配置" },
  { key: "projects", label: "项目配置" },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const active = (TABS.find((x) => x.key === tab)?.key ?? "personal") as SettingsTabKey;

  return (
    <section data-od-id="view-settings">
      <PageHead
        eyebrow="PREFERENCES"
        title="设置"
        desc="集中管理个人配置、服务范围与 Agent 的项目上下文。全部内容为本地 Mock。"
      />
      <Tabs
        activeKey={active}
        onChange={(key) => navigate(`/settings/${key}`)}
        items={TABS.map((x) => ({ key: x.key, label: x.label }))}
        data-od-id="settings-tabs"
      />
      {active === "personal" ? <PersonalTab /> : null}
      {active === "topics" ? <TopicsTab /> : null}
      {active === "services" ? <ServicesTab /> : null}
      {active === "projects" ? <ProjectsTab /> : null}
    </section>
  );
}
