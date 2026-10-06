import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Consult, Referral, ReferralBox, ReferralInput } from '@clinic/shared';
import { consultKey } from '@/features/consult/api';
import { api } from '@/lib/api';

export function useReferrals(box: ReferralBox, enabled = true) {
  return useQuery({
    queryKey: ['referrals', box],
    queryFn: () => api<Referral[]>(`/referrals?box=${box}`),
    enabled,
    refetchInterval: 60_000,
  });
}

export function usePatientReferrals(patientId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['referrals', 'patient', patientId],
    queryFn: () => api<Referral[]>(`/patients/${patientId}/referrals`),
    enabled,
  });
}

/** Keeps the consultation screen and every referral list in step after a change. */
function useApplyReferral() {
  const queryClient = useQueryClient();
  return (referral: Referral) => {
    queryClient.setQueryData<Consult>(consultKey(referral.appointmentId), (old) =>
      old
        ? {
            ...old,
            visit: {
              ...old.visit,
              referrals: old.visit.referrals.some((r) => r.id === referral.id)
                ? old.visit.referrals.map((r) => (r.id === referral.id ? referral : r))
                : [...old.visit.referrals, referral],
            },
          }
        : old,
    );
    void queryClient.invalidateQueries({ queryKey: ['referrals'] });
  };
}

export function useCreateReferral(visitId: string) {
  const apply = useApplyReferral();
  return useMutation({
    mutationFn: (body: ReferralInput) =>
      api<Referral>(`/visits/${visitId}/referrals`, { method: 'POST', body }),
    onSuccess: apply,
  });
}

export type ReferralAction =
  | { kind: 'schedule'; id: string; startAt: string }
  | { kind: 'decline'; id: string; note: string }
  | { kind: 'cancel'; id: string };

export function useReferralAction() {
  const queryClient = useQueryClient();
  const apply = useApplyReferral();
  return useMutation({
    mutationFn: (action: ReferralAction) => {
      const { kind, id, ...body } = action;
      return api<Referral>(`/referrals/${id}/${kind}`, { method: 'POST', body });
    },
    onSuccess: (referral, action) => {
      apply(referral);
      if (action.kind === 'schedule') {
        void queryClient.invalidateQueries({ queryKey: ['appointments'] });
        void queryClient.invalidateQueries({ queryKey: ['slots'] });
      }
    },
  });
}

export const referralPdfUrl = (id: string) => `/api/referrals/${id}/pdf`;
