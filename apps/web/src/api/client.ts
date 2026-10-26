export interface AuthState {
  authenticated: boolean;
  expiresAt: string | null;
}

export interface TreeRoot {
  id: string;
  folderId: string;
  label: string;
  assetCount: number;
}

export interface TreeResponse {
  roots: TreeRoot[];
  folders: Array<{
    id: string;
    rootId: string;
    parentId: string | null;
    relativePath: string;
    label: string;
    assetCount: number;
  }>;
}

export type MediaTypeFilter = "all" | "image" | "video";
export type SortMode = "date" | "filename" | "score" | "random";
export type SortDirection = "desc" | "asc";
export type ScoreFilter = "all" | "favorites" | "ranked" | "unranked";

export interface PresentationValues {
  highlight: { startMs: number; endMs: number } | null;
  fit: "auto" | "contain" | "cover";
  focalX: number;
  focalY: number;
  zoom: number;
  playbackRate: number;
  loopMode: "repeat" | "bounce";
}

export interface MediaPresentation extends PresentationValues {
  revision: number;
  renditionKeys: { full: string; highlight: string; bounce: string };
}

export interface PresentationMediaCapabilities {
  timingUnavailable?: boolean;
  kind: "still" | "video" | "animation";
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  maxBounceDurationMs: number;
  maxAnimationDurationMs?: number;
  maxAnimationFrames?: number;
  maxHighlightDurationMs?: number;
  renditionKeys: MediaPresentation["renditionKeys"];
}

