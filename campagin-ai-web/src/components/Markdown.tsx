import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import MermaidBlock from "./MermaidBlock";
import { copyText } from "@/utils/clipboard";

interface Props {
  children: string;
  className?: string;
  /**
   * 内容还在流式写入。传下去给 MermaidBlock：半截图定义只显示占位，
   * 不当成语法错误报红。
   */
  streaming?: boolean;
}

/**
 * 从 `<code class="language-toml">` 里取语言名。
 * rehype-highlight 会额外加 `hljs` 之类的类名，所以只认 `language-` 前缀。
 */
function codeLanguage(node: ReactNode): string {
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  const cls = (node.props as { className?: unknown }).className;
  if (typeof cls !== "string") return "";
  const hit = cls.split(/\s+/).find((x) => x.startsWith("language-"));
  return hit ? hit.slice("language-".length) : "";
}

/** 从 React 子树里抽纯文本，用于复制代码块原文。 */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** 能画成图的代码块语言 → 交给 MermaidBlock，不再当代码展示。 */
const DIAGRAM_LANGS = new Set(["mermaid", "mmd"]);

/** 代码块：语言标签 + 复制按钮的头部栏，正文交回原生 pre。 */
function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = codeLanguage(children);

  const copy = () => {
    void copyText(textOf(children)).then((ok) => {
      setCopied(ok);
      if (ok) window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="code-block">
      <div className="code-head">
        {/* 参考主流 AI 客户端：左侧一个代码标记 + 语言名，右侧复制。 */}
        <span className="code-lang">
          <span className="code-icon" aria-hidden>
            &lt;/&gt;
          </span>
          {lang || "text"}
        </span>
        <button type="button" onClick={copy} aria-label="复制代码">
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

/**
 * 对话回答、知识库正文、skill.md 详情共用的 Markdown 渲染区。
 *
 * 支持的「非纯文本」形态：
 * - GFM：表格、任务列表、删除线、脚注、自动链接
 * - 代码块：highlight.js 语法高亮 + 复制
 * - ```mermaid：渲染成真图（流程图 / 时序图 / 甘特图 / ER 等）
 * - 数学公式：`$$...$$` 块级、`\ce` 之类交给 KaTeX
 */
export default function Markdown({ children, className, streaming }: Props) {
  return (
    <div className={className ? `markdown ${className}` : "markdown"}>
      <ReactMarkdown
        // singleDollarTextMath 关掉是刻意的：这个工作台会大量出现「$100」
        // 「$5 起」这类金额，开着单 $ 会把两个金额之间的正文整段吞成公式。
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[
          // ignoreMissing：回答里常出现 log/jsonl 这类 lowlight 没注册的语言，
          // 默认行为是抛错，会把整段 Markdown 渲染打断。
          [rehypeHighlight, { ignoreMissing: true, detect: true }],
          // 公式写错不该让整段回答渲染失败，出错就原样显示这段 TeX。
          [rehypeKatex, { throwOnError: false, errorColor: "#cf1322" }],
        ]}
        components={{
          pre: ({ children: inner }) =>
            DIAGRAM_LANGS.has(codeLanguage(inner)) ? (
              <MermaidBlock code={textOf(inner)} streaming={streaming} />
            ) : (
              <CodeBlock>{inner}</CodeBlock>
            ),
          // 外链一律新窗口打开，避免把正在跑的会话页面顶掉。
          a: ({ href, children: inner }) => (
            <a
              href={href}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noreferrer noopener" : undefined}
            >
              {inner}
            </a>
          ),
          // 宽表格自己横向滚动，不撑破 880px 的对话列。
          table: ({ children: inner }) => (
            <div className="table-scroll">
              <table>{inner}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
