import type { ReactNode } from 'react';

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-xl px-4 py-6 sm:py-10">{children}</div>
    </div>
  );
}

export function Step({
  n,
  title,
  children,
  action,
}: {
  n: number;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
            {n}
          </span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
