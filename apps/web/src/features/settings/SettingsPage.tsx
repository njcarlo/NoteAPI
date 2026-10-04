import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { CredentialsSettings } from './CredentialsSettings';
import { SchedulesSettings } from './SchedulesSettings';

const TABS = ['schedules', 'credentials'] as const;

export function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('schedules');
  return (
    <>
      <PageHeader title={t.settings.title} />
      <div className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.settings.tabs[key]}
          </button>
        ))}
      </div>
      <div className="max-w-4xl">
        {tab === 'schedules' ? <SchedulesSettings /> : <CredentialsSettings />}
      </div>
    </>
  );
}
