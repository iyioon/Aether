import { GalleryCardSkeleton } from "../gallery/GalleryCardSkeleton";
import { Button } from "../ui/button";

const previewCardCount = 18;

export function CardLoadingPreview() {
  return (
    <main className="min-h-dvh overflow-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1440px] px-5 py-6 sm:px-8 sm:py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
              Development preview
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Card loading
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Production gallery skeletons with the animation looping continuously.
            </p>
          </div>
          <Button asChild variant="outline">
            <a href="/">Back to library</a>
          </Button>
        </header>

        <section
          aria-label="Loading card preview"
          aria-busy="true"
          className="gallery-grid gallery-skeleton-grid"
          data-aspect="Square"
          data-size="Medium"
        >
          {Array.from({ length: previewCardCount }).map((_, index) => (
            <GalleryCardSkeleton key={index} />
          ))}
        </section>
      </div>
    </main>
  );
}
