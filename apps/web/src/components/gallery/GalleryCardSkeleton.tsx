import { Card } from "../ui/card";
import { Skeleton } from "../ui/skeleton";

interface GalleryCardSkeletonProps {
  hasCuration?: boolean;
  hasSecondaryMetadata?: boolean;
  hasTitle?: boolean;
}

export function GalleryCardSkeleton({
  hasCuration = true,
  hasSecondaryMetadata = true,
  hasTitle = true
}: GalleryCardSkeletonProps) {
  const hasCardInfo = hasTitle || hasSecondaryMetadata || hasCuration;

  return (
    <Card className="media-tile gap-0 py-0">
      <Skeleton className="gallery-card-skeleton rounded-none" />
      {hasCardInfo ? (
        <div className="tile-info">
          {hasTitle ? <Skeleton className="h-4 w-3/5" /> : null}
          {hasSecondaryMetadata ? (
            <div className="flex h-[15px] items-center gap-2">
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="h-3 w-1/5" />
            </div>
          ) : null}
          {hasCuration ? (
            <div className="flex h-7 items-center gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-6 rounded-full" />
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
