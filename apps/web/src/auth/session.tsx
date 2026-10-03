import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import {
  hasPermission,
  type Permission,
  type SessionResponse,
  type SessionUser,
} from '@clinic/shared';
import { api, ApiError, setCsrfToken, setUnauthenticatedHandler } from '@/lib/api';

export const sessionQueryKey = ['session'] as const;

interface SessionContextValue {
  user: SessionUser | null;
  isLoading: boolean;
  can: (permission: Permission) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: sessionQueryKey,
    queryFn: async () => {
      try {
        return await api<SessionResponse>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => setCsrfToken(query.data?.csrfToken ?? null), [query.data]);

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      queryClient.setQueryData(sessionQueryKey, null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== sessionQueryKey[0] });
    });
  }, [queryClient]);

  const user = query.data?.user ?? null;
  const value: SessionContextValue = {
    user,
    isLoading: query.isLoading,
    can: (permission) => (user ? hasPermission(user.roles, permission) : false),
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
