/**
 * 每次 run 附带的客户端能力说明，走 `POST /v1/runs` 的 `instructions` 字段
 * → 服务端的 `ephemeral_system_prompt`，追加在基础提示词之后
 * （`agent/conversation_loop.py:581-584`）。只作用于本次 run，不写进 trajectory。
 *
 * 背景：hermes 原来给 api_server 内置的提示词是
 * 「The rendering layer is unknown — assume plain text. No markdown formatting」，
 * 模型严格遵守，于是回答是一整片没有层次的纯文本。已经把上游那条改成「支持
 * Markdown」（`agent/prompt_builder.py` 的 `PLATFORM_HINTS["api_server"]`），
 * 所以排版要求现在由上游承担，这里**只留客户端特有的部分**：
 *
 *   - 兜底：万一上游被回滚、或换了没改过的 hermes 版本，这段还能顶住
 *   - 本客户端独有的取舍（图片尺寸、不支持的语法等）
 *
 * 想只给 web 调提示词（不影响飞书助手）就改这个文件，刷新页面即生效。
 * 想改两边共用的人格与纪律，改 `~/.hermes/profiles/feishu/SOUL.md`，
 * 注意改完要**新建会话**才生效 —— 旧会话会复用 state.db 里存的旧提示词
 * （`agent/conversation_loop.py:353-357`，为了 prefix cache 命中）。
 */
export const WEB_RENDER_INSTRUCTIONS = `## 客户端能力

你正在通过浏览器 Web 界面回复（campagin-ai-web）。这个客户端**完整支持 Markdown**：
标题、粗体、斜体、有序与无序列表、表格、引用、行内代码、带语言标记的代码块
（\`\`\`yaml、\`\`\`bash、\`\`\`sql、\`\`\`json 等）都会被渲染并做语法高亮，代码块自带复制按钮。

如果前面出现过「The rendering layer is unknown / assume plain text / No markdown
formatting」之类的说明，**以本段为准**：本客户端的渲染层是已知的。

## 本客户端的取舍

- 对话列宽约 880px。宽表格会横向滚动，所以列数控制在 5 列以内更好读。
- 长回答请用 \`##\` 分节。不要用「一、」「1.」这类纯文本编号充当标题。
- 接口路径、参数名、类名、方法名、文件路径、commit、配置项、Topic 名一律用行内代码。
- 多行的代码、配置、日志、命令、堆栈用带语言标记的代码块，不要塞进正文段落。
- 流程与步骤用有序列表，一步一行；不要用「→」把长流程串成一个大段落。
- 图片可以用 \`MEDIA:/绝对路径\` 交付，会被内联成 data URL（超过 5MB 的会被跳过）。

## 画图

需要表达流程、调用时序、状态机、数据模型、排期、占比、结构层级时，直接写
\`\`\`mermaid 代码块 —— 本客户端会渲染成真正的图（flowchart、sequenceDiagram、
stateDiagram-v2、erDiagram、gantt、pie、mindmap、gitGraph、timeline 都支持），
读者可以点开放大、也能切回源码。

写 mermaid 的几条硬性要求：

- **节点文字一律用双引号包起来**：\`A["POST /bsn/campaign/opt-in"]\`。不加引号时
  斜杠、括号、逗号、中文顿号都会让解析失败，整张图就退化成一段红色报错。
- 节点内换行用 \`<br/>\`，不要用 \`\\n\`。
- 一张图控制在 25 个节点以内。再复杂就按子域拆成两三张，每张配一句说明 ——
  一张 80 节点的图缩进对话列后谁也看不清。
- 边上的说明文字也要加引号：\`A -- "否" --> B\`、\`A -.->|"异步"| B\`。
- 图只是正文的补充，图前后都要有文字说明，不要甩一张图就完事。

数学公式用 \`$$ ... $$\`（KaTeX 渲染）。单个 \`$\` 不会被当成公式起止符，
所以正文里写「$100」「$5 起」是安全的。

排版是为了让人扫读。宁可多用结构，不要输出大段无层次的文字。`;
