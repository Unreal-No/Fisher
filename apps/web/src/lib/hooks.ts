import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { Paged } from '@fisher/shared';
import { api, ApiError } from './api';

/** List state (page/sort/filters) persisted in the URL so views are shareable and survive refresh. */
export function useListParams(defaults: Record<string, string> = {}) {
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? defaults[k] ?? '';
  const set = (patch: Record<string, string | number | undefined>, resetPage = true) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || v === defaults[k]) n.delete(k);
      else n.set(k, String(v));
    }
    if (resetPage && !('page' in patch)) n.delete('page');
    setSp(n, { replace: true });
  };
  const page = Number(get('page') || 1);
  const params: Record<string, string> = { ...defaults };
  sp.forEach((v, k) => (params[k] = v));
  return { get, set, page, params };
}

export function usePaged<T>(key: string, path: string, params: Record<string, string | number | undefined>, enabled = true) {
  return useQuery({
    queryKey: [key, params],
    queryFn: () => api.get<Paged<T> & Record<string, unknown>>(path, params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Mutation with Thai toast + cache invalidation. */
export function useAction<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, opts: { success?: string; invalidate?: string[]; onSuccess?: (r: TRes) => void; silentError?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast.success(opts.success);
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: [k] });
      opts.onSuccess?.(r);
    },
    onError: (e) => {
      if (!opts.silentError) toast.error(e instanceof ApiError ? e.message : 'เกิดข้อผิดพลาด');
    },
  });
}
