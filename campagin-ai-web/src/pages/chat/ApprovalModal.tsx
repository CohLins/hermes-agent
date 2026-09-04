import { useState } from "react";
import { Alert, Button, Checkbox, Modal, Space, Typography } from "antd";
import { APPROVAL_CHOICE_LABELS } from "@/types/agent";
import type { PendingApproval } from "@/hooks/useAgentRun";

interface Props {
  approval: PendingApproval | null;
  onResolve: (choice: string, all: boolean) => void;
}

/**
 * 危险命令审批。
 *
 * profile 的 approvals.mode 是 manual，deny 列表里有 git commit / git push /
 * rm -rf 等规则，触发时 agent 线程会阻塞等这个决定。60 秒不响应按 fail-closed
 * 处理（tools/approval.py 的 "Silence is not consent"），等价于拒绝。
 *
 * choices 由服务端给：smart_denied 时只有 once/deny，allow_permanent=false 时没有 always。
 */
export default function ApprovalModal({ approval, onResolve }: Props) {
  const [all, setAll] = useState(false);

  const resolve = (choice: string) => {
    onResolve(choice, all);
    setAll(false);
  };

  return (
    <Modal
      title="需要你确认这条操作"
      open={approval !== null}
      closable={false}
      maskClosable={false}
      keyboard={false}
      footer={null}
      width={560}
      data-od-id="chat-approval"
    >
      {approval ? (
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            message="60 秒内不作选择将按拒绝处理"
            description="agent 正阻塞等待这个决定，期间不会有新的输出。"
          />

          <div>
            <Typography.Text type="secondary">待执行命令（敏感信息已脱敏）</Typography.Text>
            <pre className="approval-command">{approval.command || "（服务端未提供命令文本）"}</pre>
          </div>

          {approval.description ? (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {approval.description}
            </Typography.Paragraph>
          ) : null}

          <Checkbox checked={all} onChange={(e) => setAll(e.target.checked)}>
            同时应用到当前排队的其他同类请求
          </Checkbox>

          <Space wrap>
            {approval.choices.map((choice) => (
              <Button
                key={choice}
                type={choice === "once" ? "primary" : "default"}
                danger={choice === "deny"}
                onClick={() => resolve(choice)}
              >
                {APPROVAL_CHOICE_LABELS[choice] ?? choice}
              </Button>
            ))}
          </Space>
        </Space>
      ) : null}
    </Modal>
  );
}
