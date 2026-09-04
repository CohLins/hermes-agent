import type { ThemeConfig } from "antd";

/**
 * 原型 token（index.html:6）到 antd token 的映射。
 * antd 覆盖不到的表面色、暖色选中态、16px 大圆角与焦点环留在 theme/global.css 的 CSS 变量里。
 */
export const tokens = {
  accent: "#d32029",
  surface: "#f7f8fa",
  surfaceWarm: "#fff1f0",
  fg: "#1f1f1f",
  fg2: "#4b5563",
  muted: "#697386",
  border: "#d9dce3",
  borderSoft: "#eef0f4",
  success: "#22a06b",
  warn: "#faad14",
  danger: "#cf1322",
  fontBody: '"Ant Sans","Alibaba PuHuiTi",Inter,Arial,sans-serif',
  fontMono: '"SF Mono",ui-monospace,Menlo,monospace',
} as const;

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: tokens.accent,
    colorSuccess: tokens.success,
    colorWarning: tokens.warn,
    colorError: tokens.danger,
    colorInfo: tokens.accent,

    colorText: tokens.fg,
    colorTextSecondary: tokens.fg2,
    colorTextTertiary: tokens.muted,
    colorTextDescription: tokens.muted,

    colorBorder: tokens.border,
    colorBorderSecondary: tokens.borderSoft,
    colorBgLayout: tokens.surface,
    colorFillAlter: tokens.surface,

    fontFamily: tokens.fontBody,
    fontFamilyCode: tokens.fontMono,
    fontSize: 14,
    lineHeight: 1.52,

    borderRadius: 6,
    borderRadiusLG: 10,
    borderRadiusSM: 6,

    // 原型的按钮与输入统一 38px 高（antd 默认 32）。
    controlHeight: 38,
    controlHeightSM: 32,
    controlHeightLG: 44,

    lineWidthFocus: 4,
    wireframe: false,
  },
  components: {
    Tabs: {
      horizontalItemGutter: 22,
      horizontalItemPadding: "0 2px",
      titleFontSize: 14,
      itemColor: tokens.muted,
      itemHoverColor: tokens.fg,
      itemSelectedColor: tokens.accent,
      inkBarColor: tokens.accent,
    },
    Table: {
      headerBg: "transparent",
      headerColor: tokens.muted,
      headerSplitColor: "transparent",
      borderColor: tokens.borderSoft,
      rowHoverBg: tokens.surface,
      cellPaddingBlock: 13,
      cellPaddingInline: 16,
    },
    Card: { borderRadiusLG: 16, paddingLG: 20 },
    Drawer: { paddingLG: 24 },
    Modal: { borderRadiusLG: 16, paddingContentHorizontalLG: 24 },
    Select: { optionSelectedBg: tokens.surfaceWarm },
    Segmented: { itemSelectedBg: tokens.surfaceWarm, itemSelectedColor: tokens.accent },
    Message: { contentBg: tokens.fg, colorText: tokens.surface },
  },
};
