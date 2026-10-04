import { PageHeader } from '@/components/PageHeader';
import { t } from '@/i18n';
import { SchedulesSettings } from './SchedulesSettings';

export function SettingsPage() {
  return (
    <>
      <PageHeader title={t.settings.title} subtitle={t.settings.tabs.schedules} />
      <div className="max-w-4xl">
        <SchedulesSettings />
      </div>
    </>
  );
}
