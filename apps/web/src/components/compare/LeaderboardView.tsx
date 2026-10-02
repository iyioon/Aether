import {
  ArrowRight,
  GitCompareArrows,
  Maximize2,
  RefreshCw,
  Trophy
} from "lucide-react";
import { useMemo } from "react";
import type {
  AssetRecord,
  MediaTypeFilter,
  ScoreFilter
} from "../../api/client";
import { MediaPreview } from "../media/MediaPreview";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Separator } from "../ui/separator";
import { Skeleton } from "../ui/skeleton";
import {
  buildLeaderboardEntries,
  type LeaderboardEntry
} from "./leaderboard-model";
import { useLeaderboard } from "./useLeaderboard";

interface LeaderboardViewProps {
  assetUpdate: AssetRecord | null;
  folderId: string | null;
  mediaType: MediaTypeFilter;
  refreshRevision: number;
  scoreFilter: ScoreFilter;
  search: string;
  tagFilters: string[];
  onOpenFullscreen: (asset: AssetRecord) => void;
  onPrepareRanking: () => void;
  onStartRanking: () => void;
}

export function LeaderboardView({
  assetUpdate,
  folderId,
  mediaType,
  refreshRevision,
  scoreFilter,
  search,
  tagFilters,
  onOpenFullscreen,
  onPrepareRanking,
  onStartRanking
}: LeaderboardViewProps) {
  const {
    assets,
    error,
    hasMore,
    isLoading,
    isLoadingMore,
    loadMore,
    reload,
    total
  } = useLeaderboard({
    assetUpdate,
    folderId,
    mediaType,
    refreshRevision,
    scoreFilter,
    search,
    tagFilters
  });
  const { entries, featuredEntries, remainingEntries } = useMemo(() => {
    const nextEntries = buildLeaderboardEntries(assets);
    const nextFeaturedEntries = nextEntries
      .filter((entry) => entry.rank !== null)
      .slice(0, 3);
    const featuredIds = new Set(
      nextFeaturedEntries.map((entry) => entry.asset.id)
    );

    return {
      entries: nextEntries,
      featuredEntries: nextFeaturedEntries,
      remainingEntries: nextEntries.filter(
        (entry) => !featuredIds.has(entry.asset.id)
      )
    };
  }, [assets]);

  return (
    <section className="leaderboard-view" aria-labelledby="leaderboard-title">
      <header className="leaderboard-header">
        <div className="leaderboard-heading">
          <div className="leaderboard-eyebrow">
            <Trophy aria-hidden="true" />
            Compare and rank
          </div>
          <h1 id="leaderboard-title">Leaderboard</h1>
          <p>
            Media is ordered by final score. Your current folder, search, and
            filters apply.
          </p>
        </div>
        <Button
          size="lg"
          onFocus={onPrepareRanking}
          onPointerDown={onPrepareRanking}
          onPointerEnter={onPrepareRanking}
          onClick={onStartRanking}
        >
          <GitCompareArrows aria-hidden="true" />
          Rank media
          <ArrowRight aria-hidden="true" />
        </Button>
      </header>

      <Separator />

      <div className="leaderboard-summary">
        <span>
          <strong>{total}</strong> {total === 1 ? "item" : "items"}
        </span>
        <span>Final score · highest first</span>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Leaderboard unavailable</AlertTitle>
          <AlertDescription>
            <span>{friendlyLeaderboardError(error)}</span>
            <Button size="sm" variant="outline" onClick={reload}>
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {isLoading ? (
        <LeaderboardSkeleton />
      ) : error && entries.length === 0 ? null : entries.length === 0 ? (
        <LeaderboardEmptyState
          hasFolder={folderId !== null}
          onPrepareRanking={onPrepareRanking}
          onStartRanking={onStartRanking}
        />
      ) : (
        <>
          {featuredEntries.length > 0 ? (
            <div className="leaderboard-featured" aria-label="Top ranked media">
              {featuredEntries.map((entry) => (
                <FeaturedEntry
                  entry={entry}
                  key={entry.asset.id}
                  onOpen={() => onOpenFullscreen(entry.asset)}
                />
              ))}
            </div>
          ) : null}

          {remainingEntries.length > 0 ? (
            <ol className="leaderboard-list" aria-label="Leaderboard entries">
              {remainingEntries.map((entry) => (
                <LeaderboardRow
                  entry={entry}
                  key={entry.asset.id}
                  onOpen={() => onOpenFullscreen(entry.asset)}
                />
              ))}
            </ol>
          ) : null}

          {hasMore ? (
            <div className="leaderboard-load-more">
              <Button
                disabled={isLoadingMore}
                variant="outline"
                onClick={() => void loadMore()}
              >
                {isLoadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function FeaturedEntry({
  entry,
  onOpen
}: {
  entry: LeaderboardEntry;
  onOpen: () => void;
}) {
  return (
    <Card className="leaderboard-featured-card">
      <CardContent className="leaderboard-featured-media">
        <MediaPreview asset={entry.asset} staticPreview />
      </CardContent>
      <div className="leaderboard-featured-details">
        <Badge className="leaderboard-rank-badge" variant="secondary">
          #{entry.rank}
        </Badge>
        <div>
          <strong title={entry.asset.name}>{entry.asset.name}</strong>
          <span>{entry.asset.mediaType === "video" ? "Video" : "Image"}</span>
        </div>
        <ScoreBadge asset={entry.asset} />
      </div>
      <Button
        className="leaderboard-card-action"
        type="button"
        variant="ghost"
        aria-label={`Open ${entry.asset.name} fullscreen`}
        onClick={onOpen}
      >
        <span className="sr-only">Open {entry.asset.name} fullscreen</span>
      </Button>
      <Maximize2 className="leaderboard-open-icon" aria-hidden="true" />
    </Card>
  );
}

function LeaderboardRow({
  entry,
  onOpen
}: {
  entry: LeaderboardEntry;
  onOpen: () => void;
}) {
  return (
    <li>
      <Card className="leaderboard-row">
        <span className="leaderboard-row-rank" aria-label={rankLabel(entry)}>
          {entry.rank === null ? "—" : entry.rank}
        </span>
        <div className="leaderboard-row-media">
          <MediaPreview
            asset={entry.asset}
            isActive={false}
            staticPreview
            thumbnailSize={192}
          />
        </div>
        <div className="leaderboard-row-details">
          <strong title={entry.asset.name}>{entry.asset.name}</strong>
          <span>
            {entry.rank === null ? "Unranked" : comparisonSummary(entry.asset)}
          </span>
        </div>
        <ScoreBadge asset={entry.asset} />
        <Button
          className="leaderboard-card-action"
          type="button"
          variant="ghost"
          aria-label={`Open ${entry.asset.name} fullscreen`}
          onClick={onOpen}
        >
          <span className="sr-only">Open {entry.asset.name} fullscreen</span>
        </Button>
      </Card>
    </li>
  );
}

function ScoreBadge({ asset }: { asset: AssetRecord }) {
  return (
    <Badge className="leaderboard-score" variant="outline">
      <span>Score</span>
      <strong>{asset.score}</strong>
    </Badge>
  );
}

function LeaderboardEmptyState({
  hasFolder,
  onPrepareRanking,
  onStartRanking
}: {
  hasFolder: boolean;
  onPrepareRanking: () => void;
  onStartRanking: () => void;
}) {
  return (
    <Card className="leaderboard-empty">
      <Trophy aria-hidden="true" />
      <h2>{hasFolder ? "No media matches" : "Choose a folder"}</h2>
      <p>
        {hasFolder
          ? "Adjust the active filters or start ranking media to build this leaderboard."
          : "Select a folder to see its leaderboard and begin ranking."}
      </p>
      {hasFolder ? (
        <Button
          onFocus={onPrepareRanking}
          onPointerDown={onPrepareRanking}
          onPointerEnter={onPrepareRanking}
          onClick={onStartRanking}
        >
          <GitCompareArrows aria-hidden="true" />
          Rank media
        </Button>
      ) : null}
    </Card>
  );
}

function LeaderboardSkeleton() {
  return (
    <div
      className="leaderboard-skeleton"
      role="status"
      aria-label="Loading leaderboard"
    >
      <div className="leaderboard-featured">
        {[0, 1, 2].map((index) => (
          <Card className="leaderboard-featured-card" key={index}>
            <Skeleton className="leaderboard-featured-media" />
            <div className="leaderboard-featured-details">
              <Skeleton className="h-6 w-9 rounded-full" />
              <Skeleton className="h-9 flex-1" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </Card>
        ))}
      </div>
      <div className="leaderboard-list">
        {[0, 1, 2].map((index) => (
          <Skeleton className="h-20 w-full rounded-xl" key={index} />
        ))}
      </div>
    </div>
  );
}

function rankLabel(entry: LeaderboardEntry): string {
  return entry.rank === null ? "Unranked" : `Rank ${entry.rank}`;
}

function comparisonSummary(asset: AssetRecord): string {
  if (!asset.ranking) {
    return "Manual score";
  }

  return `${asset.ranking.comparisonCount} pair ${
    asset.ranking.comparisonCount === 1 ? "decision" : "decisions"
  }`;
}

function friendlyLeaderboardError(error: string): string {
  return error === "folder_not_found"
    ? "The selected folder is no longer available."
    : "The leaderboard could not be loaded. Your scores are unchanged.";
}
