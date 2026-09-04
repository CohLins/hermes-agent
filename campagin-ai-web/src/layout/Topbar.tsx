import { useLocation } from "react-router-dom";
import { MOCK_BADGE, PRODUCT_NAME, WORKSPACE_NAME } from "@/constants";
import { breadcrumbTitle } from "./navItems";

export default function Topbar() {
  const location = useLocation();
  const title = breadcrumbTitle(location.pathname);

  return (
    <header className="topbar">
      <div className="crumb">
        <span>{PRODUCT_NAME}</span>
        <span>/</span>
        <strong>{title}</strong>
      </div>
      <div className="top-actions">
        <span className="pill">{MOCK_BADGE}</span>
        <div className="workspace">
          <i className="status-dot" />
          {WORKSPACE_NAME}
        </div>
      </div>
    </header>
  );
}
