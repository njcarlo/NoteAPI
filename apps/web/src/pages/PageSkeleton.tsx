import { Skeleton } from '@/components/ui/skeleton';

/** Shown while a page's code loads. */
export function PageSkeleton() {
  return (
    <div className="space-y-4 p-4 md:p-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
