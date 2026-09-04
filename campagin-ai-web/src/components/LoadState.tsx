import { Button, Skeleton } from "antd";
import type { ReactNode } from "react";
import EmptyBlock from "./EmptyBlock";

interface Props {
  loading: boolean;
  error?: string;
  onRetry?: () => void;
  /** 骨架屏行数。 */
  rows?: number;
  children: ReactNode;
}

/** 列表页统一的加载与错误态，对应 plan.md 的「加载骨架 / 查询失败可重试」验收项。 */
export default function LoadState({ loading, error, onRetry, rows = 4, children }: Props) {
  if (loading) {
    return (
      <div style={{ padding: 18 }}>
        <Skeleton active paragraph={{ rows }} title={false} />
      </div>
    );
  }
  if (error) {
    return (
      <EmptyBlock
        title="加载失败"
        desc={error}
        action={
          onRetry ? (
            <Button onClick={onRetry} type="primary">
              重试
            </Button>
          ) : null
        }
      />
    );
  }
  return <>{children}</>;
}
