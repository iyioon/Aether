import { describe, expect, it } from "vitest";
import {
  rememberViewerFraming,
  viewerFramingForSession
} from "./useViewerFraming";

describe("full view framing defaults", () => {
  const closed = {
    mode: "remember" as const,
    isOpen: false,
    enabled: true,
    remembered: true
  };

  it("seeds fixed framing on open without replacing the remembered choice", () => {
    const configured = viewerFramingForSession(closed, "original", false);
    expect(configured.enabled).toBe(true);
    const opened = viewerFramingForSession(configured, "original", true);
    expect(opened.enabled).toBe(false);
    expect(opened.remembered).toBe(true);
    expect(viewerFramingForSession(opened, "original", true)).toBe(opened);
    expect(viewerFramingForSession(closed, "saved", true).enabled).toBe(true);
  });

  it("keeps temporary toggles through navigation and resets on the next open", () => {
    const opened = viewerFramingForSession(closed, "original", true);
    const toggled = rememberViewerFraming(opened, true);
    expect(viewerFramingForSession(toggled, "original", true)).toBe(toggled);
    const closedAgain = viewerFramingForSession(toggled, "original", false);
    expect(viewerFramingForSession(closedAgain, "original", true).enabled).toBe(
      false
    );
    expect(viewerFramingForSession(closedAgain, "remember", true).enabled).toBe(
      true
    );
  });

  it("remembers an explicit choice independently of the active fixed mode", () => {
    const opened = viewerFramingForSession(closed, "saved", true);
    const toggled = rememberViewerFraming(opened, false);
    expect(toggled.remembered).toBe(false);
    expect(opened.remembered).toBe(true);
    expect(rememberViewerFraming(toggled, false)).toBe(toggled);
    expect(viewerFramingForSession(toggled, "remember", true).enabled).toBe(
      false
    );
  });
});
