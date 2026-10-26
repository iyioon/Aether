import { useEffect, useState } from "react";
import {
  ApiError,
  getPresentationMediaCapabilities,
  type AssetRecord,
  type PresentationMediaCapabilities
} from "../../api/client";

const cached = new Map<string, PresentationMediaCapabilities>();
let generation = 0;
let active = 0;
const waiting: Array<() => void> = [];

async function readCapabilities(assetId: string, signal: AbortSignal) {
  if (active >= 3) {
    if (waiting.length >= 64)
      throw new Error("Media preparation is busy. Try again.");
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", abort);
        active++;
        resolve();
      };
      const abort = () => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      if (signal.aborted) return abort();
      waiting.push(start);
      signal.addEventListener("abort", abort, { once: true });
    });
  } else active++;
  try {
    signal.throwIfAborted();
    return await getPresentationMediaCapabilities(assetId, signal);
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export function clearPresentationCapabilities() {
  generation++;
  cached.clear();
}

export function usePresentationCapabilities(
  asset: AssetRecord,
  enabled = true
) {
  const key = [
    asset.id,
    asset.mtimeMs,
    asset.sizeBytes,
    asset.presentation?.renditionKeys.highlight,
    asset.presentation?.renditionKeys.bounce
  ].join(":");
  const [state, setState] = useState<{
    key: string;
    value: PresentationMediaCapabilities | null;
    error: unknown;
  }>(() => ({ key, value: cached.get(key) ?? null, error: null }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const currentGeneration = generation;
    const value = cached.get(key);
    if (value) {
      setState({ key, value, error: null });
      return;
    }
    setState((previous) => ({
      key,
      value: previous.key === key ? previous.value : null,
      error: null
    }));
    void readCapabilities(asset.id, controller.signal).then(
      (value) => {
        if (controller.signal.aborted || generation !== currentGeneration)
          return;
        cached.set(key, value);
        if (cached.size > 128) cached.delete(cached.keys().next().value!);
        setState({ key, value, error: null });
      },
      (error: unknown) => {
        if (!controller.signal.aborted && generation === currentGeneration)
          setState((previous) => ({
            key,
            value: previous.key === key ? previous.value : null,
            error
          }));
      }
    );
    return () => controller.abort();
  }, [asset.id, key, enabled, attempt]);
  return {
    capabilities: state.key === key ? state.value : null,
    error: state.key === key ? state.error : null,
    limitExceeded:
      state.key === key &&
      state.error instanceof ApiError &&
      state.error.code === "presentation_limit_exceeded",
    retry: () => {
      cached.delete(key);
      setAttempt((current) => current + 1);
    }
  };
}
