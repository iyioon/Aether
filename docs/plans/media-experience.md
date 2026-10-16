# Media Playback And Presentation Plan

Status: Planned; implementation has not started.  
Reviewed: 2026-10-16.  
Code baseline: `1e5c13c`.

## Outcome And Delivery Order

Deliver usable video controls above the iPhone Home indicator, clear video
loading states, working HEIC display, saved highlights, and remembered media
framing across Gallery, Feed, and Comparison. The first release includes
highlights, playback speed, forward section looping, and bounce for both videos
and animated GIF, WebP, APNG, and AVIF. Keep source files unchanged and preserve
navigation, ranking, privacy, and bounded media preparation.

Start with playback controls and safe-area layout. Establish saved-edit and
rendition contracts before adding highlights or framing. Establish controlled
animated-media playback before completing highlights and speed. HEIC can proceed
in parallel after the rendition contracts. Add bounce after ordinary section
playback works reliably. Device checks apply to every interface phase.

| ID  | Deliverable                                                    | Depends on                          | Status      | Exit criterion                                                                                                           |
| --- | -------------------------------------------------------------- | ----------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| M0  | Capability and design checks                                   | —                                   | Not started | Production HEIC and animation decoders selected; timing, transparency, and bounce budgets proven                         |
| M1  | Shared playback, controls, video status, and safe areas        | M0 playback decisions               | Not started | Feed and viewer controls work on keyboard, touch, and installed iPhone PWA                                               |
| M2  | Saved presentation, revisioned renditions, and reset contracts | M0 presentation/rendition decisions | Not started | Migration, authoritative API updates, cache invalidation, and selective reset tests pass                                 |
| M2a | Controlled animated-media playback                             | M0 animation proof, M2              | Not started | GIF/WebP/APNG/AVIF have verified timelines and controllable playback with correct composition and transparency           |
| M3  | HEIC/HEIF display                                              | M0 decoder proof, M2                | Not started | Real HEVC images decode in the production container and display in every media surface                                   |
| M4  | Highlights, speed, and forward section looping                 | M1, M2, M2a                         | Not started | Videos and all four animated formats pass Save/Cancel/Reset, highlight-only playback, posters, and source-time checks    |
| M5  | Framing and Comparison aspect settings                         | M1, M2; integrate M2a/M3            | Not started | One geometry model preserves saved focus/zoom across surfaces and orientations                                           |
| M6  | Bounce playback for videos and animated media                  | M4, M0 bounce proof                 | Not started | Both media groups pass bounded forward/reverse playback across target browsers with clear preparation and audio behavior |
| M7  | Cross-feature and release verification                         | M0–M6, including M2a                | Not started | Full agreed scope, regression suite, packaging, accessibility, and actual-device acceptance pass                         |

M1 and the M0 codec experiments can run independently. M3 and M4 need not block
each other. Do not wait for M7 to correct phone layout or lifecycle defects.
M0 checks gate only their consumers; bounce experiments must not delay ordinary
controls or saved-edit work. Incremental changes can land separately, but the
first feature release requires animated-media timing and bounce as well as video
support; neither is a deferred extension.

## Current Constraints

Fully qualified paths are repository-relative; abbreviated component and media
module names refer to the corresponding web/server feature directories.

