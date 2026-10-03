import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated, Patient, PatientData } from '@clinic/shared';
import { api } from '@/lib/api';

export const PAGE_SIZE = 25;

export function usePatients(q: string, page: number) {
  return useQuery({
    queryKey: ['patients', { q, page }],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (q) params.set('q', q);
      return api<Paginated<Patient>>(`/patients?${params}`);
    },
    placeholderData: keepPreviousData,
  });
}

export function usePatient(id: string | undefined) {
  return useQuery({
    queryKey: ['patients', id],
    queryFn: () => api<Patient>(`/patients/${id}`),
    enabled: Boolean(id),
  });
}

export function useSavePatient(id?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PatientData) =>
      id
        ? api<Patient>(`/patients/${id}`, { method: 'PATCH', body })
        : api<Patient>('/patients', { method: 'POST', body }),
    onSuccess: (patient) => {
      queryClient.setQueryData(['patients', patient.id], patient);
      void queryClient.invalidateQueries({ queryKey: ['patients'], exact: false });
    },
  });
}
