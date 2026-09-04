import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { antdTheme } from "./theme/antdTheme";
import "antd/dist/reset.css";
// KaTeX 自带样式；放在 global.css 之前，字号/颜色的收敛在 global 里做。
import "katex/dist/katex.min.css";
import "./theme/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("找不到挂载节点 #root");

createRoot(root).render(
  <StrictMode>
    <ConfigProvider theme={antdTheme} locale={zhCN}>
      {/* antd 6 要求通过 App.useApp() 取 message / modal 实例，静态方法拿不到主题上下文。 */}
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
