import { Button, Tooltip } from "antd";
import { CopyOutlined, EditOutlined, ReloadOutlined } from "@ant-design/icons";
import { copyText } from "@/utils/clipboard";
import { formatMessageTime } from "./format";

interface Props {
  /** 要复制的原文。 */
  text: string;
  /** 毫秒时间戳。 */
  at: number;
  /** 助手消息传 retry，用户消息传 edit；执行中两者都不传即隐藏。 */
  onRetry?: () => void;
  onEdit?: () => void;
  disabled?: boolean;
  onCopied: (ok: boolean) => void;
}

/**
 * 消息下方的操作条，父级 hover / focus-within 时显形。
 *
 * 复制走 copyText（clipboard API + execCommand 兜底），成功与否都回调给
 * 调用方提示 —— 非安全上下文下两条路都会失败，必须让用户知道。
 */
export default function MessageActions({
  text,
  at,
  onRetry,
  onEdit,
  disabled,
  onCopied,
}: Props) {
  return (
    <div className="msg-actions" data-od-id="message-actions">
      <Tooltip title="复制内容">
        <Button
          size="small"
          type="text"
          icon={<CopyOutlined />}
          onClick={() => void copyText(text).then(onCopied)}
          aria-label="复制"
        />
      </Tooltip>

      {onEdit ? (
        <Tooltip title={disabled ? "执行中不能改" : "编辑后重新发送（这一轮及之后会被移除）"}>
          <Button
            size="small"
            type="text"
            icon={<EditOutlined />}
            onClick={onEdit}
            disabled={disabled}
            aria-label="编辑重发"
          />
        </Tooltip>
      ) : null}

      {onRetry ? (
        <Tooltip title={disabled ? "执行中不能重试" : "用同一个问题重跑（这一轮及之后会被移除）"}>
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            onClick={onRetry}
            disabled={disabled}
            aria-label="重试"
          />
        </Tooltip>
      ) : null}

      <span className="msg-time">{formatMessageTime(at)}</span>
    </div>
  );
}
