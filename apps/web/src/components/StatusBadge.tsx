import type { AppointmentStatus } from '@clinic/shared';
import { Badge } from '@/components/ui/badge';
import { t } from '@/i18n';

const VARIANT = {
  booked: 'default',
  arrived: 'warning',
  in_consult: 'default',
  done: 'success',
  cancelled: 'muted',
  no_show: 'destructive',
} as const;

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return <Badge variant={VARIANT[status]}>{t.status[status]}</Badge>;
}

/** Left-border color for appointment cards, matching the badge. */
export const STATUS_BORDER: Record<AppointmentStatus, string> = {
  booked: 'border-l-primary',
  arrived: 'border-l-warning',
  in_consult: 'border-l-purple-500',
  done: 'border-l-success',
  cancelled: 'border-l-border',
  no_show: 'border-l-destructive',
};
