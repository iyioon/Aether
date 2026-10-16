export interface RankingPairIds {
  pairAssetIds: [string, string];
}

export type PendingRankingMutation =
  | (RankingPairIds & {
      kind: "choice";
      mutationId: string;
      winnerAssetId: string;
      nextPairAssetIds?: [string, string];
    })
  | (RankingPairIds & {
      kind: "undo";
      mutationId: string;
      eventId: string;
    });

export interface RankingResumeState {
  contextKey: string;
  comparisonGeneration: string | null;
  pairAssetIds: [string, string] | null;
  previousDecision: (RankingPairIds & { eventId: string }) | null;
  pending: PendingRankingMutation | null;
}

export const RANKING_RESUME_STORAGE_KEY = "aether.ranking-resume.v1";
const MAX_SERIALIZED_LENGTH = 8_192;
export const MAX_RANKING_RESUME_CONTEXTS = 16;
const uuidPattern =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
let memoryStates = new Map<string, RankingResumeState>();
let hasReadStorage = false;
let generation = 0;
const resetListeners = new Set<() => void>();

export function rankingResumeGeneration(): number {
  return generation;
}

export function readRankingResumeState(
  contextKey: string
): RankingResumeState | null {
  if (!hasReadStorage && typeof window !== "undefined") {
    hasReadStorage = true;
    try {
      const serialized = window.localStorage.getItem(
        RANKING_RESUME_STORAGE_KEY
      );
      if (serialized !== null) {
        memoryStates = parseStoredContexts(serialized);
      }
    } catch {
      // Keep same-document restoration available when storage is blocked.
    }
  }
  return memoryStates.get(contextKey) ?? null;
}

export function writeRankingResumeState(
  state: RankingResumeState,
  expectedGeneration: number
): boolean {
  if (generation !== expectedGeneration) {
    return false;
  }
  if (
    !memoryStates.has(state.contextKey) &&
    memoryStates.size >= MAX_RANKING_RESUME_CONTEXTS
  ) {
    const disposable = [...memoryStates.values()].find(
      (stored) => stored.pending === null
    );
    if (!disposable) return false;
    memoryStates.delete(disposable.contextKey);
  }
  memoryStates.delete(state.contextKey);
  memoryStates.set(state.contextKey, state);
  hasReadStorage = true;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        RANKING_RESUME_STORAGE_KEY,
        JSON.stringify({ version: 1, states: [...memoryStates.values()] })
      );
    } catch {
      // Persistence is optional; a failed write must not interrupt ranking.
    }
  }
  return true;
}

export function completeRankingMutation(
  state: RankingResumeState,
  mutationId: string,
  expectedGeneration: number
): boolean {
  if (
    readRankingResumeState(state.contextKey)?.pending?.mutationId !== mutationId
  ) {
    return false;
  }
  return writeRankingResumeState(state, expectedGeneration);
}

export function subscribeToRankingResumeReset(
  listener: () => void
): () => void {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}

export function clearRankingResumeState(): void {
  generation += 1;
  memoryStates.clear();
  hasReadStorage = true;
  try {
    window.localStorage.removeItem(RANKING_RESUME_STORAGE_KEY);
  } catch {
    // Logout/reset must remain available when storage is blocked.
  }
  for (const listener of resetListeners) {
    listener();
  }
}

export function parseRankingResumeState(
  serialized: string | null
): RankingResumeState | null {
  if (!serialized || serialized.length > MAX_SERIALIZED_LENGTH) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.contextKey !== "string" ||
      parsed.contextKey.length > 4_096 ||
      !(
        parsed.comparisonGeneration === null ||
        isUuid(parsed.comparisonGeneration)
      ) ||
      !(parsed.pairAssetIds === null || isPair(parsed.pairAssetIds)) ||
      !(
        parsed.previousDecision === null ||
        isPreviousDecision(parsed.previousDecision)
      ) ||
      !(parsed.pending === null || isPendingMutation(parsed.pending))
    ) {
      return null;
    }
    return {
      contextKey: parsed.contextKey,
      comparisonGeneration: parsed.comparisonGeneration,
      pairAssetIds: parsed.pairAssetIds,
      previousDecision: parsed.previousDecision,
      pending: parsed.pending
    };
  } catch {
    return null;
  }
}

function parseStoredContexts(
  serialized: string
): Map<string, RankingResumeState> {
  const states = new Map<string, RankingResumeState>();
  if (serialized.length > MAX_SERIALIZED_LENGTH * MAX_RANKING_RESUME_CONTEXTS)
    return states;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || parsed.version !== 1) return states;
    if (
      Array.isArray(parsed.states) &&
      parsed.states.length <= MAX_RANKING_RESUME_CONTEXTS
    ) {
      for (const value of parsed.states) {
        const state = parseRankingResumeState(
          JSON.stringify({ version: 1, ...value })
        );
        if (!state) return new Map();
        states.set(state.contextKey, state);
      }
    } else {
      const state = parseRankingResumeState(serialized);
      if (state) states.set(state.contextKey, state);
    }
  } catch {
    // Ignore malformed or outdated resume records.
  }
  return states;
}

export function createRankingMutationId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isPair(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (id: unknown) =>
        typeof id === "string" && id.length > 0 && id.length <= 256
    ) &&
    value[0] !== value[1]
  );
}

function isPreviousDecision(
  value: unknown
): value is RankingPairIds & { eventId: string } {
  return isRecord(value) && isPair(value.pairAssetIds) && isUuid(value.eventId);
}

function isPendingMutation(value: unknown): value is PendingRankingMutation {
  if (
    !isRecord(value) ||
    !isPair(value.pairAssetIds) ||
    !isUuid(value.mutationId)
  ) {
    return false;
  }
  return value.kind === "choice"
    ? typeof value.winnerAssetId === "string" &&
        value.pairAssetIds.includes(value.winnerAssetId) &&
        (value.nextPairAssetIds === undefined || isPair(value.nextPairAssetIds))
    : value.kind === "undo" && isUuid(value.eventId);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