export interface AnimationManifest {
  kind: "animation";
  durationMs: number;
  width: number;
  height: number;
  frames: Array<{
    startMs: number;
    durationMs: number;
    atlas: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  atlases: Array<{ url: string; width: number; height: number }>;
}

export interface AssetRecord {
  id: string;
  folderId: string | null;
  name: string;
  extension: string;
  mediaType: "image" | "video";
  mimeType: string | null;
  sizeBytes: number;
  mtimeMs: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  codec: string | null;
  status: string;
  error: string | null;
  score: number;
  ranking: {
    skill: number;
    comparisonScore: number;
    manualAdjustment: number;
    comparisonCount: number;
  } | null;
  favorite: boolean;
  tags: TagRecord[];
  presentation?: MediaPresentation;
}

export interface TagRecord {
  id: string;
  normalizedName: string;
  displayName: string;
  usageCount: number;
}

export interface TagSuggestion {
  displayName: string;
  normalizedName: string;
  confidence: number;
  source: "local-metadata" | "local-ai";
  reason: string;
}

export interface AiStatus {
  enabled: boolean;
  provider: "disabled" | "ollama";
  model: string | null;
}

export interface AssetListResponse {
  folderId: string;
  items: AssetRecord[];
  page: {
    offset: number;
    limit: number;
    total: number;
  };
  sort: SortMode;
  order: SortDirection;
  type: MediaTypeFilter;
  recursive: boolean;
  search: string;
  tags: string[];
  score: ScoreFilter;
  seed: number;
}

export interface BatchScoreResponse {
  assets: AssetRecord[];
  updated: number;
}

export interface BatchTagsResponse {
  tags: TagRecord[];
  updated: number;
}

export interface LibraryDataResetOptions {
  scores: boolean;
  favorites: boolean;
  tags: boolean;
  comparisons: boolean;
  presentationPlayback?: boolean;
  presentationFraming?: boolean;
}

export interface LibraryDataResetResult {
  scoresReset: number;
  favoritesReset: number;
  tagsRemoved: number;
  tagAssignmentsRemoved: number;
  comparisonPreferencesRemoved: number;
  comparisonEventsRemoved: number;
  playbackReset?: number;
  framingReset?: number;
}

export interface ComparisonPairResponse {
  comparisonGeneration: string;
  left: AssetRecord;
  right: AssetRecord;
  progress: {
    candidateCount: number;
    comparedCount: number;
    decidedPairCount: number;
  };
}

export interface ComparisonDecisionResponse {
  eventId: string;
  assetIds: [string, string];
  assets: AssetRecord[];
  nextPair?: ComparisonPairResponse | null;
  replacedDecision?: boolean;
  restoredDecision?: boolean;
}

export interface ComparisonPairContext {
  folderId: string;
  type: MediaTypeFilter;
  recursive: boolean;
  search: string;
  tags: string[];
  score: ScoreFilter;
}

export interface ComparisonSessionResumeResponse {
  comparisonGeneration: string;
  pair: ComparisonPairResponse | null;
  previousDecision: {
    eventId: string;
    pair: ComparisonPairResponse;
  } | null;
}

export interface ComparisonPrefetchResponse {
  comparisonGeneration: string;
  pairs: ComparisonPairResponse[];
}

export type ScanWarning = "derivative_cache_cleanup_failed";

export interface ScanResult {
  outcome: "completed" | "incomplete";
  incompleteReason: "source_changed_or_unavailable" | null;
  warnings: ScanWarning[];
  roots: number;
  folders: number;
  assets: number;
  skipped: number;
  errors: number;
  removedAssets: number;
  removedFolders: number;
  startedAt: string;
  finishedAt: string;
}

export interface ScanJob {
  id: string;
  type: string;
  status: "running" | "completed" | "incomplete" | "failed";
  attempts: number;
  error: string | null;
  result: ScanResult | null;
  progress: ScanProgress | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScanProgress {
  phase: "discovering" | "scanning" | "finalizing";
  processed: number;
  total: number | null;
  percent: number | null;
  currentPath: string | null;
}

export interface LibraryWatchStatus {
  enabled: boolean;
  running: boolean;
  debounceMs: number;
  watchedDirectories: number;
  lastEventAt: string | null;
  lastScanJobId: string | null;
  lastError: string | null;
}

export interface SettingsSummary {
  server: {
    environment: string;
    version: string | null;
  };
  library: {
    mediaRootCount: number;
    mediaRoots: Array<{
      id: string;
      label: string;
    }>;
    watchEnabled: boolean;
    watchDebounceMs: number;
    presentationEdits?: { playback: number; framing: number };
  };
  security: {
    passwordConfigured: boolean;
    cookieSecure: boolean;
    trustProxy: boolean;
    sessionTtlDays: number;
    loginMaxAttempts: number;
    loginWindowMinutes: number;
    loginLockoutMinutes: number;
  };
  ai: {
    enabled: boolean;
    provider: "disabled" | "ollama";
    model: string | null;
    timeoutMs: number;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export class ApiTimeoutError extends Error {
  readonly code = "request_timeout";

  constructor(public readonly timeoutMs: number) {
    super("The request timed out.");
    this.name = "ApiTimeoutError";
  }
}

export const API_REQUEST_TIMEOUT_MS = 30_000;
export const AI_REQUEST_TIMEOUT_MS = 330_000;
const MAINTENANCE_REQUEST_TIMEOUT_MS = 120_000;

type UnauthorizedListener = () => void;

const unauthorizedListeners = new Set<UnauthorizedListener>();

export function subscribeToUnauthorized(
  listener: UnauthorizedListener
): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) listener();
}

export async function getMe(signal?: AbortSignal): Promise<AuthState> {
  return request<AuthState>("/api/auth/me", { signal }, { recoverAuth: false });
}

export async function login(password: string): Promise<AuthState> {
  return request<AuthState>(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ password })
    },
    { recoverAuth: false }
  );
}

export async function logout(): Promise<AuthState> {
  return request<AuthState>("/api/auth/logout", {
    method: "POST"
  });
}

export async function getTree(signal?: AbortSignal): Promise<TreeResponse> {
  return request<TreeResponse>("/api/tree", { signal });
}

export async function getAsset(
  assetId: string,
  signal?: AbortSignal
): Promise<AssetRecord> {
  return request<AssetRecord>(`/api/assets/${encodeURIComponent(assetId)}`, {
    signal
  });
}

