import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRandomOrderState,
  randomSeedForQuery
} from "./random-order-state";

describe("resumed random order", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("preserves the query seed across new reads and changes it for another query", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      }
    });
    let seed = 1;
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint32Array) => {
        array[0] = seed++;
        return array;
      }
    });
    expect(randomSeedForQuery("first")).toBe(1);
    expect(randomSeedForQuery("first")).toBe(1);
    expect(randomSeedForQuery("second")).toBe(2);
    clearRandomOrderState();
    expect(randomSeedForQuery("second")).toBe(3);
  });
  it("ignores invalid persisted seeds and tolerates storage restrictions", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () =>
          JSON.stringify({ version: 1, contextKey: "query", seed: -1 }),
        setItem: () => {
          throw Error("blocked");
        }
      }
    });
    expect(randomSeedForQuery("query")).toBeGreaterThanOrEqual(0);
  });
});
