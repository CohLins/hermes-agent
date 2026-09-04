interface Props {
  items: { brand: string; label: string }[];
  value: string;
  onChange: (brand: string) => void;
  odId?: string;
}

export default function BrandTabs({ items, value, onChange, odId }: Props) {
  return (
    <div className="brand-tabs" role="tablist" aria-label="品牌" data-od-id={odId}>
      {items.map((item) => (
        <button
          key={item.brand}
          type="button"
          role="tab"
          aria-selected={item.brand === value}
          className={`brand-tab${item.brand === value ? " active" : ""}`}
          onClick={() => onChange(item.brand)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
