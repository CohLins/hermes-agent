export default function TrendBars({ values }: { values: number[] }) {
  return (
    <div className="trend" role="img" aria-label="示例数据趋势">
      {values.map((value, index) => (
        <i className="bar" key={index} style={{ height: `${value}%` }} />
      ))}
    </div>
  );
}
