import type { ReactNode } from "react";
import type { PillTone } from "@/types";

interface Props {
  tone?: PillTone;
  children: ReactNode;
}

/** 原型的 .pill 胶囊：中性 / 成功 / 警告 / 危险四种语义色。 */
export default function StatusPill({ tone = "neutral", children }: Props) {
  return <span className={tone === "neutral" ? "pill" : `pill ${tone}`}>{children}</span>;
}