| Finding                                                                                        | Existing code                                                                        | Consequence                                                                                              |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Feed seek input is 18 px high, visible line is 2 px, and both sit at `bottom: 0`               | `apps/web/src/styles/feed.css`, `components/media/MediaPreview.tsx` under web source | Replace the edge line with a usable control region; making only the visible line thicker is insufficient |
| Phone CSS insets feed metadata/actions but hides the desktop navigation/heart rail             | `apps/web/src/styles/responsive.css`, `components/feed/FeedNavRail.tsx`              | Edit below the heart requires a mobile action layout too                                                 |
| Preview, feed, and viewer duplicate playback commands/state; viewer uses native controls       | `MediaPreview.tsx`, `MediaViewer.tsx`, `FeedPreview.tsx` under web components        | Share playback behavior before adding range, rate, and loop behavior                                     |
| Animated-image playback is selected by extension rather than verified timing                   | `apps/web/src/components/media/media-urls.ts`, `MediaPreview.tsx`                    | Replace extension-only behavior with authoritative capabilities, including existing indexed files        |
| Loading shimmer disappears once the poster is ready                                            | `apps/web/src/styles/gallery.css`                                                    | A poster currently hides the distinction between an image and a video awaiting playback                  |
| HEIC/HEIF are recognized, but actual HEVC decoding fails in the installed sharp runtime        | `apps/server/src/library/media-types.ts`, `thumbnails.ts`, `Dockerfile`              | Extension recognition and successful metadata inspection are not working HEIC support                    |
| Gallery video previews are short clips beginning at zero; Feed and Comparison prefer originals | `media-urls.ts`, `video-derivatives.ts`, media call sites                            | Source timestamps cannot be applied directly to an unrelated preview's local timeline                    |
| Browser media URLs have no revision; derivative responses can remain cached for 24 hours       | `apps/web/src/components/media/media-urls.ts`, server thumbnail/preview delivery     | Replacing a generated file alone will leave stale images and clips in browsers                           |
| Derivative uniqueness does not model normal/highlight variants                                 | `apps/server/src/db/database.ts`, `repository-derivatives.ts`                        | Define variant identity before storing both outputs                                                      |
| Reset copy promises previews are untouched, and the current reset callback clears scroll state | `DataResetSettingsSection.tsx`, `AppShell.tsx` under web components                  | Presentation resets need accurate copy and narrower invalidation                                         |

## Proposed Product Decisions

These defaults make the first implementation concrete. Amend them here when a
decision changes; do not build competing interpretations in different views.

- **Saved edits:** store presentation metadata by stable asset ID on the server,
  shared across devices using the existing single-password library. Downloads
  remain the original bytes.
- **View preferences:** “Play highlights only” belongs to Gallery/Feed view
  settings, defaults off, and uses the existing URL/browser restoration layer.
  It changes playback, not filtering, counts, pagination, or ranking eligibility.
  Timed media without a highlight continue normally; still images remain visible.
- **Highlight:** one temporal range per video or animated image in the first
  release. Still-image regions belong to Framing. Animated GIF/WebP/APNG/AVIF
  need controlled playback; ordinary image elements do not expose seeking or
  playback rate through the [image API](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement).
  Animation detection and normalization are mandatory prerequisites in M2a.
- **Playback defaults:** forward repeat and 1× speed. Offer 0.5×, 0.75×, 1×,
  1.25×, 1.5×, and 2×. Save a preferred rate/loop mode with timed-media
  presentation; temporary player changes need not save until explicitly requested.
- **Framing:** one shared normalized focal point and bounded zoom per asset.
  An unset fit policy retains current surface defaults: Gallery/Feed Fill,
  Comparison/viewer Fit. An explicit saved Fit/Fill choice applies across
  surfaces. Preview the supported ratios before Save. Add per-aspect overrides
  only if usability testing shows they are needed.
- **Comparison:** keep full-source, 1×, forward playback independently of saved
  highlight/rate/bounce settings. Add aspect settings and apply saved framing;
  an unedited asset keeps Fit. Do not inherit Gallery's highlight-only setting
  silently; what is being compared must remain clear. Use the verified full
  animation timeline for animated images, retaining their image classification.
- **Controls:** build shared custom controls for Feed and the expanded viewer.
  Keep Gallery tiles lightweight, with clear video state and compact hover/focus
  actions. Full seeking, speed, and fullscreen controls belong in the viewer
  rather than a complete toolbar on every small tile.

## M0 — Validate Capabilities And Contracts

Before committing to decoder packaging or reverse playback, complete these
small technical checks and record the selected approach in the relevant
milestone. Keep experimental scripts and downloaded samples out of the repo.

