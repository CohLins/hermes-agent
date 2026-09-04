import { Table } from "antd";
import type { TableProps } from "antd";

interface Props<T> extends Omit<TableProps<T>, "onRow" | "rowClassName"> {
  onRowClick?: (record: T) => void;
}

/**
 * 原型的数据表：等宽小号表头、行 hover、行点击开详情抽屉，宽表在容器内横向滚动。
 */
export default function DataTable<T extends object>({ onRowClick, className, ...rest }: Props<T>) {
  return (
    <Table<T>
      {...rest}
      className={[
        "data-table",
        onRowClick ? "is-clickable" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      scroll={{ x: "max-content", ...(rest.scroll ?? {}) }}
      onRow={
        onRowClick
          ? (record) => ({
              onClick: () => onRowClick(record),
            })
          : undefined
      }
    />
  );
}