export async function getAssets(options: {
  folderId: string;
  offset?: number;
  limit?: number;
  sort?: SortMode;
  order?: SortDirection;
  type?: MediaTypeFilter;
  recursive?: boolean;
  search?: string;
  tags?: string[];
  score?: ScoreFilter;
  seed?: number;
  signal?: AbortSignal;
}): Promise<AssetListResponse> {
  const sort = options.sort ?? "date";
  const params = new URLSearchParams({
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 80),
    sort,
    order: options.order ?? defaultSortDirectionForApiSort(sort),
    type: options.type ?? "all",
    recursive: String(options.recursive ?? true),
    search: options.search ?? "",
    score: options.score ?? "all",
    seed: String(options.seed ?? 0)
  });

  for (const tag of options.tags ?? []) {
    params.append("tag", tag);
  }

  return request<AssetListResponse>(
    `/api/folders/${encodeURIComponent(options.folderId)}/assets?${params}`,
    { signal: options.signal }
  );
}

export async function getNextComparisonPair(options: {
  folderId: string;
  type?: MediaTypeFilter;
  recursive?: boolean;
  search?: string;
  tags?: string[];
  score?: ScoreFilter;
  excludeAssetIds?: string[];
  signal?: AbortSignal;
}): Promise<ComparisonPairResponse> {
  const params = new URLSearchParams({
    type: options.type ?? "all",
    recursive: String(options.recursive ?? true),
    search: options.search ?? "",
    score: options.score ?? "all"
  });

  for (const tag of options.tags ?? []) {
    params.append("tag", tag);
  }
  for (const assetId of options.excludeAssetIds ?? []) {
    params.append("exclude", assetId);
  }

  return request<ComparisonPairResponse>(
    `/api/folders/${encodeURIComponent(options.folderId)}/comparisons/next?${params}`,
    { signal: options.signal }
  );
}

