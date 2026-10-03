import { Link } from 'react-router';
import { EmptyState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

export function NotFoundPage() {
  return (
    <div className="p-8">
      <EmptyState
        title={t.notFound.title}
        body={t.notFound.body}
        action={
          <Button asChild variant="outline">
            <Link to="/">{t.notFound.home}</Link>
          </Button>
        }
      />
    </div>
  );
}
