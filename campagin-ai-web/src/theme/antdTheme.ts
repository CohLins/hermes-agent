import type { ThemeConfig } from "antd";

/**
 * 原型 token（index.html:6）到 antd token 的映射。
 * antd 覆盖不到的表面色、暖色选中态、16px 大圆角与焦点环留在 theme/global.css 的 CSS 变量里。
 */
export const tokens = {
  accent: "#2383e2",
  surface: "#ffffff",
  surfaceWarm: "#eef6ff",
  fg: "#37352f",
  fg2: "#5f5e5b",
  muted: "#787774",
  border: "#e9e9e7",
  borderSoft: "#f0f0ee",
  success: "#0f7b6c",
  warn: "#cb912f",
  danger: "#d44c47",
  fontBody: '"Inter","PingFang SC","Microsoft YaHei",Arial,sans-serif',
  fontMono: '"SF Mono",ui-monospace,Menlo,monospace',
} as const;

export const antdTheme: ThemeConfig = {
  token: {
    colorBgBase: "#ffffff",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#ffffff",
    colorFill: "#f1f1ef",
    colorFillSecondary: "#f7f7f5",
    colorFillTertiary: "#fbfbfa",
    colorPrimary: tokens.accent,
    colorPrimaryHover: "#0b6dcc",
    colorPrimaryActive: "#1b6fc1",
    colorSuccess: tokens.success,
    colorWarning: tokens.warn,
    colorError: tokens.danger,
    colorInfo: tokens.accent,

    colorText: tokens.fg,
    colorTextSecondary: tokens.fg2,
    colorTextTertiary: tokens.muted,
    colorTextDescription: tokens.muted,
    colorIcon: tokens.fg2,
    colorIconHover: tokens.fg,

    colorBorder: tokens.border,
    colorBorderSecondary: tokens.borderSoft,
    colorBgLayout: "#f7f7f5",
    colorFillAlter: "#f7f7f5",

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
    Button: { primaryShadow: "none", defaultShadow: "none" },
    Collapse: { contentBg: "transparent", headerBg: "transparent" },
    Input: { activeBorderColor: tokens.accent, hoverBorderColor: tokens.accent },
    Modal: {
      borderRadiusLG: 10,
      paddingContentHorizontalLG: 24,
      contentBg: "#ffffff",
      headerBg: "#ffffff",
      footerBg: "#ffffff",
    },
    Select: { optionSelectedBg: tokens.surfaceWarm },
    Segmented: { itemSelectedBg: tokens.surfaceWarm, itemSelectedColor: tokens.accent },
    Message: { contentBg: tokens.fg, colorText: "#ffffff" },
  },
};
