import { t } from '@/i18n';
import { PublicLayout } from './PublicLayout';

export function PrivacyPage() {
  return (
    <PublicLayout>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t.privacy.title}</h1>
      <div className="space-y-4 text-sm leading-relaxed">
        {t.privacy.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </PublicLayout>
  );
}
