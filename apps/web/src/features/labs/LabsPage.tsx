import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import type { LabBox } from '@clinic/shared';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/States';
import { useSession } from '@/auth/session';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useLabRequests } from './api';
import { LabRequestItem } from './components';

const l = t.labs;

export function LabsPage() {
  const { activeClinic } = useSession();
  const isDoctor = Boolean(activeClinic?.roles.includes('doctor'));
  // Doctors review their results; the front desk attaches what patients bring back.
  const boxes: LabBox[] = isDoctor ? ['to_review', 'awaiting'] : ['awaiting'];
  const [box, setBox] = useState<LabBox>(boxes[0]!);
  const list = useLabRequests(box);

  return (
    <>
      <PageHeader title={l.title} subtitle={l.subtitle} />
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
              {l.boxes[key]}
            </button>
          ))}
        </div>
      )}
      <div className="max-w-3xl">
        {box === 'awaiting' && (
          <p className="mb-4 text-sm text-muted-foreground">{l.awaitingHint}</p>
        )}
        {list.isLoading ? (
          <TableSkeleton rows={4} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data?.length ? (
          <EmptyState icon={FlaskConical} title={l.none} />
        ) : (
          <ul className="space-y-3">
            {list.data.map((lab) => (
              <LabRequestItem key={lab.id} lab={lab} withPatient />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
