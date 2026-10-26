import { CornerUpLeft, Ratio, Shuffle, Trophy } from "lucide-react";
import type { ComparisonPairResponse } from "../../api/client";
import { aspectOptions, type AspectMode } from "../library-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface ComparisonSessionFooterProps {
  aspect: AspectMode;
  onAspectChange: (aspect: AspectMode) => void;
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
  aspect,
  onAspectChange,
  canUndo,
  isLoading,
  isPairCommitted,
  isSubmitting,
  progress,
  onExit,
  onSkip,
  onUndo
}: ComparisonSessionFooterProps) {
  const comparedPercent =
    progress.candidateCount === 0
      ? 0
      : (progress.comparedCount / progress.candidateCount) * 100;

  return (
    <footer className="comparison-session-footer">
      <div className="comparison-progress" aria-label="Comparison coverage">
        <div className="comparison-progress-track">
          <Progress value={comparedPercent} />
          <span className="comparison-progress-mobile-count">
            {progress.comparedCount}/{progress.candidateCount}
          </span>
        </div>
        <div className="comparison-progress-details">
          <Badge variant="secondary">
            {progress.comparedCount} of {progress.candidateCount} compared
          </Badge>
          <span>
            {progress.decidedPairCount} active{" "}
            {progress.decidedPairCount === 1 ? "pair" : "pairs"}
          </span>
        </div>
      </div>
      <div className="comparison-session-actions">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Comparison aspect ratio"
              title={`Aspect ratio: ${aspect}`}
              size="icon-sm"
              variant="outline"
            >
              <Ratio aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="comparison-aspect-menu">
            <DropdownMenuRadioGroup
              value={aspect}
              onValueChange={(value) => {
                if (aspectOptions.some((option) => option === value))
                  onAspectChange(value as AspectMode);
              }}
            >
              {[
                "Original",
                ...aspectOptions.filter((option) => option !== "Original")
              ].map((option) => (
                <DropdownMenuRadioItem key={option} value={option}>
                  {option}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
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
