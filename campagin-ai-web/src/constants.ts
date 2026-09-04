/** 产品标识：后续改名只动这里。 */
export const PRODUCT_NAME = "Atlas Agent";
export const PRODUCT_MARK = "A";
/** 阶段一全部数据为本地 Mock，页面统一用这个文案标注。 */
export const MOCK_BADGE = "示例数据 · 本地演示";
export const WORKSPACE_NAME = "研发工作区";

export const CURRENT_USER = {
  name: "林晓",
  avatar: "林",
  role: "研发 · 单一工作区",
  email: "lin.xiao@example.local",
} as const;

/** 可观测与查询类页面共用的时间范围快捷项。 */
export const TIME_RANGES = ["最近 15 分钟", "最近 30 分钟", "最近 2 小时", "最近 24 小时"] as const;
export const DEFAULT_TIME_RANGE = "最近 30 分钟";
