import { CornerUpLeft, Shuffle, Trophy } from "lucide-react";
import type { ComparisonPairResponse } from "../../api/client";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface ComparisonSessionFooterProps {
  canUndo: boolean;
  isLoading: boolean;
  isPairCommitted: boolean;
  isSubmitting: boolean;
  progress: ComparisonPairResponse["progress"];
  onExit: () => void;
  onSkip: () => void;
  onUndo: () => void;
}

export function ComparisonSessionFooter({
  canUndo,
  isLoading,
  isPairCommitted,
  isSubmitting,
  progress,
  onExit,
  onSkip,
  onUndo
}: ComparisonSessionFooterProps) {
  const rankedPercent =
    progress.candidateCount === 0
      ? 0
      : (progress.rankedCount / progress.candidateCount) * 100;

  return (
    <footer className="comparison-session-footer">
      <div className="comparison-progress" aria-label="Ranking coverage">
        <div className="comparison-progress-track">
          <Progress value={rankedPercent} />
          <span className="comparison-progress-mobile-count">
            {progress.rankedCount}/{progress.candidateCount}
          </span>
        </div>
        <div className="comparison-progress-details">
          <Badge variant="secondary">
            {progress.rankedCount} of {progress.candidateCount} ranked
          </Badge>
          <span>{progress.decidedPairCount} pair decisions</span>
        </div>
      </div>
      <div className="comparison-session-actions">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Open leaderboard"
              size="icon-sm"
              variant="outline"
              onClick={onExit}
            >
              <Trophy aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open leaderboard</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Undo last choice"
              disabled={!canUndo || isSubmitting}
              size="icon-sm"
              variant="outline"
              onClick={onUndo}
            >
              <CornerUpLeft aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo last choice</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Skip this pair"
              disabled={isSubmitting || isLoading || isPairCommitted}
              size="icon-sm"
              variant="ghost"
              onClick={onSkip}
            >
              <Shuffle aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Skip pair</TooltipContent>
        </Tooltip>
      </div>
    </footer>
  );
}
