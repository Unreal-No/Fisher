import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import type { Me, Permission } from '@fisher/shared';
import { api } from './api';

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  can: (...p: Permission[]) => boolean;
  canAny: (...p: Permission[]) => boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me').catch((e) => (e.status === 401 ? null : Promise.reject(e))),
    staleTime: 5 * 60_000,
    retry: false,
  });
  useEffect(() => {
    const h = () => qc.setQueryData(['me'], null);
    window.addEventListener('auth:expired', h);
    return () => window.removeEventListener('auth:expired', h);
  }, [qc]);
  const me = q.data ?? null;
  const can = useCallback((...p: Permission[]) => !!me && p.every((x) => me.permissions.includes(x)), [me]);
  const canAny = useCallback((...p: Permission[]) => !!me && p.some((x) => me.permissions.includes(x)), [me]);
  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    qc.setQueryData(['me'], null);
  };
  return <Ctx.Provider value={{ me, loading: q.isLoading, can, canAny, logout, refresh: q.refetch }}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
};
