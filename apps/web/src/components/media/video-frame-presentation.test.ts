import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPresentedVideoFrame } from "./video-frame-presentation";

describe("requestPresentedVideoFrame", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reveals after the browser presents a video frame", () => {
    let presentFrame: (() => void) | undefined;
    const onPresented = vi.fn();
    const cancelVideoFrameCallback = vi.fn();
    const video = {
      cancelVideoFrameCallback,
      requestVideoFrameCallback: vi.fn((callback: () => void) => {
        presentFrame = callback;
        return 42;
      })
    } as unknown as HTMLVideoElement;

    requestPresentedVideoFrame(video, onPresented);
    expect(onPresented).not.toHaveBeenCalled();

    presentFrame?.();
    expect(onPresented).toHaveBeenCalledOnce();
    expect(cancelVideoFrameCallback).not.toHaveBeenCalled();
  });

  it("cancels a pending browser frame callback", () => {
    let presentFrame: (() => void) | undefined;
    const onPresented = vi.fn();
    const cancelVideoFrameCallback = vi.fn();
    const video = {
      cancelVideoFrameCallback,
      requestVideoFrameCallback: vi.fn((callback: () => void) => {
        presentFrame = callback;
        return 7;
      })
    } as unknown as HTMLVideoElement;

    const cancel = requestPresentedVideoFrame(video, onPresented);
    cancel();
    presentFrame?.();

    expect(cancelVideoFrameCallback).toHaveBeenCalledWith(7);
    expect(onPresented).not.toHaveBeenCalled();
  });

  it("uses two animation frames when the video callback is unavailable", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.stubGlobal("window", {
      cancelAnimationFrame: vi.fn((id: number) => callbacks.delete(id)),
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        const id = nextId;
        nextId += 1;
        callbacks.set(id, callback);
        return id;
      })
    });
    const onPresented = vi.fn();
    const video = {} as HTMLVideoElement;

    requestPresentedVideoFrame(video, onPresented);
    callbacks.get(1)?.(0);
    expect(onPresented).not.toHaveBeenCalled();
    callbacks.get(2)?.(0);
    expect(onPresented).toHaveBeenCalledOnce();
  });

  it("cancels a pending animation-frame fallback", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    const cancelAnimationFrame = vi.fn((id: number) => callbacks.delete(id));
    vi.stubGlobal("window", {
      cancelAnimationFrame,
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        const id = nextId;
        nextId += 1;
        callbacks.set(id, callback);
        return id;
      })
    });
    const onPresented = vi.fn();

    const cancel = requestPresentedVideoFrame(
      {} as HTMLVideoElement,
      onPresented
    );
    callbacks.get(1)?.(0);
    cancel();
    callbacks.get(2)?.(0);

    expect(cancelAnimationFrame).toHaveBeenCalledWith(2);
    expect(onPresented).not.toHaveBeenCalled();
  });
});
