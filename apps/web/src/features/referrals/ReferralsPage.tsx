import { Send } from 'lucide-react';
import { useState } from 'react';
import type { ReferralBox } from '@clinic/shared';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/States';
import { useSession } from '@/auth/session';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useReferrals } from './api';
import { ReferralItem } from './components';

const r = t.referrals;

export function ReferralsPage() {
  const { activeClinic } = useSession();
  const isDoctor = Boolean(activeClinic?.roles.includes('doctor'));
  // Doctors work their own referrals; the front desk books in-clinic ones.
  const boxes: ReferralBox[] = isDoctor ? ['incoming', 'outgoing', 'to_schedule'] : ['to_schedule'];
  const [box, setBox] = useState<ReferralBox>(boxes[0]!);
  const list = useReferrals(box);

  return (
    <>
      <PageHeader title={r.title} subtitle={r.subtitle} />
      {boxes.length > 1 && (
        <div className="mb-6 flex gap-1 border-b border-border">
          {boxes.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setBox(key)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
                box === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {r.boxes[key]}
            </button>
          ))}
        </div>
      )}
      <div className="max-w-3xl">
        {box === 'to_schedule' && (
          <p className="mb-4 text-sm text-muted-foreground">{r.toScheduleHint}</p>
        )}
        {list.isLoading ? (
          <TableSkeleton rows={4} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data?.length ? (
          <EmptyState icon={Send} title={r.none} />
        ) : (
          <ul className="space-y-3">
            {list.data.map((ref) => (
              <ReferralItem
                key={ref.id}
                referral={ref}
                show={box === 'outgoing' ? 'to' : 'from'}
                withPatient
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