export async function recordComparison(input: {
  leftAssetId: string;
  rightAssetId: string;
  winnerAssetId: string;
  pairContext?: ComparisonPairContext;
  mutationId?: string;
  comparisonGeneration?: string;
  nextPairAssetIds?: [string, string];
}): Promise<ComparisonDecisionResponse> {
  return request<ComparisonDecisionResponse>("/api/comparisons", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getComparisonPrefetch(
  input: ComparisonPairContext & {
    count: number;
    excludePairs: [string, string][];
    signal?: AbortSignal;
  }
): Promise<ComparisonPrefetchResponse> {
  const { folderId, signal, ...body } = input;
  return request<ComparisonPrefetchResponse>(
    `/api/folders/${encodeURIComponent(folderId)}/comparisons/prefetch`,
    { method: "POST", body: JSON.stringify(body), signal }
  );
}

export async function undoComparison(
  eventId: string,
  mutationId?: string,
  comparisonGeneration?: string
): Promise<ComparisonDecisionResponse> {
  return request<ComparisonDecisionResponse>(
    `/api/comparisons/${encodeURIComponent(eventId)}/undo`,
    {
      method: "POST",
      body: JSON.stringify({ mutationId, comparisonGeneration })
    }
  );
}

export async function resumeComparison(
  input: ComparisonPairContext & {
    pairAssetIds: [string, string] | null;
    previousDecision: {
      eventId: string;
      pairAssetIds: [string, string];
    } | null;
    signal?: AbortSignal;
  }
): Promise<ComparisonSessionResumeResponse> {
  const { folderId, signal, ...body } = input;
  return request<ComparisonSessionResumeResponse>(
    `/api/folders/${encodeURIComponent(folderId)}/comparisons/resume`,
    { method: "POST", body: JSON.stringify(body), signal }
  );
}

export async function startScan(): Promise<{ status: string; jobId: string }> {
  return request<{ status: string; jobId: string }>("/api/admin/scan", {
    method: "POST"
  });
}

export async function getScanJobs(
  signal?: AbortSignal
): Promise<{ jobs: ScanJob[] }> {
  return request<{ jobs: ScanJob[] }>("/api/admin/jobs", { signal });
}

export async function getWatchStatus(
  signal?: AbortSignal
): Promise<LibraryWatchStatus> {
  return request<LibraryWatchStatus>("/api/admin/watch", { signal });
}

export async function getAiStatus(signal?: AbortSignal): Promise<AiStatus> {
  return request<AiStatus>("/api/admin/ai", { signal });
}

export async function getSettings(
  signal?: AbortSignal
): Promise<SettingsSummary> {
  return request<SettingsSummary>("/api/admin/settings", { signal });
}

export async function getPresentationMediaCapabilities(
  assetId: string,
  signal?: AbortSignal
): Promise<PresentationMediaCapabilities> {
  return request<PresentationMediaCapabilities>(
    `/api/assets/${encodeURIComponent(assetId)}/presentation-media`,
    { signal },
    { timeoutMs: MEDIA_PREPARATION_TIMEOUT_MS }
  );
}

const MEDIA_PREPARATION_TIMEOUT_MS = 180_000;

export async function getAnimationManifest(
  assetId: string,
  renditionKey: string,
  signal?: AbortSignal
): Promise<AnimationManifest> {
  return request<AnimationManifest>(
    `/api/assets/${encodeURIComponent(assetId)}/animation?v=${encodeURIComponent(renditionKey)}`,
    { signal },
    { timeoutMs: MEDIA_PREPARATION_TIMEOUT_MS }
  );
}

export async function updateAssetPresentation(
  assetId: string,
  values: PresentationValues,
  expectedRevision: number
): Promise<AssetRecord> {
  const result = await request<{ asset: AssetRecord }>(
    `/api/assets/${encodeURIComponent(assetId)}/presentation`,
    {
      method: "PUT",
      body: JSON.stringify({ expectedRevision, ...values })
    },
    { timeoutMs: MEDIA_PREPARATION_TIMEOUT_MS }
  );
  return result.asset;
}

export async function resetLibraryData(
  options: LibraryDataResetOptions
): Promise<LibraryDataResetResult> {
  return request<LibraryDataResetResult>(
    "/api/admin/database/reset",
    {
      method: "POST",
      body: JSON.stringify({ ...options, confirmation: "RESET" })
    },
    { timeoutMs: MAINTENANCE_REQUEST_TIMEOUT_MS }
  );
}

function defaultSortDirectionForApiSort(sort: SortMode): SortDirection {
  return sort === "filename" ? "asc" : "desc";
}

export async function updateAssetScore(
  assetId: string,
  input: { score?: number; favorite?: boolean }
): Promise<{ asset: AssetRecord }> {
  return request<{ asset: AssetRecord }>(
    `/api/assets/${encodeURIComponent(assetId)}/score`,
    {
      method: "PATCH",
      body: JSON.stringify(input)
    }
  );
}

export async function clearAssetManualAdjustment(
  assetId: string
): Promise<{ asset: AssetRecord }> {
  return request<{ asset: AssetRecord }>(
    `/api/assets/${encodeURIComponent(assetId)}/score/manual-adjustment`,
    { method: "DELETE" }
  );
}

export async function resetAssetComparisons(assetId: string): Promise<{
  asset: AssetRecord;
  removedComparisons: number;
}> {
  return request<{
    asset: AssetRecord;
    removedComparisons: number;
  }>(`/api/assets/${encodeURIComponent(assetId)}/comparisons`, {
    method: "DELETE"
  });
}

export async function updateAssetScoresBatch(
  assetIds: string[],
  input: { score?: number; favorite?: boolean }
): Promise<BatchScoreResponse> {
  return request<BatchScoreResponse>("/api/assets/batch/scores", {
    method: "PATCH",
    body: JSON.stringify({ assetIds, ...input })
  });
}

export async function getAssetTags(
  assetId: string,
  signal?: AbortSignal
): Promise<{ tags: TagRecord[] }> {
  return request<{ tags: TagRecord[] }>(
    `/api/assets/${encodeURIComponent(assetId)}/tags`,
    { signal }
  );
}

export async function getAssetTagSuggestions(
  assetId: string,
  limit = 8
): Promise<{ suggestions: TagSuggestion[] }> {
  const params = new URLSearchParams({
    limit: String(limit)
  });

  return request<{ suggestions: TagSuggestion[] }>(
    `/api/assets/${encodeURIComponent(assetId)}/tag-suggestions?${params}`
  );
}

export async function getAiAssetTagSuggestions(
  assetId: string,
  limit = 8
): Promise<{
  suggestions: TagSuggestion[];
  provider: "ollama";
  model: string;
}> {
  const params = new URLSearchParams({
    limit: String(limit)
  });

  return request<{
    suggestions: TagSuggestion[];
    provider: "ollama";
    model: string;
  }>(
    `/api/assets/${encodeURIComponent(assetId)}/ai-tag-suggestions?${params}`,
    {
      method: "POST"
    },
    { timeoutMs: AI_REQUEST_TIMEOUT_MS }
  );
}

export async function setAssetTags(
  assetId: string,
  tags: string[]
): Promise<{ tags: TagRecord[] }> {
  return request<{ tags: TagRecord[] }>(
    `/api/assets/${encodeURIComponent(assetId)}/tags`,
    {
      method: "PUT",
      body: JSON.stringify({ tags })
    }
  );
}

export async function updateAssetTagsBatch(
  assetIds: string[],
  input: { tags: string[]; mode?: "add" | "replace" }
): Promise<BatchTagsResponse> {
  return request<BatchTagsResponse>("/api/assets/batch/tags", {
    method: "POST",
    body: JSON.stringify({ assetIds, ...input })
  });
}

export async function suggestTags(options: {
  query: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{ tags: TagRecord[] }> {
  const params = new URLSearchParams({
    q: options.query,
    limit: String(options.limit ?? 8)
  });

  return request<{ tags: TagRecord[] }>(`/api/tags/suggest?${params}`, {
    signal: options.signal
  });
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { recoverAuth?: boolean; timeoutMs?: number | null } = {}
): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const csrfToken =
    readCookie("__Host-aether_csrf") ?? readCookie("aether_csrf");
  if (csrfToken && isUnsafeMethod(init.method)) {
    headers.set("x-csrf-token", csrfToken);
  }

  const deadline = createRequestDeadline(
    init.signal,
    options.timeoutMs === undefined ? API_REQUEST_TIMEOUT_MS : options.timeoutMs
  );

  try {
    const response = await fetch(path, {
      ...init,
      headers,
      credentials: "include",
      signal: deadline.signal
    });

    if (!response.ok) {
      const payload = await safeJson(response);
      if (response.status === 401 && options.recoverAuth !== false) {
        notifyUnauthorized();
      }
      throw new ApiError(response.status, payload?.error ?? "request_failed");
    }

    return (await response.json()) as T;
  } catch (error) {
    if (deadline.didTimeout()) {
      throw new ApiTimeoutError(deadline.timeoutMs);
    }

    throw error;
  } finally {
    deadline.cleanup();
  }
}

interface RequestDeadline {
  cleanup: () => void;
  didTimeout: () => boolean;
  signal: AbortSignal | undefined;
  timeoutMs: number;
}

function createRequestDeadline(
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number | null
): RequestDeadline {
  if (timeoutMs === null) {
    return {
      cleanup: () => undefined,
      didTimeout: () => false,
      signal: callerSignal ?? undefined,
      timeoutMs: 0
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(
      new DOMException("The request timed out.", "TimeoutError")
    );
  }, timeoutMs);

  return {
    cleanup: () => {
      globalThis.clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
    didTimeout: () => timedOut,
    signal: controller.signal,
    timeoutMs
  };
}

function isUnsafeMethod(method: string | undefined): boolean {
  return method !== undefined && !["GET", "HEAD", "OPTIONS"].includes(method);
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const prefix = `${name}=`;
  const cookie = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));

  if (!cookie) {
    return null;
  }

  return decodeURIComponent(cookie.slice(prefix.length));
}

async function safeJson(
  response: Response
): Promise<{ error?: string } | null> {
  try {
    return (await response.json()) as { error?: string };
  } catch {
    return null;
  }
}
