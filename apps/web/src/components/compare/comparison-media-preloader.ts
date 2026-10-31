import type { AssetRecord, ComparisonPairResponse } from "../../api/client";
import { acquireMediaImagePreload } from "../media/media-image-cache";
import { mediaUrl, thumbnailUrl } from "../media/media-urls";
import { preloadVideoRange } from "../media/video-range-preload";

const MAX_PAIRS = 3;
const MAX_CONCURRENT_LOADS = 2;
const MEDIA_TIMEOUT_MS = 4_000;
const PAIR_WAIT_TIMEOUT_MS = 1_200;

type ComparisonMediaPair = Pick<ComparisonPairResponse, "left" | "right">;
type ResourceStatus = "queued" | "loading" | "ready" | "unavailable";

interface MediaResource {
  key: string;
  source: string;
  kind: "image" | "video";
  status: ResourceStatus;
  controller?: AbortController;
  release?: () => void;
  retryOnAbort?: boolean;
}

interface ConnectionInformation extends EventTarget {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
}

export interface ComparisonMediaPreloader {
  update: (pairs: readonly ComparisonMediaPair[]) => void;
  waitForPair: (
    pair: ComparisonMediaPair,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ) => Promise<void>;
  pause: () => void;
  resume: () => void;
  clear: () => void;
  dispose: () => void;
}

