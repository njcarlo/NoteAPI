import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Consult,
  Facility,
  FacilityInput,
  LabBox,
  LabRequest,
  LabRequestInput,
  LabResultUpload,
} from '@clinic/shared';
import { api } from '@/lib/api';

export function useFacilities(all = false) {
  return useQuery({
    queryKey: ['facilities', all],
    queryFn: () => api<Facility[]>(`/facilities${all ? '?all=true' : ''}`),
    staleTime: 5 * 60_000,
  });
}

export function useFacilityActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['facilities'] });
  return {
    create: useMutation({
      mutationFn: (body: FacilityInput) => api<Facility>('/facilities', { method: 'POST', body }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Partial<FacilityInput> & { id: string; isActive?: boolean }) =>
        api<Facility>(`/facilities/${id}`, { method: 'PATCH', body }),
      onSuccess: invalidate,
    }),
  };
}

export function useLabRequests(box: LabBox) {
  return useQuery({
    queryKey: ['lab-requests', box],
    queryFn: () => api<LabRequest[]>(`/lab-requests?box=${box}`),
    refetchInterval: 60_000,
  });
}

export function usePatientLabRequests(patientId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['lab-requests', 'patient', patientId],
    queryFn: () => api<LabRequest[]>(`/patients/${patientId}/lab-requests`),
    enabled,
  });
}

/** Keeps the consultation screen and every lab list in step after a change. */
function useApplyLabRequest() {
  const queryClient = useQueryClient();
  return (lab: LabRequest) => {
    queryClient.setQueriesData<Consult>({ queryKey: ['consult'] }, (old) =>
      old && old.patient.id === lab.patient.id
        ? {
            ...old,
            labRequests: old.labRequests.some((l) => l.id === lab.id)
              ? old.labRequests.map((l) => (l.id === lab.id ? lab : l))
              : [lab, ...old.labRequests],
          }
        : old,
    );
    void queryClient.invalidateQueries({ queryKey: ['lab-requests'] });
  };
}

export function useCreateLabRequest(visitId: string) {
  const apply = useApplyLabRequest();
  return useMutation({
    mutationFn: (body: LabRequestInput) =>
      api<LabRequest>(`/visits/${visitId}/lab-requests`, { method: 'POST', body }),
    onSuccess: apply,
  });
}

export type LabAction =
  | { kind: 'review'; id: string; note: string }
  | { kind: 'cancel'; id: string }
  | { kind: 'results'; id: string; file: LabResultUpload };

export function useLabAction() {
  const apply = useApplyLabRequest();
  return useMutation({
    mutationFn: (action: LabAction) =>
      action.kind === 'results'
        ? api<LabRequest>(`/lab-requests/${action.id}/results`, {
            method: 'POST',
            body: action.file,
          })
        : api<LabRequest>(`/lab-requests/${action.id}/${action.kind}`, {
            method: 'POST',
            body: action.kind === 'review' ? { note: action.note } : {},
          }),
    onSuccess: apply,
  });
}

export const labPdfUrl = (id: string) => `/api/lab-requests/${id}/pdf`;
export const labResultUrl = (id: string) => `/api/lab-results/${id}`;
