interface NativeFullscreenVideo extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
}

export function canPresentVideoFullscreen(
  container: HTMLElement | null,
  video: HTMLVideoElement | null,
  owner: Document = document
): boolean {
  return Boolean(
    (container?.requestFullscreen && owner.fullscreenEnabled !== false) ||
    (video &&
      (video as NativeFullscreenVideo).webkitEnterFullscreen &&
      (video as NativeFullscreenVideo).webkitSupportsFullscreen !== false &&
      video.readyState >= 1)
  );
}

export async function toggleVideoFullscreen(
  container: HTMLElement | null,
  video: HTMLVideoElement | null,
  owner: Document = document
): Promise<boolean> {
  try {
    if (owner.fullscreenElement === container && container) {
      await owner.exitFullscreen();
      return true;
    }
    if (container?.requestFullscreen && owner.fullscreenEnabled !== false) {
      await container.requestFullscreen();
      return true;
    }
    const nativeVideo: NativeFullscreenVideo | null = video;
    if (
      nativeVideo?.webkitEnterFullscreen &&
      nativeVideo.webkitSupportsFullscreen !== false &&
      nativeVideo.readyState >= 1
    ) {
      nativeVideo.webkitEnterFullscreen();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
