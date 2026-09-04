import { Drawer } from "antd";
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  title: ReactNode;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  extra?: ReactNode;
}

/** 原型的右侧详情抽屉：480px、Esc / 遮罩 / 关闭按钮都能关，关闭后不影响列表上下文。 */
export default function DetailDrawer({ open, title, eyebrow = "DETAIL", onClose, children, extra }: Props) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      destroyOnHidden
      title={
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 style={{ fontSize: 22 }}>{title}</h2>
        </div>
      }
      extra={extra}
    >
      {children}
    </Drawer>
  );
}

export function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="detail-block">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
