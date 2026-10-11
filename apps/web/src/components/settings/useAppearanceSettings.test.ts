import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readStoredAccent,
  readStoredCustomAccent,
  readStoredTheme,
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem
} from "./useAppearanceSettings";

describe("appearance storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to defaults when Safari blocks localStorage access", () => {
    const blockedWindow = {};
    Object.defineProperty(blockedWindow, "localStorage", {
      get() {
        throw new DOMException("Storage is blocked.", "SecurityError");
      }
    });
    vi.stubGlobal("window", blockedWindow);

    expect(readStoredAccent()).toBe("graphite");
    expect(readStoredCustomAccent()).toBe("#8aaee0");
    expect(readStoredTheme()).toBe("dark");
    expect(safeLocalStorageSetItem("key", "value")).toBe(false);
    expect(safeLocalStorageRemoveItem("key")).toBe(false);
  });

  it("ignores quota and privacy errors without retrying or throwing", () => {
    const storage = createMemoryStorage();
    const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded.", "QuotaExceededError");
    });
    const removeItem = vi
      .spyOn(storage, "removeItem")
      .mockImplementation(() => {
        throw new DOMException("Storage is blocked.", "SecurityError");
      });
    vi.stubGlobal("window", { localStorage: storage });

    expect(safeLocalStorageSetItem("theme", "dark")).toBe(false);
    expect(safeLocalStorageRemoveItem("theme")).toBe(false);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(removeItem).toHaveBeenCalledTimes(1);
  });

  it("reads, writes, and removes values when storage is available", () => {
    const storage = createMemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });

    expect(safeLocalStorageSetItem("theme", "light")).toBe(true);
    expect(safeLocalStorageGetItem("theme")).toBe("light");
    expect(safeLocalStorageRemoveItem("theme")).toBe(true);
    expect(safeLocalStorageGetItem("theme")).toBeNull();
  });
});

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key) {
      return entries.get(key) ?? null;
    },
    key(index) {
      return [...entries.keys()][index] ?? null;
    },
    removeItem(key) {
      entries.delete(key);
    },
    setItem(key, value) {
      entries.set(key, value);
    }
  };
}
