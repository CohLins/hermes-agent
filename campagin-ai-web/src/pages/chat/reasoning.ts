export interface ReasoningStep {
  title: string;
  body: string;
}

/**
 * 把 reasoning summary 拆成步骤。
 *
 * 这里拿到的**不是思维链**，是 provider 返回的推理摘要（reasoning_content）：
 * 固定英文、每步一个粗体标题、紧挨着不换行，例如
 *   `**Drafting brief acknowledgment**` + `**Planning concise response**`
 * 当 Markdown 渲染会把相邻标题并成一个粗体块，所以按粗体标记切成步骤列表。
 *
 * String.split 带捕获组会返回交错数组：[前缀, 标题1, 正文1, 标题2, 正文2, …]。
 */
export function parseReasoningSteps(text: string): ReasoningStep[] {
  const parts = text.split(/\*\*(.+?)\*\*/gs);
  const steps: ReasoningStep[] = [];
  const lead = parts[0]?.trim();
  if (lead) steps.push({ title: "", body: lead });
  for (let i = 1; i < parts.length; i += 2) {
    steps.push({ title: parts[i].trim(), body: (parts[i + 1] ?? "").trim() });
  }
  // 完全没有粗体标记时（少数 provider）原样当一段。
  return steps.length > 0 ? steps : [{ title: "", body: text.trim() }];
}
