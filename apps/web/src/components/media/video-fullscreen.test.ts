import { describe, expect, it, vi } from "vitest";
import {
  canPresentVideoFullscreen,
  toggleVideoFullscreen
} from "./video-fullscreen";

describe("video fullscreen", () => {
  it("uses container fullscreen so shared controls remain available", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const container = { requestFullscreen } as unknown as HTMLElement;
    const owner = {
      fullscreenEnabled: true,
      fullscreenElement: null
    } as Document;
    expect(canPresentVideoFullscreen(container, null, owner)).toBe(true);
    expect(await toggleVideoFullscreen(container, null, owner)).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it("exits fullscreen without closing the viewer", async () => {
    const container = {} as HTMLElement;
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    const owner = {
      fullscreenElement: container,
      exitFullscreen
    } as unknown as Document;
    expect(await toggleVideoFullscreen(container, null, owner)).toBe(true);
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it("uses iPhone native video fullscreen when container fullscreen is unavailable", async () => {
    const requestFullscreen = vi.fn();
    const webkitEnterFullscreen = vi.fn();
    const container = { requestFullscreen } as unknown as HTMLElement;
    const video = {
      readyState: 1,
      webkitEnterFullscreen,
      webkitSupportsFullscreen: true
    } as unknown as HTMLVideoElement;
    const owner = { fullscreenEnabled: false } as Document;
    expect(canPresentVideoFullscreen(container, video, owner)).toBe(true);
    expect(await toggleVideoFullscreen(container, video, owner)).toBe(true);
    expect(webkitEnterFullscreen).toHaveBeenCalledOnce();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("does not offer unavailable or unready fullscreen", async () => {
    const video = {
      readyState: 0,
      webkitEnterFullscreen: vi.fn()
    } as unknown as HTMLVideoElement;
    const owner = { fullscreenEnabled: false } as Document;
    expect(canPresentVideoFullscreen(null, video, owner)).toBe(false);
    expect(await toggleVideoFullscreen(null, video, owner)).toBe(false);
    expect(await toggleVideoFullscreen(null, null, owner)).toBe(false);
  });

  it("contains fullscreen failures so the viewer can offer native controls", async () => {
    const container = {
      requestFullscreen: vi.fn().mockRejectedValue(new Error("Denied"))
    } as unknown as HTMLElement;
    expect(
      await toggleVideoFullscreen(container, null, {
        fullscreenEnabled: true
      } as Document)
    ).toBe(false);
  });
});
