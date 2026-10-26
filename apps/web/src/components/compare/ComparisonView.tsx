import { lazy, Suspense, useCallback, useState } from "react";
import type {
  AssetRecord,
  MediaTypeFilter,
  ScoreFilter
} from "../../api/client";
import { LeaderboardView } from "./LeaderboardView";
import { Card } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import type { GalleryMetadataField } from "../gallery/gallery-metadata";
import type { AspectMode } from "../library-state";
import type { ComparisonWorkspace } from "../app-navigation-state";

const loadRankingSession = () => import("./RankingSession");
const RankingSession = lazy(() =>
  loadRankingSession().then(({ RankingSession }) => ({
    default: RankingSession
  }))
);

function preloadRankingSession(): void {
  void loadRankingSession().catch(() => undefined);
}

interface ComparisonViewProps {
  measuredAspectRatios: Record<string, string>;
  onMediaDimensionsKnown: (
    assetId: string,
    width: number,
    height: number
  ) => void;
  aspect: AspectMode;
  metadataFields: ReadonlySet<GalleryMetadataField>;
  workspace: ComparisonWorkspace;
  onWorkspaceChange: (workspace: ComparisonWorkspace) => void;
  assetUpdate: AssetRecord | null;
  folderId: string | null;
  isPlaybackPaused: boolean;
  mediaType: MediaTypeFilter;
  scoreFilter: ScoreFilter;
  search: string;
  tagFilters: string[];
  onAssetsUpdated: (assets: AssetRecord[]) => void;
  onOpenFullscreen: (asset: AssetRecord) => void;
  onRankingChanged: () => void;
}

export function ComparisonView(props: ComparisonViewProps) {
  const onRankingChanged = props.onRankingChanged;
  const { workspace, onWorkspaceChange } = props;
  const [leaderboardRevision, setLeaderboardRevision] = useState(0);

  const openLeaderboard = useCallback(() => {
    setLeaderboardRevision((current) => current + 1);
    onWorkspaceChange("leaderboard");
  }, [onWorkspaceChange]);
  const handleRankingChanged = useCallback(() => {
    setLeaderboardRevision((current) => current + 1);
    onRankingChanged();
  }, [onRankingChanged]);

  if (workspace === "ranking") {
    return (
      <Suspense fallback={<RankingSessionLoading />}>
        <RankingSession
          {...props}
          onExit={openLeaderboard}
          onRankingChanged={handleRankingChanged}
        />
      </Suspense>
    );
  }

  return (
    <LeaderboardView
      assetUpdate={props.assetUpdate}
      folderId={props.folderId}
      mediaType={props.mediaType}
      refreshRevision={leaderboardRevision}
      scoreFilter={props.scoreFilter}
      search={props.search}
      tagFilters={props.tagFilters}
      onOpenFullscreen={props.onOpenFullscreen}
      onPrepareRanking={preloadRankingSession}
      onStartRanking={() => onWorkspaceChange("ranking")}
    />
  );
}

function RankingSessionLoading() {
  return (
    <section
      className="comparison-view"
      aria-busy="true"
      aria-label="Loading ranking session"
    >
      <div className="comparison-stage">
        <div className="comparison-pair">
          {["left", "right"].map((side) => (
            <Card className="comparison-card" key={side}>
              <Skeleton className="comparison-media" />
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
