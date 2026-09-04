import { useState } from "react";
import { App, Collapse } from "antd";
import { Link } from "react-router-dom";
import { getChatSuggestions, sendChatMessage } from "@/api/chat";
import { CURRENT_USER, PRODUCT_MARK } from "@/constants";
import { useAsync } from "@/hooks/useAsync";
import Composer from "./Composer";
import type { ChatAnswer } from "@/types";

interface Turn {
  id: number;
  question: string;
  answer?: ChatAnswer;
  error?: string;
}

export default function ChatPage() {
  const { message } = App.useApp();
  const { data: suggestions } = useAsync(getChatSuggestions, []);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);

  const send = async () => {
    const question = input.trim();
    if (!question) {
      message.warning("请先输入想查询的问题");
      return;
    }
    const id = Date.now();
    setTurns((prev) => [...prev, { id, question }]);
    setInput("");
    setSending(true);
    try {
      const answer = await sendChatMessage(question);
      setTurns((prev) => prev.map((x) => (x.id === id ? { ...x, answer } : x)));
    } catch (err) {
      setTurns((prev) =>
        prev.map((x) =>
          x.id === id ? { ...x, error: err instanceof Error ? err.message : "查询失败，请重试" } : x,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  const retry = async (turn: Turn) => {
    setInput(turn.question);
    setTurns((prev) => prev.filter((x) => x.id !== turn.id));
  };

  if (turns.length === 0) {
    return (
      <section data-od-id="view-home">
        <div className="welcome" data-od-id="chat-empty">
          <p className="eyebrow">AGENT WORKSPACE</p>
          <h1>今天，想先排查什么问题？</h1>
          <p>用自然语言查询日志、定位异常，或快速了解服务运行状态。</p>
          <div className="suggestion-cards" data-od-id="chat-suggestions">
            {(suggestions ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                className="suggestion-card"
                data-od-id={`chat-suggestion-${item.id}`}
                onClick={() => setInput(item.question)}
              >
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
                <div className="suggestion-card-foot">
                  <span className="suggestion-card-meta">{item.meta}</span>
                  <span className="suggestion-card-hint">填入问题 →</span>
                </div>
              </button>
            ))}
          </div>
          <Composer
            value={input}
            onChange={setInput}
            onSend={send}
            sending={sending}
            placeholder="描述你遇到的问题，例如：支付服务刚才是否有集中报错？"
            hint="Enter 发送 · Shift + Enter 换行"
          />
        </div>
      </section>
    );
  }

  return (
    <section data-od-id="view-home">
      <div className="chat-thread" data-od-id="chat-result">
        {turns.map((turn) => (
          <div key={turn.id}>
            <div className="message user">
              <div className="bubble">{turn.question}</div>
            </div>

            {!turn.answer && !turn.error ? (
              <div className="tool-row">正在调用能力执行模拟查询…</div>
            ) : null}

            {turn.error ? (
              <div className="message">
                <div className="user-avatar">{PRODUCT_MARK}</div>
                <div className="bubble">
                  <div className="agent-label">查询失败</div>
                  <p>{turn.error}</p>
                  <p>
                    <button type="button" className="suggestion" onClick={() => retry(turn)}>
                      重新填入问题
                    </button>
                  </p>
                </div>
              </div>
            ) : null}

            {turn.answer ? (
              <>
                <div className="tool-row">
                  <Collapse
                    ghost
                    size="small"
                    items={[
                      {
                        key: "tools",
                        label: (
                          <span>
                            已调用 {turn.answer.tools.length} 个能力{"\u3000"}
                            {turn.answer.tools.map((x) => x.name).join(" · ")}{"\u3000"}
                            <span className="num">{turn.answer.elapsed}</span>
                          </span>
                        ),
                        children: (
                          <div>
                            {turn.answer.tools.map((tool) => (
                              <div className="detail-block" key={tool.name}>
                                <h3>{tool.name}</h3>
                                <p>
                                  查询时间范围：{tool.range}
                                  <br />
                                  返回摘要：{tool.result}
                                </p>
                              </div>
                            ))}
                          </div>
                        ),
                      },
                    ]}
                  />
                </div>
                <div className="message">
                  <div className="user-avatar">{PRODUCT_MARK}</div>
                  <div className="bubble">
                    <div className="agent-label">{turn.answer.label}</div>
                    {turn.answer.paragraphs.map((text, i) => (
                      <p key={i}>{text}</p>
                    ))}
                    <div className="evidence">
                      <span className="user-role">证据引用</span>
                      <div className="evidence-links">
                        {turn.answer.evidence.map((item) => (
                          <Link key={item.to + item.label} to={item.to}>
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        ))}

        <Composer
          value={input}
          onChange={setInput}
          onSend={send}
          sending={sending}
          placeholder={`继续追问，${CURRENT_USER.name}`}
          hint="回答基于本地 Mock 数据"
        />
      </div>
    </section>
  );
}
