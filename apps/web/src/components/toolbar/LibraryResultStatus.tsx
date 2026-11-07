import { RefreshCw } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Button } from "../ui/button";

export function LibraryResultStatus({
  loadedAssetCount,
  isResultsPending,
  canUpdateResults,
  onUpdateResults
}: {
  loadedAssetCount: number;
  isResultsPending: boolean;
  canUpdateResults: boolean;
  onUpdateResults: () => void;
}) {
  const updateRef = useRef<HTMLButtonElement>(null);
  const requestedFocusRef = useRef(false);
  const wasPendingRef = useRef(isResultsPending);
  useLayoutEffect(() => {
    const completed = wasPendingRef.current && !isResultsPending;
    wasPendingRef.current = isResultsPending;
    if (
      completed &&
      requestedFocusRef.current &&
      (document.activeElement === updateRef.current ||
        document.activeElement === document.body)
    )
      updateRef.current
        ?.closest(".library-inset")
        ?.querySelector<HTMLButtonElement>(".view-options-trigger")
        ?.focus({ preventScroll: true });
    if (completed) requestedFocusRef.current = false;
  }, [isResultsPending]);
  return (
    <section className="library-result-status" aria-label="Library results">
      <span className="results-update-slot" data-pending={isResultsPending}>
        <Button
          ref={updateRef}
          type="button"
          size="sm"
          variant="outline"
          disabled={!canUpdateResults}
          tabIndex={isResultsPending ? 0 : -1}
          aria-hidden={!isResultsPending}
          title={
            !canUpdateResults
              ? "Finish editing or selecting before updating results"
              : undefined
          }
          onBlur={(event) => {
            if (event.relatedTarget && event.relatedTarget !== document.body)
              requestedFocusRef.current = false;
          }}
          onClick={() => {
            requestedFocusRef.current =
              document.activeElement === updateRef.current;
            onUpdateResults();
          }}
        >
          <RefreshCw />
          <span>Update results</span>
        </Button>
      </span>
      <span className="sr-only" role="status">
        {isResultsPending
          ? `${loadedAssetCount} shown. Saved changes are ready. Update results to apply sorting and filters.`
          : ""}
      </span>
    </section>
  );
}
