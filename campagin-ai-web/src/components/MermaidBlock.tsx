import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Modal } from "antd";
import { copyText } from "@/utils/clipboard";

type MermaidApi = (typeof import("mermaid"))["default"];

/**
 * 流式输出时图定义是半截的（`flowchart TD` 后面只写了一半），
 * 每来一个 chunk 都渲染既费 CPU 又会把半截语法判成语法错误。
 * 等它安静 480ms 再渲染 —— 模型输出 chunk 间隔远小于这个值，
 * 所以实际效果是「一段图写完了才画」。
 */
const SETTLE_MS = 480;

let loading: Promise<MermaidApi> | null = null;

/**
 * mermaid 整包压缩后仍有数百 KB，用动态 import 让 Vite 切成独立 chunk：
 * 没有图的会话永远不会下载它。initialize 全局只能生效一次，所以跟着
 * 单例 promise 一起做。
 */
function loadMermaid(): Promise<MermaidApi> {
  loading ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      // 我们自己调 render，不让它开机扫描 DOM。
      startOnLoad: false,
      // strict 会让 DOMPurify 过一遍产出的 SVG。图定义里的 <br/>、<b>
      // 这类标签在白名单内，仍然能用 —— 模型很爱用 <br/> 换行。
      securityLevel: "strict",
      // 内置 default 主题是紫蓝配色，和这套浅灰 + 品牌红的界面打架。
      // base + themeVariables 是官方推荐的换色方式。
      theme: "base",
      themeVariables: {
        background: "#ffffff",
        primaryColor: "#f7f8fa",
        primaryTextColor: "#1f1f1f",
        primaryBorderColor: "#c9cdd6",
        secondaryColor: "#fff1f0",
        secondaryTextColor: "#1f1f1f",
        secondaryBorderColor: "#f0a6a2",
        tertiaryColor: "#fafbfc",
        tertiaryTextColor: "#4b5563",
        tertiaryBorderColor: "#e3e6eb",
        mainBkg: "#f7f8fa",
        nodeBorder: "#c9cdd6",
        clusterBkg: "#fafbfc",
        clusterBorder: "#e3e6eb",
        lineColor: "#8b93a3",
        textColor: "#1f1f1f",
        titleColor: "#697386",
        edgeLabelBackground: "#ffffff",
        errorBkgColor: "#fff1f0",
        errorTextColor: "#cf1322",
        fontFamily: '"Ant Sans", "Alibaba PuHuiTi", Inter, Arial, sans-serif',
        fontSize: "13px",
      },
      // htmlLabels 保持默认开启（flowchart-v2 渲染器本身也不认 false）。
      // 节点标签因此走 foreignObject，里面是真的 HTML —— 这意味着
      // .markdown 的排版规则会渗进去把标签撑爆，必须在 CSS 里隔离，
      // 见 global.css 的 `.mermaid-canvas foreignObject` 重置。
      flowchart: { curve: "basis", padding: 14, nodeSpacing: 44, rankSpacing: 52 },
      sequence: { actorMargin: 40, wrap: true },
      gantt: { axisFormat: "%m-%d" },
      // 图里不写主题指令时上面这套才生效；写了 %%{init}%% 就听它的。
      wrap: true,
    });
    return mermaid;
  });
  return loading;
}

/** mermaid 的 diagramType 转中文标签，认不出来就直接显示原值。 */
const TYPE_LABEL: Record<string, string> = {
  flowchart: "流程图",
  "flowchart-v2": "流程图",
  graph: "流程图",
  sequence: "时序图",
  classDiagram: "类图",
  stateDiagram: "状态图",
  "stateDiagram-v2": "状态图",
  er: "ER 图",
  gantt: "甘特图",
  pie: "饼图",
  journey: "用户旅程",
  gitGraph: "Git 分支图",
  mindmap: "思维导图",
  timeline: "时间线",
  quadrantChart: "四象限",
  requirement: "需求图",
  c4: "C4 架构图",
  sankey: "桑基图",
  xychart: "XY 图表",
  block: "块状图",
  packet: "报文图",
  architecture: "架构图",
  radar: "雷达图",
  treemap: "矩形树图",
  kanban: "看板",
};

function typeLabel(type: string): string {
  if (!type) return "图表";
  return TYPE_LABEL[type] ?? type;
}

/**
 * 从 mermaid 产出的 SVG 里读出它自己算的原始尺寸。
 *
 * mermaid v11 不写 width/height 属性，只留 viewBox 和内联的
 * `style="max-width: NNNpx"`。原始宽度决定了「缩进容器里还能不能看清字」，
 * 所以必须拿到手 —— 见 CSS 里 --mermaid-nat 的用法。
 */
function svgSize(svg: string): { w: number; h: number } {
  // 时序图的 viewBox 起点是负数（`viewBox="-50 -10 630 470"`），
  // 前两个数不能写死成 0 0。
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  if (box) return { w: Math.round(Number(box[1])), h: Math.round(Number(box[2])) };
  const max = /max-width:\s*([\d.]+)px/.exec(svg);
  return { w: max ? Math.round(Number(max[1])) : 0, h: 0 };
}

/** 三档缩放。100% / 200% 都以 svgSize() 读出的原始宽度为基准。 */
const ZOOMS = [
  { key: "fit", label: "适应宽度" },
  { key: "100", label: "100%" },
  { key: "200", label: "200%" },
] as const;

interface Props {
  code: string;
  /** 本轮回答还在流出。半截图定义只显示占位，不报语法错。 */
  streaming?: boolean;
}

