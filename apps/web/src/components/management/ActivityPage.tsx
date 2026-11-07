import { useCallback, useEffect, useRef, useState } from "react";
import { File, RefreshCw } from "lucide-react";
import type { FileOperation } from "../../api/client";
import type { Transfer, useMediaUploads } from "./useMediaUploads";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Progress } from "../ui/progress";
import { Skeleton } from "../ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { formatBytes } from "../media/media-format";
import { ActivityOperation, ActivityStatus } from "./ActivityOperations";
import { activityNeedsAttention } from "./activity-model";

type Uploads = ReturnType<typeof useMediaUploads>;
const uploadStatusLabels: Record<Transfer["state"], string> = {
  queued: "Queued",
  uploading: "Uploading",
  paused: "Paused",
  checking: "Checking",
  received: "Preparing media",
  error: "Paused",
  cancelled: "Cancelled",
  failed: "Failed",
  completed: "Completed",
  expired: "Expired"
};
function transferNeedsAttention(transfer: Transfer) {
  return ["paused", "error", "failed", "expired"].includes(transfer.state);
}

function UploadDetails({
  transfer,
  uploads
}: {
  transfer: Transfer;
  uploads: Uploads;
}) {
  const [reselecting, setReselecting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (reselecting) inputRef.current?.focus();
  }, [reselecting]);
  const terminal = ["completed", "cancelled", "failed", "expired"].includes(
    transfer.state
  );
  return (
    <>
      {!terminal && transfer.state !== "received" ? (
        <div className="activity-item-progress">
          <Progress
            value={
              transfer.size
                ? Math.min(100, (transfer.accepted / transfer.size) * 100)
                : 0
            }
            aria-label={"Upload " + transfer.name}
          />
          <span>
            {formatBytes(transfer.accepted)} of {formatBytes(transfer.size)}
          </span>
        </div>
      ) : (
        <p className="activity-item-summary">{formatBytes(transfer.size)}</p>
      )}
      {transfer.error ? (
        <p role="alert" className="activity-item-error">
          {transfer.error}
        </p>
      ) : null}
      {transfer.state === "uploading" ||
      ["paused", "error", "queued", "checking"].includes(transfer.state) ? (
        <div className="activity-item-actions">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void uploads.cancel(transfer)}
          >
            Cancel
          </Button>
          {transfer.state === "uploading" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => uploads.pause(transfer)}
            >
              Pause
            </Button>
          ) : ["paused", "error"].includes(transfer.state) ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={uploads.running >= 2}
              onClick={() => {
                if (transfer.file) void uploads.resume(transfer, transfer.file);
                else setReselecting(true);
              }}
            >
              Resume
            </Button>
          ) : null}
        </div>
      ) : null}
      {reselecting && ["paused", "error"].includes(transfer.state) ? (
        <div className="activity-reselect">
          <Label htmlFor={"resume-file-" + transfer.key}>
            Reselect {transfer.name}
          </Label>
          <Input
            id={"resume-file-" + transfer.key}
            ref={inputRef}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void uploads.resume(transfer, file);
                setReselecting(false);
              }
            }}
          />
        </div>
      ) : null}
    </>
  );
}

