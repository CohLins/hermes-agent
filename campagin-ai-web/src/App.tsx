import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Skeleton } from "antd";
import AppShell from "@/layout/AppShell";
import SessionProvider from "@/contexts/SessionProvider";

// 页面按路由懒加载：antd 与 Markdown 渲染器不会全部压进首屏 chunk。
const ChatPage = lazy(() => import("@/pages/chat"));
const CapabilityPage = lazy(() => import("@/pages/capability"));
const ObservePage = lazy(() => import("@/pages/observe"));
const KnowledgePage = lazy(() => import("@/pages/knowledge"));
const KnowledgeReader = lazy(() => import("@/pages/knowledge/Reader"));
const TasksPage = lazy(() => import("@/pages/tasks"));
const AlertsPage = lazy(() => import("@/pages/alerts"));
const SettingsPage = lazy(() => import("@/pages/settings"));

function PageFallback() {
  return (
    <div style={{ padding: 8 }}>
      <Skeleton active title={{ width: 260 }} paragraph={{ rows: 6 }} />
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <Suspense fallback={<PageFallback />}>
              <ChatPage />
            </Suspense>
          }
        />
        <Route
          path="capability"
          element={
            <Suspense fallback={<PageFallback />}>
              <CapabilityPage />
            </Suspense>
          }
        />
        <Route
          path="observe/:tab?"
          element={
            <Suspense fallback={<PageFallback />}>
              <ObservePage />
            </Suspense>
          }
        />
        <Route
          path="knowledge"
          element={
            <Suspense fallback={<PageFallback />}>
              <KnowledgePage />
            </Suspense>
          }
        />
        <Route
          path="knowledge/:collection/:docId"
          element={
            <Suspense fallback={<PageFallback />}>
              <KnowledgeReader />
            </Suspense>
          }
        />
        <Route
          path="tasks"
          element={
            <Suspense fallback={<PageFallback />}>
              <TasksPage />
            </Suspense>
          }
        />
        <Route
          path="alerts"
          element={
            <Suspense fallback={<PageFallback />}>
              <AlertsPage />
            </Suspense>
          }
        />
        <Route
          path="settings/:tab?"
          element={
            <Suspense fallback={<PageFallback />}>
              <SettingsPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      </Routes>
    </SessionProvider>
  );
}
