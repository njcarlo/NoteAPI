import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/**
 * Subscribes to the clinic's server-sent events while a clinic is active. Events only say
 * "appointments changed for doctor X"; screens refetch what they show.
 */
export function useLiveUpdates(clinicId: string | null): 'live' | 'connecting' | 'off' {
  const queryClient = useQueryClient();
  const [state, setState] = useState<'live' | 'connecting' | 'off'>('off');

  useEffect(() => {
    if (!clinicId) return;
    const source = new EventSource('/api/events');
    source.onopen = () => setState('live');
    source.onerror = () => setState('connecting');
    source.addEventListener('appointments.changed', () => {
      for (const key of ['appointments', 'queue', 'slots']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    });
    return () => {
      source.close();
      setState('off');
    };
  }, [clinicId, queryClient]);

  return clinicId ? state : 'off';
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
