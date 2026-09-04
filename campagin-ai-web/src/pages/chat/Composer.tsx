import { Button, Input } from "antd";
import { ArrowUpOutlined } from "@ant-design/icons";
import type { KeyboardEvent } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  placeholder: string;
  hint: string;
}

/** Enter 发送、Shift + Enter 换行；发送中禁用按钮避免重复提交。 */
export default function Composer({ value, onChange, onSend, sending, placeholder, hint }: Props) {
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sending) onSend();
    }
  };

  return (
    <div className="composer" data-od-id="chat-composer">
      <Input.TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoSize={{ minRows: 2, maxRows: 8 }}
        aria-label="输入想查询的问题"
      />
      <div className="composer-foot">
        <span>{hint}</span>
        <Button
          type="primary"
          shape="circle"
          icon={<ArrowUpOutlined />}
          onClick={onSend}
          loading={sending}
          disabled={sending}
          aria-label="发送"
        />
      </div>
    </div>
  );
}
