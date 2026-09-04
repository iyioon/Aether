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
export type SortMode = "newest" | "oldest" | "filename" | "rating" | "random";
export type RatingFilter = "all" | "favorites" | "rated" | "unrated";

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
  rating: number | null;
  favorite: boolean;
  tags: TagRecord[];
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
  type: MediaTypeFilter;
  recursive: boolean;
  search: string;
  tag: string;
  rating: RatingFilter;
}

export interface BatchRatingResponse {
  assets: AssetRecord[];
  updated: number;
}

export interface BatchTagsResponse {
  tags: TagRecord[];
  updated: number;
}

export interface ScanJob {
  id: string;
  type: string;
  status: "running" | "completed" | "failed";
  attempts: number;
  error: string | null;
  result: unknown;
  createdAt: string;
  updatedAt: string;
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

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export async function getMe(): Promise<AuthState> {
  return request<AuthState>("/api/auth/me");
}

export async function login(password: string): Promise<AuthState> {
  return request<AuthState>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export async function logout(): Promise<AuthState> {
  return request<AuthState>("/api/auth/logout", {
    method: "POST"
  });
}

export async function getTree(): Promise<TreeResponse> {
  return request<TreeResponse>("/api/tree");
}

export async function getAssets(options: {
  folderId: string;
  offset?: number;
  limit?: number;
  sort?: SortMode;
  type?: MediaTypeFilter;
  recursive?: boolean;
  search?: string;
  tag?: string;
  rating?: RatingFilter;
}): Promise<AssetListResponse> {
  const params = new URLSearchParams({
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 80),
    sort: options.sort ?? "newest",
    type: options.type ?? "all",
    recursive: String(options.recursive ?? true),
    search: options.search ?? "",
    tag: options.tag ?? "",
    rating: options.rating ?? "all"
  });

  return request<AssetListResponse>(
    `/api/folders/${encodeURIComponent(options.folderId)}/assets?${params}`
  );
}

export async function startScan(): Promise<{ status: string; jobId: string }> {
  return request<{ status: string; jobId: string }>("/api/admin/scan", {
    method: "POST"
  });
}

export async function getScanJobs(): Promise<{ jobs: ScanJob[] }> {
  return request<{ jobs: ScanJob[] }>("/api/admin/jobs");
}

export async function getWatchStatus(): Promise<LibraryWatchStatus> {
  return request<LibraryWatchStatus>("/api/admin/watch");
}

export async function getAiStatus(): Promise<AiStatus> {
  return request<AiStatus>("/api/admin/ai");
}

export async function updateAssetRating(
  assetId: string,
  input: { rating?: number | null; favorite?: boolean }
): Promise<{ asset: AssetRecord }> {
  return request<{ asset: AssetRecord }>(
    `/api/assets/${encodeURIComponent(assetId)}/rating`,
    {
      method: "PATCH",
      body: JSON.stringify(input)
    }
  );
}

export async function updateAssetRatingsBatch(
  assetIds: string[],
  input: { rating?: number | null; favorite?: boolean }
): Promise<BatchRatingResponse> {
  return request<BatchRatingResponse>("/api/assets/batch/ratings", {
    method: "PATCH",
    body: JSON.stringify({ assetIds, ...input })
  });
}

export async function getAssetTags(assetId: string): Promise<{ tags: TagRecord[] }> {
  return request<{ tags: TagRecord[] }>(
    `/api/assets/${encodeURIComponent(assetId)}/tags`
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
  }>(`/api/assets/${encodeURIComponent(assetId)}/ai-tag-suggestions?${params}`, {
    method: "POST"
  });
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
}): Promise<{ tags: TagRecord[] }> {
  const params = new URLSearchParams({
    q: options.query,
    limit: String(options.limit ?? 8)
  });

  return request<{ tags: TagRecord[] }>(`/api/tags/suggest?${params}`);
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const csrfToken = readCookie("aether_csrf") ?? readCookie("__Host-aether_csrf");
  if (csrfToken && isUnsafeMethod(init.method)) {
    headers.set("x-csrf-token", csrfToken);
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include"
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new ApiError(response.status, payload?.error ?? "request_failed");
  }

  return response.json() as Promise<T>;
}

function isUnsafeMethod(method: string | undefined): boolean {
  return method !== undefined && !["GET", "HEAD", "OPTIONS"].includes(method);
}

function readCookie(name: string): string | null {
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

async function safeJson(response: Response): Promise<{ error?: string } | null> {
  try {
    return (await response.json()) as { error?: string };
  } catch {
    return null;
  }
}