export function ActivityPage({
  uploads,
  operations,
  onRefresh,
  onOperation,
  onRetry
}: {
  uploads: Uploads;
  operations: FileOperation[];
  onRefresh: (signal?: AbortSignal) => Promise<void>;
  onOperation: (operation: FileOperation, notify: boolean) => void;
  onRetry: (operation: FileOperation) => Promise<FileOperation>;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshUploads = uploads.refresh;
  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      onRefresh(controller.signal),
      refreshUploads(controller.signal)
    ]);
    if (controller.signal.aborted) return;
    if (results.some((result) => result.status === "rejected"))
      setError("Activity could not be fully loaded. Try again.");
    setLoading(false);
  }, [onRefresh, refreshUploads]);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    void refresh();
    return () => requestRef.current?.abort();
  }, [refresh]);
  const transfers = uploads.transfers;
  const byId = new Map(
    operations.map((operation) => [operation.id, operation])
  );
  const transferIds = new Set(
    transfers.map((transfer) => transfer.operationId)
  );
  const entries = [
    ...transfers.map((transfer) => ({
      key: "upload-" + transfer.key,
      transfer,
      operation: byId.get(transfer.operationId)
    })),
    ...operations
      .filter((operation) => !transferIds.has(operation.id))
      .map((operation) => ({
        key: operation.id,
        transfer: undefined,
        operation
      }))
  ]
    .filter(
      ({ operation, transfer }) =>
        filter === "all" ||
        (operation
          ? activityNeedsAttention(operation)
          : transferNeedsAttention(transfer!))
    )
    .sort((left, right) => {
      const active = (entry: typeof left) =>
        entry.operation
          ? ["queued", "running", "needs_attention"].includes(
              entry.operation.status
            )
          : !["completed", "cancelled", "failed", "expired"].includes(
              entry.transfer!.state
            );
      return (
        Number(active(right)) - Number(active(left)) ||
        (Date.parse(right.operation?.createdAt ?? "") || 0) -
          (Date.parse(left.operation?.createdAt ?? "") || 0)
      );
    });
  return (
    <section
      className="activity-page mx-auto w-full max-w-5xl p-4 md:p-6"
      aria-label="Activity"
    >
      <h1 ref={headingRef} tabIndex={-1} className="sr-only outline-none">
        Activity
      </h1>
      <Tabs
        value={filter}
        onValueChange={setFilter}
        className="activity-layout"
      >
        <div className="activity-toolbar">
          <TabsList variant="line" aria-label="Activity filter">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="attention">Needs attention</TabsTrigger>
          </TabsList>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Refresh Activity"
            title="Refresh Activity"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw
              aria-hidden="true"
              className={loading ? "motion-safe:animate-spin" : undefined}
            />
          </Button>
        </div>
        <TabsContent value={filter} className="activity-body">
          {error ? (
            <div className="activity-load-error" role="alert">
              <p>{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refresh()}
              >
                Retry loading Activity
              </Button>
            </div>
          ) : null}
          {loading && !entries.length ? (
            <div
              className="activity-list"
              role="status"
              aria-label="Loading Activity"
            >
              {[0, 1, 2].map((key) => (
                <div key={key} className="p-4">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-3 h-3 w-1/3" />
                </div>
              ))}
            </div>
          ) : entries.length ? (
            <div className="activity-list">
              {entries.map(({ key, operation, transfer }) =>
                operation ? (
                  <ActivityOperation
                    key={key}
                    operation={operation}
                    primaryName={transfer?.name}
                    onOperation={onOperation}
                    onRetry={onRetry}
                  >
                    {transfer ? (
                      <p className="activity-item-summary">
                        {formatBytes(transfer.size)}
                      </p>
                    ) : null}
                  </ActivityOperation>
                ) : (
                  <section
                    key={key}
                    className="activity-item"
                    aria-label={"Upload " + transfer!.name}
                  >
                    <span className="activity-item-icon" aria-hidden="true">
                      <File />
                    </span>
                    <div className="activity-item-content">
                      <div className="activity-item-heading">
                        <strong className="activity-item-name">
                          {transfer!.name}
                        </strong>
                        <ActivityStatus
                          label={uploadStatusLabels[transfer!.state]}
                          attention={["error", "failed", "expired"].includes(
                            transfer!.state
                          )}
                          running={[
                            "uploading",
                            "checking",
                            "received"
                          ].includes(transfer!.state)}
                          completed={transfer!.state === "completed"}
                        />
                      </div>
                      <p className="activity-item-meta">Upload</p>
                      <UploadDetails transfer={transfer!} uploads={uploads} />
                    </div>
                  </section>
                )
              )}
            </div>
          ) : !error ? (
            <div className="activity-empty">
              <p>
                {filter === "attention"
                  ? "No activity needs attention."
                  : "No recent activity."}
              </p>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  );
}