export function createComparisonMediaPreloader(): ComparisonMediaPreloader {
  const resources = new Map<string, MediaResource>();
  const listeners = new Set<() => void>();
  const connection = getConnection();
  let desiredPairs: readonly ComparisonMediaPair[] = [];
  let activeLoads = 0;
  let paused = false;
  let pageHidden = false;
  let disposed = false;
  let generation = 0;

  function isPaused(): boolean {
    return (
      paused ||
      pageHidden ||
      disposed ||
      typeof window === "undefined" ||
      (typeof document !== "undefined" &&
        document.visibilityState === "hidden") ||
      (typeof navigator !== "undefined" && navigator.onLine === false)
    );
  }

  function constrainedConnection(): boolean {
    return (
      connection?.saveData === true ||
      connection?.effectiveType === "slow-2g" ||
      connection?.effectiveType === "2g" ||
      (typeof connection?.downlink === "number" && connection.downlink < 1)
    );
  }

  function notify() {
    for (const listener of listeners) {
      listener();
    }
  }

  function abortResource(resource: MediaResource) {
    resource.retryOnAbort = true;
    resource.controller?.abort();
    resource.release?.();
    resource.release = undefined;
    if (resource.kind === "image" && resource.status === "ready") {
      resource.status = "queued";
    }
  }

  function update(pairs: readonly ComparisonMediaPair[]) {
    if (disposed) {
      return;
    }

    desiredPairs = pairs.slice(0, MAX_PAIRS);
    const selectedPairs = desiredPairs.slice(
      0,
      constrainedConnection() ? 1 : MAX_PAIRS
    );
    const wanted = getResources(selectedPairs, !constrainedConnection());
    const previousResources = new Map(resources);

    for (const [key, resource] of previousResources) {
      if (!wanted.has(key)) {
        abortResource(resource);
      }
    }
    resources.clear();
    for (const [key, resource] of wanted) {
      resources.set(key, previousResources.get(key) ?? resource);
    }
    pump();
    notify();
  }

  function pump() {
    if (isPaused()) {
      return;
    }

    const concurrency = constrainedConnection() ? 1 : MAX_CONCURRENT_LOADS;
    for (const resource of resources.values()) {
      if (activeLoads >= concurrency) {
        break;
      }
      if (resource.status === "queued") {
        startResource(resource);
      }
    }
  }

  function startResource(resource: MediaResource) {
    const controller = new AbortController();
    const startedGeneration = generation;
    resource.controller = controller;
    resource.retryOnAbort = false;
    resource.status = "loading";
    activeLoads += 1;
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      MEDIA_TIMEOUT_MS
    );
    let loading: Promise<boolean>;

    if (resource.kind === "image") {
      const handle = acquireMediaImagePreload(resource.source, {
        signal: controller.signal,
        timeoutMs: MEDIA_TIMEOUT_MS
      });
      resource.release = handle.release;
      loading = handle.promise;
    } else {
      loading = preloadVideoRange(resource.source, controller.signal);
    }

    void loading
      .catch(() => false)
      .then((ready) => {
        window.clearTimeout(timeoutId);
        activeLoads -= 1;
        resource.controller = undefined;
        if (
          resources.get(resource.key) === resource &&
          generation === startedGeneration
        ) {
          resource.status =
            resource.retryOnAbort || isPaused()
              ? "queued"
              : ready
                ? "ready"
                : "unavailable";
        }
        notify();
        pump();
      });
  }

  function stopLoads() {
    for (const resource of resources.values()) {
      abortResource(resource);
    }
    notify();
  }

  function pause() {
    paused = true;
    stopLoads();
  }

  function resume() {
    if (disposed) {
      return;
    }

    paused = false;
    for (const resource of resources.values()) {
      if (resource.status === "unavailable") {
        resource.status = "queued";
      }
    }
    update(desiredPairs);
  }

  function clear() {
    generation += 1;
    desiredPairs = [];
    stopLoads();
    resources.clear();
    notify();
  }

  function onLifecycleChange() {
    if (isPaused()) {
      stopLoads();
    } else {
      resume();
    }
  }

  function onPageHide() {
    pageHidden = true;
    stopLoads();
  }

  function onPageShow() {
    pageHidden = false;
    onLifecycleChange();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onLifecycleChange);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onLifecycleChange);
    window.addEventListener("offline", onLifecycleChange);
  }
  connection?.addEventListener("change", onLifecycleChange);

  function waitForPair(
    pair: ComparisonMediaPair,
    {
      signal,
      timeoutMs = PAIR_WAIT_TIMEOUT_MS
    }: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<void> {
    if (signal?.aborted || isPaused()) {
      return Promise.resolve();
    }
    const waitGeneration = generation;
    const pairCandidates = getResources([pair], !constrainedConnection());
    const posterResources = getResources([pair], false);
    if (
      !desiredPairs.some((entry) => samePair(entry, pair)) ||
      [...posterResources.keys()].some((key) => !resources.has(key))
    ) {
      for (const [key, resource] of resources) {
        if (resource.status === "loading" && !pairCandidates.has(key)) {
          abortResource(resource);
        }
      }
      update([pair, ...desiredPairs.filter((entry) => !samePair(entry, pair))]);
    }
    const pairResourceKeys = [...pairCandidates.keys()].filter((key) =>
      resources.has(key)
    );

    return new Promise<void>((resolve) => {
      let settled = false;
      const timeoutId = window.setTimeout(finish, Math.max(0, timeoutMs));
      function finish() {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        signal?.removeEventListener("abort", finish);
        listeners.delete(check);
        resolve();
      }
      function check() {
        if (
          isPaused() ||
          generation !== waitGeneration ||
          pairResourceKeys.every((key) => {
            const status = resources.get(key)?.status;
            return (
              status === undefined ||
              status === "ready" ||
              status === "unavailable"
            );
          })
        ) {
          finish();
        }
      }
      listeners.add(check);
      signal?.addEventListener("abort", finish, { once: true });
      check();
    });
  }

  function dispose() {
    disposed = true;
    clear();
    listeners.clear();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onLifecycleChange);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onLifecycleChange);
      window.removeEventListener("offline", onLifecycleChange);
    }
    connection?.removeEventListener("change", onLifecycleChange);
  }

  return { update, waitForPair, pause, resume, clear, dispose };
}

function getResources(
  pairs: readonly ComparisonMediaPair[],
  includeVideoData: boolean
): Map<string, MediaResource> {
  const resources = new Map<string, MediaResource>();
  const assets = new Map<string, AssetRecord>();
  for (const pair of pairs.slice(0, MAX_PAIRS)) {
    for (const asset of [pair.left, pair.right]) {
      if (assets.size < MAX_PAIRS * 2) {
        assets.set(asset.id, asset);
      }
    }
  }

  function add(source: string, kind: MediaResource["kind"]) {
    const key = `${kind}:${source}`;
    resources.set(key, { key, source, kind, status: "queued" });
  }

  for (const asset of assets.values()) {
    add(thumbnailUrl(asset), "image");
  }
  for (const asset of assets.values()) {
    if (asset.mediaType === "video" && includeVideoData) {
      add(mediaUrl(asset), "video");
    }
  }
  return resources;
}

function getConnection(): ConnectionInformation | undefined {
  return typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { connection?: ConnectionInformation })
        .connection;
}

function samePair(
  left: ComparisonMediaPair,
  right: ComparisonMediaPair
): boolean {
  return left.left.id === right.left.id && left.right.id === right.right.id;
}