/**
 * ```mermaid 代码块渲染成图。
 *
 * 三种可见状态：
 * - 有 SVG → 显示图，头部给「源码 / 放大 / 复制」
 * - 还没渲染出来（流式中，或第一次 480ms 还没到）→ 骨架条
 * - 语法确实有问题且不在流式中 → 降级成带错误说明的源码块
 *
 * 「已经画出来过、随后新内容让语法暂时不合法」时**保留旧图**，
 * 因为半张图也比一段红字有用。
 */
export default function MermaidBlock({ code, streaming }: Props) {
  const rawId = useId();
  const [svg, setSvg] = useState("");
  const [diagramType, setDiagramType] = useState("");
  const [error, setError] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]["key"]>("fit");
  const [copied, setCopied] = useState(false);
  // 每次重渲染 +1，async 回调靠它判断自己的结果是否已过期。
  const seq = useRef(0);

  useEffect(() => {
    const text = code.trim();
    if (!text) return;
    seq.current += 1;
    const mine = seq.current;
    let alive = true;
    // useId 产出的是 `:r3:` 这种带冒号的串，mermaid 会拿它当 CSS 选择器用，
    // 冒号会让选择器失效，必须洗掉。加 mine 保证同一个块重渲染时 id 不撞。
    const domId = `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, "")}-${mine}`;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const mermaid = await loadMermaid();
          // 先 parse 验语法：render 遇到错误会往 body 里插官方那张红色报错图，
          // parse 只抛异常，副作用干净。顺带拿到 diagramType 做头部标签。
          const parsed = await mermaid.parse(text);
          const { svg: out } = await mermaid.render(domId, text);
          if (!alive || seq.current !== mine) return;
          setSvg(out);
          setDiagramType(typeof parsed === "object" ? parsed.diagramType : "");
          setError("");
        } catch (err) {
          if (!alive || seq.current !== mine) return;
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    }, SETTLE_MS);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [code, rawId]);

  const copy = () => {
    void copyText(code).then((ok) => {
      setCopied(ok);
      if (ok) window.setTimeout(() => setCopied(false), 1600);
    });
  };

  // 一次都没画出来 + 语法不合法 + 回答已经写完 → 这图是真的有问题。
  const broken = svg === "" && error !== "" && !streaming;
  const size = svg === "" ? { w: 0, h: 0 } : svgSize(svg);

  if (broken) {
    return (
      <div className="code-block mermaid-broken">
        <div className="code-head">
          <span className="code-lang">
            <span className="code-icon" aria-hidden>
              ◇
            </span>
            mermaid · 语法未通过
          </span>
          <button type="button" onClick={copy} aria-label="复制图表源码">
            {copied ? "已复制" : "复制"}
          </button>
        </div>
        <p className="mermaid-error">{error}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (svg === "") {
    return (
      <div className="mermaid-block is-pending">
        <div className="mermaid-head">
          <span className="mermaid-kind">
            <span className="code-icon" aria-hidden>
              ◇
            </span>
            图表
          </span>
          <span className="mermaid-pending-note">正在绘制…</span>
        </div>
        <div className="mermaid-skeleton" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  return (
    <div className="mermaid-block">
      <div className="mermaid-head">
        <span className="mermaid-kind">
          <span className="code-icon" aria-hidden>
            ◇
          </span>
          {typeLabel(diagramType)}
          {/* 把原始尺寸摊开说：这就是它在对话列里被缩小的原因，
              也是「放大」这个按钮存在的理由。 */}
          {size.w > 0 ? (
            <span className="mermaid-size">
              {size.w}
              {size.h > 0 ? ` × ${size.h}` : ""}
            </span>
          ) : null}
        </span>
        <div className="mermaid-actions">
          {/* 有图但语法又出错了：图是上一版的，得说清楚，否则用户会以为图是最新的。 */}
          {error && !streaming ? <span className="mermaid-stale">图为上一版</span> : null}
          <button type="button" onClick={() => setShowSource((x) => !x)}>
            {showSource ? "看图" : "源码"}
          </button>
          <button type="button" onClick={() => setZoomOpen(true)}>
            放大
          </button>
          <button type="button" onClick={copy} aria-label="复制图表源码">
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      </div>

      {showSource ? (
        <pre className="mermaid-source">
          <code>{code}</code>
        </pre>
      ) : (
        <div
          className="mermaid-canvas"
          // 整块画布可点即放大 —— 缩在对话列里的宽图靠一个小按钮找放大太别扭。
          onClick={() => setZoomOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setZoomOpen(true);
            }
          }}
          aria-label="放大查看图表"
          // --mermaid-nat 给 CSS 兜一个下限缩放：宽图不会被压到字都认不出，
          // 超出容器的部分横向滚动。
          style={{ "--mermaid-nat": `${size.w}px` } as CSSProperties}
          // mermaid 在 securityLevel strict 下已用 DOMPurify 过滤过这段 SVG。
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}

      <Modal
        open={zoomOpen}
        onCancel={() => setZoomOpen(false)}
        footer={null}
        width="92vw"
        centered
        title={
          <div className="mermaid-zoom-head">
            <span>{typeLabel(diagramType)}</span>
            <div className="mermaid-zoom-scale">
              {ZOOMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={zoom === item.key ? "active" : undefined}
                  onClick={() => setZoom(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        }
        classNames={{ body: "mermaid-zoom-body" }}
      >
        <div
          className={`mermaid-zoom-canvas zoom-${zoom}`}
          style={{ "--mermaid-nat": `${size.w}px` } as CSSProperties}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </Modal>
    </div>
  );
}
