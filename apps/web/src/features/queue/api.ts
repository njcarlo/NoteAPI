import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Appointment,
  CheckInInput,
  Queue,
  QueueItem,
  Vitals,
  WalkInInput,
} from '@clinic/shared';
import { api } from '@/lib/api';

export function useQueue(doctorId?: string) {
  return useQuery({
    queryKey: ['queue', doctorId ?? 'all'],
    queryFn: () => api<Queue>(`/queue${doctorId ? `?doctorId=${doctorId}` : ''}`),
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['queue', 'appointments', 'patients'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function useCheckIn() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: CheckInInput & { id: string }) =>
      api<Appointment>(`/appointments/${id}/check-in`, { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useWalkIn() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: WalkInInput) => api<Appointment>('/walk-ins', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useSaveVitals() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, vitals }: { id: string; vitals: Vitals }) =>
      api<QueueItem>(`/appointments/${id}/vitals`, { method: 'PUT', body: vitals }),
    onSuccess: invalidate,
  });
}

export function useQueueAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (action: { kind: 'next' } | { kind: 'call' | 'requeue'; id: string }) =>
      action.kind === 'next'
        ? api<QueueItem>('/queue/call-next', { method: 'POST' })
        : api<QueueItem>(`/appointments/${action.id}/${action.kind}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}
