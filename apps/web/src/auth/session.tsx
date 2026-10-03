import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import {
  sessionCan,
  type ActiveClinic,
  type ClinicMembership,
  type Permission,
  type SessionResponse,
  type SessionUser,
} from '@clinic/shared';
import { api, ApiError, setCsrfToken, setUnauthenticatedHandler } from '@/lib/api';

export const sessionQueryKey = ['session'] as const;

/** Replaces the session and drops every cached clinic query, so no data crosses clinics. */
export function applySession(queryClient: QueryClient, session: SessionResponse | null) {
  setCsrfToken(session?.csrfToken ?? null);
  queryClient.setQueryData(sessionQueryKey, session);
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== sessionQueryKey[0] });
}

interface SessionContextValue {
  user: SessionUser | null;
  clinics: ClinicMembership[];
  activeClinic: ActiveClinic | null;
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
  useEffect(() => setUnauthenticatedHandler(() => applySession(queryClient, null)), [queryClient]);

  const session = query.data ?? null;
  const value: SessionContextValue = {
    user: session?.user ?? null,
    clinics: session?.clinics ?? [],
    activeClinic: session?.activeClinic ?? null,
    isLoading: query.isLoading,
    can: (permission) => sessionCan(session, permission),
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export function useSelectClinic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clinicId: string) =>
      api<SessionResponse>('/auth/active-clinic', { method: 'POST', body: { clinicId } }),
    onSuccess: (session) => applySession(queryClient, session),
  });
}
