import { Construction } from 'lucide-react';
import { EmptyState } from '@/components/States';
import { PageHeader } from '@/components/PageHeader';
import { t } from '@/i18n';

export function ComingSoonPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon={Construction} title={t.comingSoon.title} body={t.comingSoon.body} />
    </>
  );
}
