/**
 * 检测 agent 在正文里索要口头确认。
 *
 * 这**不是** approval.request 事件（那是 hermes 的审批机制，有独立弹窗）。
 * 这是模型自己在回答里等确认 —— profile 的 SOUL.md 第 7 行要求：
 *   「仅在执行有副作用的操作前先说明计划并等待明确确认：修改/创建/删除数据、
 *     给他人发送消息、创建或修改定时任务、执行终端命令、写入或修改文件。」
 * 而 terminal 不在「只读类操作可直接执行」那一条的白名单里，所以哪怕是只读的
 * 终端查询也会走到这里，出现频率很高，值得给一键确认。
 *
 * 检测必须保守：宁可漏掉，也不要每条回答下面都冒出一排按钮。
 */

/** 只看最后一段：长报告中间提到「确认」的句子非常多，不能当成在问用户。 */
function lastParagraph(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);
  return paragraphs[paragraphs.length - 1] ?? "";
}

/** 是在向用户提要求，而不是在陈述「已确认/未确认」。 */
const REQUEST_MARKERS = [/请/, /是否/, /需要我/, /要不要/, /确认后/, /等待(你|您)/];

/** 确认语义本体。 */
const CONFIRM_PATTERNS = [
  /请(明确)?(回复|确认|批准|授权)/,
  /请确认/,
  // 「请检查 X 后回复确认」这类，请字后面隔了别的动词。
  /回复(确认|继续|同意)/,
  /是否(继续|执行|需要)/,
  /需要我(继续|执行)/,
  /要不要(继续|执行)/,
  /确认后(我)?(将|会|再)/,
  /等待(你|您)(的)?确认/,
];

/** 排除陈述句：这些出现时即便命中上面的词也不算在问用户。 */
const NEGATIVE_PATTERNS = [/已确认/, /未确认前/, /无需确认/, /不需要确认/];

export interface ConfirmRequest {
  /** 点「确认」时发出去的文本。模型指定了原话就用原话。 */
  phrase: string;
  /** 命中的最后一段，用于 tooltip 说明为什么出现这排按钮。 */
  excerpt: string;
}

/**
 * 模型常写成「请明确回复"确认执行"」——它在等这个确切字符串，
 * 回一句别的可能不被接受。所以引号里的原话优先。
 */
function quotedPhrase(paragraph: string): string {
  const hit = paragraph.match(/[「『“"']([^」』”"'\n]{2,20})[」』”"']/);
  if (!hit) return "";
  const inner = hit[1].trim();
  // 只在引号内容本身像确认语时才采用，避免把「请检查"config.yaml"」当成确认词。
  return /确认|继续|执行|同意|批准|可以/.test(inner) ? inner : "";
}

export function detectConfirmRequest(answer: string): ConfirmRequest | null {
  const text = (answer ?? "").trim();
  if (!text) return null;

  const tail = lastParagraph(text);
  if (!tail || tail.length > 220) return null; // 最后一段是长篇结论时不认

  if (NEGATIVE_PATTERNS.some((re) => re.test(tail))) return null;
  if (!REQUEST_MARKERS.some((re) => re.test(tail))) return null;
  if (!CONFIRM_PATTERNS.some((re) => re.test(tail))) return null;

  return { phrase: quotedPhrase(tail) || "确认，继续", excerpt: tail };
}

/** 拒绝时发出去的文本，固定值。 */
export const DECLINE_PHRASE = "先不要执行，请说明你打算做什么再等我确认。";
