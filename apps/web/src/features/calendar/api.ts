import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Appointment, AppointmentCreateInput, Doctor, SlotDto } from '@clinic/shared';
import { api } from '@/lib/api';

export function useDoctors() {
  return useQuery({ queryKey: ['doctors'], queryFn: () => api<Doctor[]>('/doctors') });
}

export function useAppointments(from: string, to: string) {
  return useQuery({
    queryKey: ['appointments', from, to],
    queryFn: () => api<Appointment[]>(`/appointments?from=${from}&to=${to}`),
  });
}

export const slotsQuery = (doctorId: string, date: string) => ({
  queryKey: ['slots', doctorId, date],
  queryFn: () => api<SlotDto[]>(`/doctors/${doctorId}/slots?date=${date}`),
});

export function useSlots(doctorId: string | null, date: string) {
  return useQuery({ ...slotsQuery(doctorId ?? '', date), enabled: Boolean(doctorId) });
}

export function useSlotsFor(doctorIds: string[], date: string, enabled: boolean) {
  return useQueries({ queries: doctorIds.map((id) => ({ ...slotsQuery(id, date), enabled })) });
}

function useInvalidateCalendar() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['appointments'] }),
      queryClient.invalidateQueries({ queryKey: ['slots'] }),
    ]);
}

export function useCreateAppointment() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (body: AppointmentCreateInput) =>
      api<Appointment>('/appointments', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useAppointmentAction() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (
      action:
        | { kind: 'move'; id: string; startAt: string }
        | { kind: 'cancel'; id: string }
        | { kind: 'no-show'; id: string },
    ) =>
      action.kind === 'move'
        ? api<Appointment>(`/appointments/${action.id}`, {
            method: 'PATCH',
            body: { startAt: action.startAt },
          })
        : api<Appointment>(`/appointments/${action.id}/${action.kind}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}
