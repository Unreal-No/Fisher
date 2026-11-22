import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Account } from './types';

export const INV = ['accounting'];
export const useAccounts = () => useQuery({ queryKey: ['accounting', 'accounts'], queryFn: () => api.get<Account[]>('/accounting/accounts'), staleTime: 60_000 });
export const accountOptions = (a?: Account[], postableOnly = true) =>
  (a ?? []).filter((x) => !postableOnly || (x.isPostable && x.isActive)).sort((x, y) => x.code.localeCompare(y.code)).map((x) => ({ value: x.id, label: `${x.code} ${x.nameTh}` }));
