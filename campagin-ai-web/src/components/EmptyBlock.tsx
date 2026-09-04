import type { ReactNode } from "react";

interface Props {
  title: string;
  desc?: ReactNode;
  action?: ReactNode;
}

export default function EmptyBlock({ title, desc, action }: Props) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {desc}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}
