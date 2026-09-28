import { lazy, Suspense, useCallback, useState } from "react";
import type {
  AssetRecord,
  MediaTypeFilter,
  ScoreFilter
} from "../../api/client";
import { LeaderboardView } from "./LeaderboardView";
import { Card } from "../ui/card";
import { Skeleton } from "../ui/skeleton";

const RankingSession = lazy(() =>
  import("./RankingSession").then(({ RankingSession }) => ({
    default: RankingSession
  }))
);

interface ComparisonViewProps {
  assetUpdate: AssetRecord | null;
  folderId: string | null;
  mediaType: MediaTypeFilter;
  scoreFilter: ScoreFilter;
  search: string;
  tagFilters: string[];
  onAssetsUpdated: (assets: AssetRecord[]) => void;
  onOpenFullscreen: (asset: AssetRecord) => void;
  onRankingChanged: () => void;
}

type ComparisonWorkspace = "leaderboard" | "ranking";

export function ComparisonView(props: ComparisonViewProps) {
  const [workspace, setWorkspace] =
    useState<ComparisonWorkspace>("leaderboard");
  const [leaderboardRevision, setLeaderboardRevision] = useState(0);
  const openLeaderboard = useCallback(() => {
    setLeaderboardRevision((current) => current + 1);
    setWorkspace("leaderboard");
  }, []);

  if (workspace === "ranking") {
    return (
      <Suspense fallback={<RankingSessionLoading />}>
        <RankingSession {...props} onExit={openLeaderboard} />
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
      onStartRanking={() => setWorkspace("ranking")}
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
