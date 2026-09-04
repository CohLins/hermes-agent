export interface NavItem {
  key: string;
  /** 侧栏与面包屑共用的标题。 */
  title: string;
  to: string;
  /** 路由前缀，用于判断当前选中项。 */
  match: string;
  icon: string;
}

/** 顺序与设计原型侧栏一致（原型把知识库插在服务可观测之后）。 */
export const navItems: NavItem[] = [
  { key: "home", title: "对话首页", to: "/", match: "/", icon: "A" },
  { key: "capability", title: "能力管理", to: "/capability", match: "/capability", icon: "◇" },
  { key: "observe", title: "服务可观测", to: "/observe", match: "/observe", icon: "O" },
  { key: "knowledge", title: "知识库", to: "/knowledge", match: "/knowledge", icon: "▤" },
  { key: "tasks", title: "定时任务管理", to: "/tasks", match: "/tasks", icon: "□" },
  { key: "alerts", title: "告警管理", to: "/alerts", match: "/alerts", icon: "!" },
  { key: "settings", title: "设置", to: "/settings", match: "/settings", icon: "设" },
];

/** 侧栏里「能力管理」按原型文案显示为 skill/mcp 管理，面包屑仍用「能力管理」。 */
export const navLabels: Record<string, string> = {
  capability: "skill/mcp管理",
};

export function activeNavKey(pathname: string): string {
  if (pathname === "/") return "home";
  const hit = navItems.find((x) => x.match !== "/" && pathname.startsWith(x.match));
  return hit?.key ?? "home";
}

export function breadcrumbTitle(pathname: string): string {
  const key = activeNavKey(pathname);
  return navItems.find((x) => x.key === key)?.title ?? "对话首页";
}
