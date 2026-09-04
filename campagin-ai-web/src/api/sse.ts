/**
 * api_server 的 SSE 解析器。
 *
 * 不能用 EventSource：它不支持自定义请求头，而所有端点都要 Authorization
 * （_handle_runs 走 @_admit_api_agent_request → _check_auth）。这里用
 * fetch + ReadableStream 手工拆帧。
 *
 * 服务端报文格式（_handle_run_events，api_server.py:5157-5187）：
 *
 *   data: {"event":"tool.started","run_id":"run_ab12",...}\n\n
 *   : keepalive\n\n        ← 30s 无事件时的注释行
 *   : stream closed\n\n    ← 结束标记，随后连接关闭
 *
 * 注意：没有 `event:` 字段，事件类型在 JSON 的 event 键里；也没有
 * `done`/`error` 事件，终态是 run.completed / run.failed / run.cancelled。
 */

const FRAME_SEPARATOR = /\r?\n\r?\n/;

/**
 * 把字节流解成一个个 JSON 事件对象。
 *
 * 跨 chunk 的半截帧留在缓冲里；注释行（以 `:` 开头）和无法解析的 data 直接跳过，
 * 不让一条坏帧终止整个流。
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 最后一段可能是半截帧，留到下一轮。
      const frames = buffer.split(FRAME_SEPARATOR);
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const parsed = parseFrame(frame);
        if (parsed !== undefined) yield parsed;
      }
    }

    // 流结束时缓冲里可能还剩一帧（服务端没补上尾部空行）。
    buffer += decoder.decode();
    const tail = parseFrame(buffer);
    if (tail !== undefined) yield tail;
  } finally {
    // AbortController 中断时 reader 已被 cancel，这里再调一次是幂等的。
    reader.cancel().catch(() => undefined);
  }
}

/** 取一帧里所有 data: 行拼起来解析；注释行与空帧返回 undefined。 */
function parseFrame(frame: string): unknown {
  const lines = frame.split(/\r?\n/);
  const payload = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!payload) return undefined;
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}
