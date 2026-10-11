export function requestPresentedVideoFrame(
  video: HTMLVideoElement,
  onPresented: () => void
): () => void {
  let active = true;

  if (typeof video.requestVideoFrameCallback === "function") {
    const callbackId = video.requestVideoFrameCallback(() => {
      if (active) {
        active = false;
        onPresented();
      }
    });

    return () => {
      if (!active) {
        return;
      }

      active = false;
      video.cancelVideoFrameCallback?.(callbackId);
    };
  }

  let animationFrameId = window.requestAnimationFrame(() => {
    animationFrameId = window.requestAnimationFrame(() => {
      if (active) {
        active = false;
        onPresented();
      }
    });
  });

  return () => {
    if (!active) {
      return;
    }

    active = false;
    window.cancelAnimationFrame(animationFrameId);
  };
}
