import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  className?: string;
  render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
  pageSize?: number;
}

export function DataTable<T>({ data, columns, rowKey, searchPlaceholder = "Search", pageSize = 8 }: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(columns[0]?.key ?? "");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const nextRows = needle
      ? data.filter((row) =>
          columns.some((column) => String(column.sortValue?.(row) ?? column.render(row) ?? "").toLowerCase().includes(needle))
        )
      : data;

    const column = columns.find((item) => item.key === sortKey);
    if (!column?.sortable) return nextRows;

    return [...nextRows].sort((a, b) => {
      const left = column.sortValue?.(a) ?? "";
      const right = column.sortValue?.(b) ?? "";
      const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
      return direction === "asc" ? result : -result;
    });
  }, [columns, data, direction, query, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  function toggleSort(key: string, sortable?: boolean) {
    if (!sortable) return;
    setSortKey(key);
    setDirection((current) => (sortKey === key && current === "asc" ? "desc" : "asc"));
  }

  return (
    <div className="table-shell">
      <div className="table-toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={searchPlaceholder}
          />
        </label>
        <span className="table-count">{filtered.length} rows</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.className}
                  onClick={() => toggleSort(column.key, column.sortable)}
                  aria-sort={sortKey === column.key ? (direction === "asc" ? "ascending" : "descending") : undefined}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="empty-cell">
                  No records found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <button className="icon-button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>
          <ChevronLeft size={17} />
        </button>
        <span>
          {page + 1} / {totalPages}
        </span>
        <button className="icon-button" onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))} disabled={page + 1 >= totalPages}>
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