1. Verify actual HEIC pixel decoding in both the intended container and native
   setup. The current runtime could read an upstream HEVC sample's metadata but
   failed to resize it because its decoder was absent. Compare a compatible
   custom libvips/libheif build with a packaged libheif conversion boundary;
   select the smallest reproducible solution that passes real iPhone fixtures.
   Adding an arbitrary distro libvips package may not meet sharp's required
   version. See [sharp's HEIF requirements](https://sharp.pixelplumbing.com/api-output/#heif)
   and [custom libvips installation](https://sharp.pixelplumbing.com/install/#custom-libvips).
2. Prove actual timed decoding for animated GIF, WebP, APNG, and AVIF in the
   intended native/container runtimes. Include still files in the same formats,
   variable frame delays, transparency, and frame composition. Select a playback
   representation that supports seeking/rate and preserves appearance across
   target browsers; do not assume one opaque video codec covers every animation.
3. Establish the playback contract for original, normalized animation, fallback
   preview, complete highlight, and bounce sources: verified duration, source-time
   offset, frame-boundary rounding, and mapping back to original timestamps.
   Identify where a short preview is insufficient.
4. Measure a bounded forward/reverse prototype on representative server hardware.
   Choose and record duration, dimensions, frame-rate, memory, output-byte,
   timeout, concurrency, and cache limits before enabling bounce.
5. Validate the control dock and editing gestures in an installed iPhone PWA,
   including portrait, short landscape, VoiceOver, and rotation. Distinguish
   the application viewer from browser/native fullscreen in labels and behavior.

## M1 — Playback Controls, Status, And Safe Areas

### Shared behavior

Extract one focused event-driven playback hook/controller under
`apps/web/src/components/media`. Let the actual media element own playback
truth for video-backed playback; integrate M2a's animation representation through
that same capability contract. Expose play/pause, current time/duration,
seekable/buffered ranges, seeking, mute, rate, initial loading, rebuffering,
errors, and presentation capabilities. Reuse it from Preview and Viewer, and
replace Feed's direct video
DOM-query commands as the shared commands land. Avoid a new player framework.

Preserve poster-to-first-presented-frame behavior, original/preview fallback,
muted inline autoplay, and rejected-play handling. Keep user pause distinct from
temporary visibility pause; returning to the foreground must not unexpectedly
resume audible playback. Follow [WebKit's inline video policies](https://webkit.org/blog/6784/new-video-policies-for-ios/)
and handle the [play promise](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play).

### Control surface

Use existing buttons, menus, borders, backgrounds, and motion tokens. Provide
play/pause, elapsed/duration, seeking with buffered progress, sound, and viewer
expansion; add speed in M4. The expanded viewer gets capability-tested browser
fullscreen and native iPhone video fullscreen fallback. Keep native controls
available during migration/failure. PiP is optional follow-up work, not a
dependency of this request.

Retain familiar player behavior, as recommended by
[Apple's video guidance](https://developer.apple.com/design/human-interface-guidelines/playing-video).
System fullscreen may replace custom overlays and framing; verify its behavior
instead of promising identical controls. Highlight-only playback must either
use an actual section rendition there or explicitly offer full-video playback;
it must not silently escape the selected range.

Keep controls visible while focused, scrubbing, a menu is open, or an editor is
active. Scrubbing must not toggle chrome, activate long-press pause, scroll to
another feed item, adjust a score, or cast a comparison vote. Extend shared
keyboard/interactive-target guards; avoid nested buttons or inputs inside the
Gallery card's existing open-viewer button.

### Phone layout

Define one transport dock with one owner for bottom insets. Its background can
extend to the screen edge; interactive content sits above
`env(safe-area-inset-bottom)` plus a normal spacing token. Reserve room for
metadata and actions above the dock, and respect left/right landscape insets.
Do not apply the same inset independently at several nested levels. This follows
[WebKit's safe-area model](https://webkit.org/blog/7929/designing-websites-for-iphone-x/).

Use an approximately 4–6 px visible track with a minimum 44 CSS px touch region
and an obvious thumb on touch devices. Forty-four pixels is Aether's usability
target, not the [WCAG AA minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
Use a compact row/overflow menu in short landscape rather than shrinking targets.
Keep dynamic viewport sizing, browser zoom, and phone input sizing intact.

### Video identification

Add a shared noninteractive top-left video badge, positioned inside its media
surface without colliding with selection controls. Keep a video icon or “Video”
label whenever a poster is displayed. Distinguish idle poster, initial loading,
ready/paused, buffering/seeking, autoplay-blocked Play, and error/retry states.

Show loading only while playback is actually requested and cannot present a
frame. An inactive tile or intentionally paused video must not spin forever.
Use media events and current readiness; [waiting](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/waiting_event)
and [stalled](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/stalled_event)
are different signals. Debounce transient decoration, retain the poster, support
reduced motion, and avoid live-region announcements for every timeline tick.
Apply the same readiness states to controlled animations with an accurate
“Animated” identifier; playing through a video rendition must not relabel the
source as a video.

## M2 — Saved Presentation And Rendition Foundation

- Add versioned migration(s) for an asset presentation record with a foreign
  key and cascade deletion. Keep scores, favorites, tags, rankings, source
  dimensions, and source duration separate. Defaults reproduce current behavior.
- Store highlight bounds as integer source milliseconds, both absent or
  `0 <= start < end <= verified duration`. Probe unknown duration before saving.
  Validate finite framing/rate values and normalize against oriented display
  dimensions. Extend canonical probing for rotation/display matrices and sample
  aspect ratio; current raw stream dimensions are insufficient. Include
  mirrored images, 90/270-degree video, and non-square pixels.
- Add one focused authenticated, CSRF-protected presentation update endpoint
  returning the complete authoritative asset. Define partial-update/null/reset
  semantics. Use an expected revision to reject stale edits; serialize/coalesce
  saves per asset and retain unsaved drafts after failures. Reconcile an unknown
  save outcome by refetching before retrying, without overwriting newer edits.
- Extend common row projections, mappers, batched hydration, `AssetRecord`, and
  existing asset-merge callbacks. Every Gallery, Feed, viewer, ranking, and
  comparison response must carry the same presentation state without N+1 reads.
- Separate the edit/concurrency revision from rendition identity. Every saved
  edit/reset advances and retains its concurrency token, including default
  values, so an old editor cannot overwrite a reset. Do not delete the only
  revision record when clearing values.
- Introduce opaque rendition identities in shared display/poster/preview URLs
  and preload/readiness keys. Derive them from source identity, actual output
  inputs, and pipeline version; framing/rate-only changes must not invalidate
  unchanged bytes. Define normal/highlight variants and derivative uniqueness.
  Do not expose raw paths or content hashes as public tokens.
- Reject stale rendition requests and refresh metadata, or serve an immutable
  retained old output. Never generate changed bytes under an old URL. Identical
  valid outputs, including default posters after reset, may be reused.
- Capture source/rendition identity at job start, recheck before publication,
  and publish valid output atomically. Old jobs and failures must not recreate
  reset data or overwrite newer ready/error state after edits or deletion.
- Scope shared jobs to the database/cache root; video job maps are currently
  process-global. Reuse existing processing slots, deadlines, restricted
  temporary files, and argument-array subprocesses. Bound decoded work and
  output as well as elapsed time.
- Save metadata independently of generation success. Retain a valid poster
  while preparing its replacement; expose preparing/failure/retry status.
  Invalidate affected variants lazily and prioritize visible media instead of
  eagerly regenerating the whole library.
- Extend cache allowlists/pruning, deletion cleanup, backup-with-cache,
  cache-free restore, and latest-schema validation. Existing database backups
  already carry new tables; a new backup format is not inherently required.
- Preserve edits on safe moves/renames. Existing content-identity rules give
  changed source bytes a new asset ID; retain that policy rather than matching
  edits by filename.

## M2a — Controlled Animated-Media Playback

Complete this milestone before M4.

- Detect a timed animation from its container/decoder information, not its
  extension or page count alone. Keep animated assets classified as images for
  filters, counts, ranking, identity, and downloads. Expose authoritative timing
  capabilities and verified duration separately; still WebP/AVIF must not acquire
  temporal controls. Replace the client's extension-only classifier. Backfill
  existing records from an explicit unknown state using bounded lazy probes,
  without requiring a rebuild or changing asset IDs.
  Detect APNG inside `.png` as well as `.apng`; exclude a separate fallback image
  from its timeline, following the [PNG animation structure](https://www.w3.org/TR/png-3/#structure).
- Normalize one animation cycle into the shared source-time model. Preserve
  variable frame delays, composition/disposal/blending, transparency, orientation,
  and color. Define invalid/zero delay handling and frame-boundary rounding in
  M0. Distinguish original repetition metadata from the selected app loop mode.
  [sharp metadata](https://sharp.pixelplumbing.com/api-input/) exposes frame,
  delay, loop, and alpha information, but a successful header read does not prove
  that the installed decoder can render every required format.
- Build bounded, authenticated playback renditions using the M0-tested path.
  Prefer video-backed playback where it preserves appearance; verify an
  alpha-preserving path on the target browsers rather than silently flattening
  transparency. Reuse M2 identities, jobs, status, pruning, and reset contracts.
  Include frame count and total decoded pixels in processing limits.
- Wire the resulting source into shared controls, posters, fallback, lifecycle,
  and Comparison preparation. Preserve a valid poster while preparing or after
  failure. An original-image fallback keeps browsing usable, but does not count
  as delivered seeking, speed, highlights, or bounce. Cover every required
  animated format in the production container and browser acceptance tests.

## M3 — HEIC/HEIF Display

Decode the primary still image server-side to browser-compatible display
renditions. Supply bounded higher-resolution renditions for Feed/viewer and
appropriate thumbnails for tiles; a 640 px thumbnail is insufficient everywhere.
Keep the original download and source identity unchanged. Route display URLs
through the same shared media helpers, privacy checks, and preloading budgets.

Package the verified M0 decoder in Docker and document native prerequisites.
Do not rely on browser HEIC support, metadata detection, or FFmpeg alone without
testing actual tiled/grid iPhone files. Handle orientation/mirroring, primary
image selection, ICC color, 10-bit/HDR input to a defined SDR output, malformed
files, and resource limits. Generated display files must omit private metadata.
[libheif documents the codec, primary-image, and security-limit boundaries](https://github.com/strukturag/libheif).
Live Photo video, depth maps, and multi-image animation are separate from
primary-still support and must be described accurately.

## M4 — Highlights, Speed, And Forward Loops

Apply this milestone to videos and M2a's controlled animated images together.
Use their verified source timeline for the same editor, saved settings, poster
selection, and Gallery/Feed highlight-only behavior.

Use one explicit media editor with **Highlight** and **Framing** sections rather
than separate competing editors. Pause background playback and shortcuts while
editing. Save commits once; Cancel discards the draft; per-item Reset is explicit.
Dragging a handle must not write metadata or regenerate media repeatedly.

Follow the familiar two-ended timeline from
[Apple Photos](https://support.apple.com/en-us/104968) and the explicit interval
markers used by [VLC A–B repeat](https://docs.videolan.me/vlc-user/android/3.X/en/video/video_player.html).
Show a full-source timeline, selected-range fill, dimmed outside regions, and a
separate playhead. Provide start/end time fields and “Set start/end here” actions
alongside draggable handles; handles cannot cross. The
[W3C multi-thumb pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider-multithumb/)
requires stable tab order and warns that touch assistive technology needs real
device testing.

In highlight-only playback, label **“Looping highlight · 0:12–0:18”**, show the
selected region and boundaries, and provide an obvious return to full playback.
Keep source-time labels truthful when the underlying clip starts at local zero.
Editing accesses the whole source; normal highlight seeking stays within the
active range. Define near-end tolerance and behavior for very short clips.

Generate a highlight poster from its start frame and range-aware previews.
Retain normal variants for full-media mode. The grid may retain its bounded
muted preview, but that preview must come from inside the selected range and be
identified as a preview. Feed and interactive/expanded playback must play the
whole selected range; do not silently present the existing four-second clip as
the complete highlight. Use a complete section rendition where needed for
codec fallback or system fullscreen; preserve source-to-clip time mapping.

Forward section looping may use source playback with guarded seek/frame events
where appropriate; arbitrary source seeks are not guaranteed gapless. A section
rendition provides reliable bounds when the system player owns playback.
Backgrounding, source fallback, duration changes, and edit/reset during playback
must revalidate the active interval before resuming.

Add the rate selector to shared controls and the saved playback defaults.
Preserve pitch correction where supported; changing speed does not require
re-encoding. [HTML media rate behavior](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate)
also explains why negative rates cannot supply portable bounce playback.

## M5 — Framing And Comparison Layout

Store a normalized source focal point and bounded zoom with explicit Fit/Fill.
Use one geometry helper for oriented images, video posters, videos, HEIC display
renditions, and editor previews. Fit reveals the whole media; zooming out must
allow Fit rather than forcing a permanent crop. Define clamp/centering rules
for letterboxing and axes without pan room. Do not save device pixel offsets.

Use direct drag/pinch, a zoom slider with keyboard/numeric alternatives,
aspect previews, Save/Cancel, and Reset. These follow familiar
[Photos crop interactions](https://support.apple.com/en-gb/guide/iphone/iph0f3ebb1dd/ios),
while Aether stores presentation metadata rather than altering source files.
Transform only the media layer, never controls, badges, or captions.

- Feed: Edit below the heart in the action rail, including an intentional
  compact/mobile rail variant that clears the transport dock.
- Gallery: sibling Edit action beside Download on hover/focus, with touch
  discovery and access through the viewer. Keep interactive controls outside
  the existing card button and preserve selection-mode behavior.
- Comparison: a separate toolbar/card Edit action above the vote surface.
  Modal gestures and keys must never vote. Add focused aspect controls using
  shared presets, preserving the existing Landscape 16:10 meaning and default
  contain/Fit behavior. Recompute row geometry without clearing pair or Undo.

Apply framing client-side to the canonical uncropped derivatives. Framing alone
normally needs no thumbnail regeneration; changing the selected timed-media
frame does. Select rendition resolution according to display size/zoom within caps,
rather than downloading full-resolution originals for every grid card.

## M6 — Bounce For Videos And Animated Media

Apply bounce to both videos and the verified animation timelines from M2a.
Implement it through a bounded forward-plus-reversed rendition played normally.
Do not simulate reverse with timer-driven repeated seeks or depend
on `playbackRate = -1`. Trim and scale before reversing: the
[FFmpeg filter documentation](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/doc/filters.texi)
states that reverse buffers the clip. Avoid duplicate turnaround frames and map
both legs back to source time for the controls. Reverse composed animation
frames with their timing intact; do not reverse raw partial-frame instructions.

Use the M0 measured duration/resolution/frame-rate/memory/output limits. Show
preparing, failed, and unsupported-range states; keep forward repeat available.
Do not silently reverse an arbitrarily long original or truncate a selection.
Proposed initial policy: bounce is muted, visibly labeled, and long selections
request a shorter highlight. Final limits and audio policy are release decisions.

Use the same preparation, cancellation, retry, and reset behavior for both
media groups. Verify variable-delay animation timing and transparency through
the reverse leg and turnaround, including unequal frame delays and long endpoint
holds. Require the same timing and transparency acceptance for both legs.

## Settings Reset And Cross-Feature Effects

Add independent **Highlights and playback** and **Media framing** selections to
Settings, with affected counts and existing confirmation conventions. Provide
per-item reset in the editor as well. State exactly which metadata and derived
variants will change; update the current promise that previews are untouched.
Reset highlights/playback to no range, 1×, and forward repeat; reset framing to
centered, 1×, and unset fit. Count assets with nondefault values, not retained
revision-only records. Apply these resets to both video and animated-image
presentation metadata.

Reset metadata transactionally, advance edit revisions, and invalidate only
affected renditions. Clean obsolete generated files after commit; unchanged
valid outputs may remain. Cleanup failure must not resurrect an old edit.
Refresh visible authoritative assets and cancel stale preparation/editor saves.
Keep scores, tags, favorites, comparison generation/history/Undo, and unrelated
scroll checkpoints. Refine `AppShell` reset handling rather than clearing all
scroll/ranking state for a presentation-only reset.

New view preferences must migrate existing URL/browser state, respect explicit
links, flush on hide, and restore through Home Screen launches. Source downloads
and library ordering remain unchanged. New private renditions must never enter
the service worker's public shell cache or persisted ranking checkpoints.

## Verification And Release Gate

| Layer              | Required coverage                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure models        | Range validation and clamping; unknown/short duration; animation detection versus still/multi-image sources; frame-delay normalization; rate presets; source/clip/bounce mapping; oriented Fit/Fill/zoom geometry; URL/storage migration                                                                                                                                                                                                           |
| Database/API       | Fresh/upgrade/restore schema; auth/CSRF; atomic validated updates; editor-open → reset → old-save conflicts; selective resets; safe moves and content replacement; no N+1 hydration                                                                                                                                                                                                                                                                |
| Processing/cache   | Real HEVC and all four animation formats decode in built Docker image; rotation/SAR/mirroring/color/multi-image/corrupt fixtures; animation frame composition, variable timing, and alpha; later-scene poster; normal/highlight variants; changed output gets a new URL while framing/rate preserves bytes; database-scoped shared jobs; reset/delete during jobs; old failure after new success; timeout/limit cleanup; authenticated HEAD/ranges |
| Playback/browser   | Poster/loading/first frame; pause, seek, buffering, autoplay rejection, mute, speed, source fallback; complete highlight and no-highlight fallback; Save/Cancel/Reset/failure/retry; bounds after resume; bounce order/audio/preparation; video and animation parity; still files have no temporal controls; original download unchanged                                                                                                           |
| Interaction/layout | Scrub/edit gestures never navigate, score, or vote; focused controls never auto-hide; Gallery virtualization/anchors survive edits; cross-view updates; prepared Comparison media uses current revisions; no horizontal overflow or overlapping controls                                                                                                                                                                                           |
| Privacy/PWA        | New private URLs absent from CacheStorage; offline shell and reconnection; no saved media bytes; session expiry versus logout; old async results cannot overwrite newer edits                                                                                                                                                                                                                                                                      |

Use disposable real fixtures, including a multi-scene video, portrait/rotated
video, very short video, and actual iPhone HEVC images. Add animated GIF, WebP,
APNG, and AVIF with variable frame delays, partial-frame composition, and
transparency, plus still counterparts and multi-image files that are not timed
animations. Include APNG's separate fallback and animation in `.png`, and backfill
of already indexed assets. Verify fixture provenance and redistribution before
committing samples; use generated or suitably licensed files, not personal
media. Tests must assert decoded/rendered outcomes rather
than extension recognition or arbitrary elapsed-time claims.

Exercise narrow 320 px screens, iPhone portrait, short coarse-pointer landscape,
tablet, and desktop, with zoom/reduced motion and keyboard access. Simulate
nonzero safe-area tokens in layout tests; desktop emulation often reports zero.
Require actual iPhone 16 Safari and installed Home Screen checks for home/return,
lock/unlock, rotation, dynamic browser chrome, audio activation, fullscreen exit,
scrub edges, editor keyboard, and VoiceOver handles/time fields.

Cover current iPad Safari, Android Chrome, and desktop Chrome/Firefox/Safari as
well. Extend automated critical player/editor flows beyond the current
Chrome-only project to WebKit and Firefox; keep real iOS checks separate from
desktop WebKit. Record supported versions and feature-detected fallbacks after
M0 rather than assuming all engines expose the same media presentation APIs.

Run `npm run verify`, production-build browser scenarios, dependency audit, and
the container build/health checks in the [release checklist](../release-checklist.md).
Record device/OS/browser tested and any unavailable checks; emulation is not an
actual-device pass. Agree numeric processing budgets and loop-boundary tolerance
from M0 measurements before marking their milestones complete. M7 cannot pass
with animated highlights, speed, or bounce deferred; successful video tests alone
are insufficient for the agreed first release.

## Keeping This Plan Useful

- Update milestone status with each implementation change. A completed
  milestone needs its acceptance evidence and a commit/PR link, not a progress
  diary. Keep the next unfinished milestone explicit.
- Resolve proposed decisions in place. Record brief reasons only where a
  tradeoff matters; remove abandoned alternatives and obsolete file references.
- As behavior ships, update the user guide and embedded guide, architecture,
  security/data-management/configuration/installation docs where affected, and
  changelog. This plan must not become the sole documentation for a feature.
- Keep detailed implementation tasks in the current milestone rather than
  duplicating long checklists across files. After delivery, reconcile the final
  decisions into permanent docs and archive or remove this completed plan,
  updating the documentation index.

Next work: M0 capability decisions and the M1 playback/control foundation.
