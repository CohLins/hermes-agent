export interface DocSection {
  id: string;
  title: string;
  body: string;
}

/**
 * 把文章 Markdown 按二级标题切成小节：
 * 中间栏「文章目录」用小节标题，右侧正文按小节渲染，点击目录滚动到对应小节。
 */
export function parseSections(markdown: string): DocSection[] {
  const lines = markdown.split("\n");
  const sections: DocSection[] = [];
  let current: DocSection | undefined;

  for (const line of lines) {
    const match = /^##\s+(.*)$/.exec(line);
    if (match) {
      current = { id: `section-${sections.length}`, title: match[1].trim(), body: "" };
      sections.push(current);
      continue;
    }
    if (current) {
      current.body += `${line}\n`;
    }
  }

  if (sections.length === 0) {
    return [{ id: "section-0", title: "正文", body: markdown }];
  }
  return sections.map((x) => ({ ...x, body: x.body.trim() }));
}
