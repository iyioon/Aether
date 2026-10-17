export interface VideoPlaybackState {
  available: boolean;
  paused: boolean;
  muted: boolean;
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  seekable: boolean;
  error: boolean;
}

export const EMPTY_VIDEO_PLAYBACK_STATE: VideoPlaybackState = {
  available: false,
  paused: true,
  muted: true,
  currentTime: 0,
  duration: 0,
  bufferedEnd: 0,
  seekable: false,
  error: false
};

function finiteDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function videoSeekTarget(
  video: HTMLVideoElement,
  requestedTime: number
): number | null {
  const duration = finiteDuration(video.duration);

  if (!duration || !Number.isFinite(requestedTime)) {
    return null;
  }

  // Some looping players wrap an exact-end seek to zero, even while paused.
  const seekEnd = video.loop
    ? duration - Math.min(0.01, duration / 2)
    : duration;
  const target = Math.max(0, Math.min(seekEnd, requestedTime));
  let closestTime: number | null = null;
  let closestDistance = Infinity;

  for (let index = 0; index < video.seekable.length; index += 1) {
    const start = Math.max(0, video.seekable.start(index));
    const end = Math.min(seekEnd, video.seekable.end(index));

    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      continue;
    }

    const candidate = Math.max(start, Math.min(end, target));
    const distance = Math.abs(candidate - target);

    if (distance < closestDistance) {
      closestTime = candidate;
      closestDistance = distance;
    }
  }

  return closestTime;
}

export function readVideoPlayback(video: HTMLVideoElement): VideoPlaybackState {
  const duration = finiteDuration(video.duration);
  const currentTime = Number.isFinite(video.currentTime)
    ? Math.max(0, Math.min(duration, video.currentTime))
    : 0;
  let bufferedEnd = 0;

  for (let index = 0; index < video.buffered.length; index += 1) {
    const start = video.buffered.start(index);
    const end = video.buffered.end(index);

    if (start <= currentTime && currentTime <= end && Number.isFinite(end)) {
      bufferedEnd = Math.max(0, Math.min(duration, end));
      break;
    }
  }

  return {
    available: true,
    paused: video.paused || video.ended,
    muted: video.muted || video.volume === 0,
    currentTime,
    duration,
    bufferedEnd,
    seekable: videoSeekTarget(video, currentTime) !== null,
    error: video.error !== null
  };
}

export interface VideoPlaybackCommands {
  togglePlayback: () => boolean | null;
  toggleMuted: () => void;
  seek: (time: number) => void;
}

export function observeVideoPlayback(
  video: HTMLVideoElement,
  onChange: (state: VideoPlaybackState) => void
): VideoPlaybackCommands & { dispose: () => void } {
  let active = true;
  let playRequest = 0;
  let pendingPlay = false;
  const publish = () => {
    if (active) {
      onChange(readVideoPlayback(video));
    }
  };
  const events = [
    "loadedmetadata",
    "durationchange",
    "timeupdate",
    "progress",
    "canplay",
    "play",
    "playing",
    "pause",
    "ended",
    "volumechange",
    "seeking",
    "seeked",
    "emptied",
    "error"
  ];

  for (const event of events) {
    video.addEventListener(event, publish);
  }

  publish();

  return {
    togglePlayback() {
      if (!active) {
        return null;
      }

      const request = ++playRequest;

      if (!video.paused || pendingPlay) {
        pendingPlay = false;
        video.pause();
        publish();
        return true;
      }

      pendingPlay = true;

      try {
        // Keep play() in the originating click or key event for iOS gestures.
        void video.play().then(
          () => {
            if (active && playRequest === request) {
              pendingPlay = false;
              publish();
            }
          },
          () => {
            if (active && playRequest === request) {
              pendingPlay = false;
              publish();
            }
          }
        );
      } catch {
        pendingPlay = false;
        publish();
      }

      return false;
    },
    toggleMuted() {
      if (!active) {
        return;
      }

      const muted = video.muted || video.volume === 0;
      video.muted = !muted;

      if (muted && video.volume === 0) {
        video.volume = 1;
      }

      publish();
    },
    seek(time) {
      if (!active) {
        return;
      }

      const target = videoSeekTarget(video, time);

      if (target !== null) {
        try {
          video.currentTime = target;
          publish();
        } catch {
          // A source can stop being seekable between the snapshot and input.
          publish();
        }
      }
    },
    dispose() {
      active = false;
      playRequest += 1;

      for (const event of events) {
        video.removeEventListener(event, publish);
      }
    }
  };
}

export function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainder = String(wholeSeconds % 60).padStart(2, "0");

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
}
