import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowData } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatNumber } from '@fisher/shared';
import { Button } from './button';
import { Empty, ErrorState } from './states';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'right' | 'center';
    sortKey?: string;
    className?: string;
  }
}

export interface DataTableProps<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  data?: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (p: number) => void;
  sort?: string;
  order?: 'asc' | 'desc';
  onSortChange?: (sort: string, order: 'asc' | 'desc') => void;
  loading?: boolean;
  error?: unknown;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  footer?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
}

export function DataTable<T>({
  columns, data, total, page = 1, pageSize = 20, onPageChange, sort, order, onSortChange, loading, error, onRowClick, empty, footer, rowClassName,
}: DataTableProps<T>) {
  const table = useReactTable({ data: data ?? [], columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualSorting: true });
  const pages = total ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  return (
    <div className="overflow-hidden rounded-md border border-line bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const m = h.column.columnDef.meta;
                  const active = m?.sortKey && sort === m.sortKey;
                  return (
                    <th key={h.id} className={cn('whitespace-nowrap border-b border-line px-3 py-2.5', m?.align === 'right' && 'text-right', m?.align === 'center' && 'text-center', m?.className)}>
                      {m?.sortKey && onSortChange ? (
                        <button
                          className="inline-flex items-center gap-1 hover:text-ink"
                          onClick={() => onSortChange(m.sortKey!, active && order === 'asc' ? 'desc' : 'asc')}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {active && (order === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr
                key={r.id}
                onClick={onRowClick ? () => onRowClick(r.original) : undefined}
                className={cn('border-b border-line last:border-0 even:bg-slate-50/40', onRowClick && 'cursor-pointer hover:bg-accent-soft', rowClassName?.(r.original))}
              >
                {r.getVisibleCells().map((c) => {
                  const m = c.column.columnDef.meta;
                  return (
                    <td key={c.id} className={cn('px-3 py-2 align-middle', m?.align === 'right' && 'text-right tabular-nums', m?.align === 'center' && 'text-center', m?.className)}>
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot className="border-t border-line bg-slate-50 font-semibold">{footer}</tfoot>}
        </table>
      </div>
      {loading && !data?.length && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> กำลังโหลด...
        </div>
      )}
      {!!error && <ErrorState error={error} />}
      {!loading && !error && data?.length === 0 && (empty ?? <Empty />)}
      {onPageChange && total !== undefined && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-muted">
          <span>
            แสดง {formatNumber((page - 1) * pageSize + 1)}–{formatNumber(Math.min(page * pageSize, total))} จาก {formatNumber(total)} รายการ
            {loading && <Loader2 className="ml-2 inline size-3 animate-spin" />}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="ก่อนหน้า">
              <ChevronLeft />
            </Button>
            <span className="px-2">หน้า {page} / {pages}</span>
            <Button variant="outline" size="icon" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label="ถัดไป">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
