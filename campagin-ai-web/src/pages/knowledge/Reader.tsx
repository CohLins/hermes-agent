import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { getKnowledgeCollection, getKnowledgeFolders } from "@/api/knowledge";
import LoadState from "@/components/LoadState";
import Markdown from "@/components/Markdown";
import StatusPill from "@/components/StatusPill";
import { useAsync } from "@/hooks/useAsync";
import { parseSections } from "./sections";
import type { KnowledgeFolder } from "@/types";

const FOLDER_STORAGE_KEY = "atlas-knowledge-expanded-folders";
const LAST_FOLDER_KEY = "atlas-knowledge-folder";
const LAST_DOC_KEY = "atlas-knowledge-doc";

/** 在集合的文件夹树里定位一篇文章。 */
function locateDoc(folders: KnowledgeFolder[] | undefined, docId: string) {
  for (const folder of folders ?? []) {
    const doc = folder.docs.find((x) => x.id === docId);
    if (doc) return { folder, doc };
  }
  return undefined;
}

function readExpanded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(FOLDER_STORAGE_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export default function KnowledgeReader() {
  const { collection = "", docId = "" } = useParams();
  const navigate = useNavigate();
  const folders = useAsync(() => getKnowledgeFolders(collection), [collection]);
  const info = useAsync(() => getKnowledgeCollection(collection), [collection]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(readExpanded);
  const [activeSection, setActiveSection] = useState("section-0");
  const documentRef = useRef<HTMLElement>(null);

  const located = locateDoc(folders.data, docId);
  const sections = located ? parseSections(located.doc.body) : [];

  // 切换文章时把目录高亮和滚动位置复位（渲染期比较上一篇，不在 effect 里同步 setState）。
  const [lastDocId, setLastDocId] = useState(docId);
  if (lastDocId !== docId) {
    setLastDocId(docId);
    setActiveSection("section-0");
  }

  // 记住最近阅读位置，刷新后仍回到同一篇；滚动复位属于对 DOM 的同步，放在 effect 里。
  useEffect(() => {
    if (!located) return;
    localStorage.setItem(LAST_FOLDER_KEY, located.folder.id);
    localStorage.setItem(LAST_DOC_KEY, located.doc.id);
    if (documentRef.current) documentRef.current.scrollTop = 0;
  }, [located]);

  const toggleFolder = (folderId: string) => {
    const key = `${collection}:${folderId}`;
    const next = { ...expanded, [key]: isCollapsed(key) };
    setExpanded(next);
    localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(next));
  };

  /** 默认展开：只有显式记录为 false 时才折叠。 */
  const isCollapsed = (key: string) => expanded[key] === false;

  const jumpTo = (sectionId: string) => {
    setActiveSection(sectionId);
    const pane = documentRef.current;
    const target = pane?.querySelector(`#${sectionId}`) as HTMLElement | null;
    if (pane && target) {
      pane.scrollTop = target.offsetTop - pane.offsetTop - 16;
    }
  };

  if (!folders.loading && !folders.error && (folders.data ?? []).length === 0) {
    return <Navigate to="/knowledge" replace />;
  }

  return (
    <section data-od-id="view-knowledge-reader">
      <LoadState loading={folders.loading || info.loading} error={folders.error} onRetry={folders.reload} rows={8}>
        {located ? (
          <div className="kb-reader" data-od-id="knowledge-reader">
            <aside className="kb-sidebar" data-od-id="knowledge-article-tree">
              <div className="kb-tree-title">{info.data?.name ?? "知识库"}</div>
              <button type="button" className="kb-tree-back" onClick={() => navigate("/knowledge")}>
                ← 返回知识库
              </button>
              <div className="kb-article-tree">
                {(folders.data ?? []).map((folder) => {
                  const key = `${collection}:${folder.id}`;
                  const collapsed = isCollapsed(key);
                  return (
                    <div className={`kb-doc-group${collapsed ? " is-collapsed" : ""}`} key={folder.id}>
                      <button
                        type="button"
                        className="kb-folder-label"
                        aria-expanded={!collapsed}
                        data-od-id={`knowledge-folder-${folder.id}`}
                        onClick={() => toggleFolder(folder.id)}
                      >
                        <span className="kb-caret">{collapsed ? "▸" : "▾"}</span>
                        {folder.name}
                      </button>
                      {folder.docs.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          className={`kb-article-link${doc.id === docId ? " active" : ""}`}
                          data-od-id={`knowledge-doc-${doc.id}`}
                          onClick={() => navigate(`/knowledge/${collection}/${doc.id}`)}
                        >
                          {doc.title}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </aside>

            <aside className="kb-sidebar outline" data-od-id="knowledge-outline-sidebar">
              <div className="kb-outline-title">文章目录</div>
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={`kb-outline-link${activeSection === section.id ? " active" : ""}`}
                  onClick={() => jumpTo(section.id)}
                >
                  {section.title}
                </button>
              ))}
            </aside>

            <article className="kb-document" ref={documentRef} data-od-id="knowledge-markdown-preview">
              <div className="kb-document-head">
                <div>
                  <p className="eyebrow">{info.data?.type ?? "文档"} · Markdown</p>
                  <h2>{located.doc.title}</h2>
                  <p className="kb-document-meta">
                    {info.data?.name} / {located.folder.name} / {located.doc.category}
                  </p>
                </div>
                <StatusPill tone="success">已同步</StatusPill>
              </div>
              <div className="kb-markdown">
                {sections.map((section, index) => (
                  <section key={section.id} id={section.id} data-od-id={`knowledge-section-${index}`}>
                    <h3>{section.title}</h3>
                    <Markdown>{section.body}</Markdown>
                  </section>
                ))}
              </div>
            </article>
          </div>
        ) : (
          <Navigate to="/knowledge" replace />
        )}
      </LoadState>
    </section>
  );
}
