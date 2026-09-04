import { useMemo, useState } from "react";
import { App, Button, Input } from "antd";
import { useNavigate } from "react-router-dom";
import { listKnowledgeCollections } from "@/api/knowledge";
import EmptyBlock from "@/components/EmptyBlock";
import LoadState from "@/components/LoadState";
import { useAsync } from "@/hooks/useAsync";
import { knowledgeDocs } from "@/mock/knowledge";

export default function KnowledgePage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const state = useAsync(listKnowledgeCollections, []);
  const [keyword, setKeyword] = useState("");

  const cards = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return (state.data ?? []).filter(
      (x) => !q || `${x.name}${x.desc}${x.type}`.toLowerCase().includes(q),
    );
  }, [state.data, keyword]);

  const open = (collectionId: string) => {
    const first = knowledgeDocs[collectionId]?.[0]?.docs[0];
    navigate(`/knowledge/${collectionId}/${first?.id ?? ""}`);
  };

  return (
    <section data-od-id="view-knowledge">
      <div className="kb-head">
        <div>
          <p className="eyebrow">KNOWLEDGE BASE</p>
          <h1 className="page-title" data-od-id="knowledge-title">
            知识库
          </h1>
          <p className="page-desc">集中沉淀项目文档与领域知识，打开卡片后从分层目录实时阅读 Markdown。</p>
        </div>
        <div className="kb-head-actions">
          <Input
            className="kb-search"
            data-od-id="knowledge-search"
            placeholder="搜索项目或领域文档"
            allowClear
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            aria-label="搜索项目或领域文档"
          />
          <Button
            data-od-id="knowledge-new-document"
            onClick={() => message.info("阶段一不提供新建文档，正文来自本地 Mock")}
          >
            ＋ 新建文档
          </Button>
        </div>
      </div>

      <LoadState loading={state.loading} error={state.error} onRetry={state.reload}>
        {cards.length === 0 ? (
          <EmptyBlock
            title="没有匹配的知识库内容"
            desc="请调整关键词后重试。"
            action={<Button onClick={() => setKeyword("")}>清除搜索</Button>}
          />
        ) : (
          <div className="kb-cards" data-od-id="knowledge-card-grid">
            {cards.map((item) => (
              <button
                key={item.id}
                type="button"
                className="kb-card"
                data-od-id={`knowledge-card-${item.id}`}
                onClick={() => open(item.id)}
              >
                <div className="kb-card-top">
                  <span className="kb-card-icon">▤</span>
                  <span className="pill">{item.type}</span>
                </div>
                <h3>{item.name}</h3>
                <p>{item.desc}</p>
                <div className="kb-card-foot">
                  <span>{item.count} 篇文档</span>
                  <span>{item.updated}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </LoadState>
    </section>
  );
}
