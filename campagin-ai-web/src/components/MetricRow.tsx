import type { MetricItem } from "@/types";

export default function MetricRow({ items }: { items: MetricItem[] }) {
  return (
    <div className="metrics">
      {items.map((item) => (
        <div className="metric" key={item.label}>
          <div className="metric-label">{item.label}</div>
          <div className="metric-value">{item.value}</div>
          {item.change ? <div className="metric-change">{item.change}</div> : null}
        </div>
      ))}
    </div>
  );
}
