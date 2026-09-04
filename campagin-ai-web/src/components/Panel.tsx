import type { ReactNode } from "react";

interface Props {
  title?: ReactNode;
  desc?: ReactNode;
  extra?: ReactNode;
  padded?: boolean;
  className?: string;
  odId?: string;
  children: ReactNode;
}

/** 原型的 .panel：16px 圆角描边容器 + 可选头部。 */
export default function Panel({ title, desc, extra, padded, className, odId, children }: Props) {
  return (
    <section className={className ? `panel ${className}` : "panel"} data-od-id={odId}>
      {title ? (
        <div className="panel-head">
          <div>
            <h3>{title}</h3>
            {desc ? <p>{desc}</p> : null}
          </div>
          {extra}
        </div>
      ) : null}
      {padded ? <div className="panel-body">{children}</div> : children}
    </section>
  );
}
