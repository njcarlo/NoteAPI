import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AmendmentInput,
  Consult,
  ConsultDraft,
  Drug,
  FinishVisitInput,
  RxFavorite,
  RxFavoriteInput,
  RxShareResponse,
  SoapTemplate,
  SoapTemplateInput,
  Visit,
  VisitSummary,
} from '@clinic/shared';
import { api } from '@/lib/api';

export const consultKey = (appointmentId: string) => ['consult', appointmentId];

export function useConsult(appointmentId: string) {
  return useQuery({
    queryKey: consultKey(appointmentId),
    queryFn: () => api<Consult>(`/consult/${appointmentId}`),
    staleTime: Infinity,
  });
}

export function useSaveDraft(appointmentId: string) {
  return useMutation({
    mutationFn: (draft: ConsultDraft) =>
      api<{ savedAt: string }>(`/consult/${appointmentId}/draft`, { method: 'PUT', body: draft }),
  });
}

export function useFinishVisit(appointmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: FinishVisitInput) =>
      api<Visit>(`/consult/${appointmentId}/finish`, { method: 'POST', body }),
    onSuccess: (visit) => {
      queryClient.setQueryData<Consult>(consultKey(appointmentId), (old) =>
        old ? { ...old, visit } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
  });
}

export function useAmend(appointmentId: string, visitId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AmendmentInput) =>
      api<Visit>(`/visits/${visitId}/amendments`, { method: 'POST', body }),
    onSuccess: (visit) =>
      queryClient.setQueryData<Consult>(consultKey(appointmentId), (old) =>
        old ? { ...old, visit } : old,
      ),
  });
}

export function useDrugSearch(q: string) {
  return useQuery({
    queryKey: ['drugs', q],
    queryFn: () => api<Drug[]>(`/drugs?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
    staleTime: 5 * 60_000,
  });
}

export function useFavorites() {
  return useQuery({
    queryKey: ['rx-favorites'],
    queryFn: () => api<RxFavorite[]>('/rx-favorites'),
  });
}

export function useDeleteFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/rx-favorites/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rx-favorites'] }),
  });
}

export function useSaveFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RxFavoriteInput) =>
      api<RxFavorite>('/rx-favorites', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rx-favorites'] }),
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: ['soap-templates'],
    queryFn: () => api<SoapTemplate[]>('/soap-templates'),
  });
}

export function useTemplateActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['soap-templates'] });
  return {
    create: useMutation({
      mutationFn: (body: SoapTemplateInput) =>
        api<SoapTemplate>('/soap-templates', { method: 'POST', body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<void>(`/soap-templates/${id}`, { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
  };
}

export function useShareLink() {
  return useMutation({
    mutationFn: (prescriptionId: string) =>
      api<RxShareResponse>(`/prescriptions/${prescriptionId}/share`, { method: 'POST' }),
  });
}

export function usePatientVisits(patientId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['patients', patientId, 'visits'],
    queryFn: () => api<VisitSummary[]>(`/patients/${patientId}/visits`),
    enabled,
  });
}
