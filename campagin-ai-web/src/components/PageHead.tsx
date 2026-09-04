import type { ReactNode } from "react";

interface Props {
  eyebrow: string;
  title: string;
  desc?: string;
  extra?: ReactNode;
}

export default function PageHead({ eyebrow, title, desc, extra }: Props) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        {desc ? <p className="page-desc">{desc}</p> : null}
      </div>
      {extra}
    </div>
  );
}
