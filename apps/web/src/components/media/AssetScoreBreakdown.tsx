import { RotateCcw, Trash2 } from "lucide-react";
import type { AssetRecord } from "../../api/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { formatSignedScore } from "./score-format";

interface AssetScoreBreakdownProps {
  asset: AssetRecord;
  isResetOpen: boolean;
  isSaving: boolean;
  resetError?: string | null;
  onClearAdjustment: () => void;
  onReset: () => void;
  onResetOpenChange: (open: boolean) => void;
}

export function AssetScoreBreakdown({
  asset,
  isResetOpen,
  isSaving,
  resetError,
  onClearAdjustment,
  onReset,
  onResetOpenChange
}: AssetScoreBreakdownProps) {
  if (!asset.ranking)
    return <p className="text-sm text-muted-foreground">No comparisons yet.</p>;

  return (
    <div className="score-breakdown">
      <div className="score-breakdown-values">
        <RankedScoreValues
          asset={asset}
          ranking={asset.ranking}
          isSaving={isSaving}
          onClearAdjustment={onClearAdjustment}
          onRequestReset={() => onResetOpenChange(true)}
        />
      </div>
      {asset.ranking ? (
        <AlertDialog open={isResetOpen} onOpenChange={onResetOpenChange}>
          <AlertDialogContent
            className="management-confirmation"
            onEscapeKeyDown={(event) => {
              if (isSaving) event.preventDefault();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                Reset comparisons for {asset.name}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This removes {asset.ranking.comparisonCount} active pair
                {asset.ranking.comparisonCount === 1 ? "" : "s"} involving this
                item and recalculates related scores. Manual scores stay in
                place. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {resetError ? (
              <p className="text-sm text-destructive" role="alert">
                {resetError}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={isSaving}
                onClick={(event) => {
                  event.preventDefault();
                  onReset();
                }}
              >
                {isSaving ? "Resetting…" : "Reset comparisons"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

function RankedScoreValues({
  asset,
  ranking,
  isSaving,
  onClearAdjustment,
  onRequestReset
}: {
  asset: AssetRecord;
  ranking: NonNullable<AssetRecord["ranking"]>;
  isSaving: boolean;
  onClearAdjustment: () => void;
  onRequestReset: () => void;
}) {
  return (
    <>
      <span>
        Comparison
        <span className="score-breakdown-value">
          <strong>{ranking.comparisonScore}</strong>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`Reset ${ranking.comparisonCount} comparisons for ${asset.name}`}
                disabled={isSaving}
                onClick={onRequestReset}
              >
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Reset this item’s comparisons and recalculate related scores
            </TooltipContent>
          </Tooltip>
        </span>
      </span>
      <span>
        Manual adjustment
        <span className="score-breakdown-value">
          <strong>{formatSignedScore(ranking.manualAdjustment)}</strong>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove the manual score adjustment for ${asset.name}`}
                disabled={isSaving || ranking.manualAdjustment === 0}
                onClick={onClearAdjustment}
              >
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Remove the manual adjustment and use the comparison score
            </TooltipContent>
          </Tooltip>
        </span>
      </span>
    </>
  );
}
