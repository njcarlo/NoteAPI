import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ClinicEvent } from '@clinic/shared';

export type BookingAlert = Extract<ClinicEvent, { type: 'booking.created' }> & { id: number };

/**
 * Subscribes to the clinic's server-sent events while a clinic is active. Events only carry ids
 * and times; screens refetch what they show. New online bookings also raise an in-app alert.
 */
export function useLiveUpdates(clinicId: string | null) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<'live' | 'connecting' | 'off'>('off');
  const [alerts, setAlerts] = useState<BookingAlert[]>([]);

  useEffect(() => {
    if (!clinicId) return;
    const source = new EventSource('/api/events');
    const refetch = () => {
      for (const key of ['appointments', 'queue', 'slots', 'referrals', 'lab-requests'])
        void queryClient.invalidateQueries({ queryKey: [key] });
    };
    source.onopen = () => setState('live');
    source.onerror = () => setState('connecting');
    source.addEventListener('appointments.changed', refetch);
    source.addEventListener('booking.created', (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as BookingAlert;
      setAlerts((list) => [...list.slice(-4), { ...event, id: Date.now() }]);
      refetch();
    });
    return () => {
      source.close();
      setState('off');
      setAlerts([]);
    };
  }, [clinicId, queryClient]);

  return {
    state: clinicId ? state : ('off' as const),
    alerts,
    dismiss: (id: number) => setAlerts((list) => list.filter((a) => a.id !== id)),
  };
}

/** Current time, refreshed every `ms` (for "waiting 12 min" labels). */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
