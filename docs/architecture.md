# Architecture

Aether is a TypeScript workspace with two applications:

- **apps/server**: Fastify API, SQLite database, scanner, authentication, and
  media processing
- **apps/web**: React and Vite browser interface

```text
read-only media folders
          |
          v
 scanner and identity matching
          |
          +----> SQLite metadata
          |
          +----> generated media cache
                         |
                         v
               authenticated Fastify API
                         |
                         v
                    React web app
```

## Server

The server owns all filesystem and database access.

- **auth** handles password checks, sessions, CSRF, and failed-sign-in limits.
- **config** resolves environment settings, the data directory, and media roots.
- **db** creates SQLite tables and applies migrations.
- **library** scans files, stores metadata, runs searches, updates annotations,
  produces previews, and serves media.
- **security** checks that resolved files stay inside an allowed media root.

HTTP route modules validate requests and turn known failures into clear
responses. Repository modules own database queries and transactions. Media
processors receive an already validated source record; they never accept a raw
path from the browser.

## Media Identity

Each named media root has a stable identity that does not depend on its current
path. Files also receive a content digest. During a complete scan, Aether uses
the digest and the known paths to match renamed or moved files to existing asset
records.

Scanning, media resolution and source-descriptor validation use BigInt file
metadata. Timestamp identity uses integer milliseconds derived from nanoseconds,
so floating-point rounding cannot make an unchanged source disagree with its
indexed record. Device and inode checks retain their exact integer values.

When the match is safe, the asset keeps its ID, scores, favorites, tags, and
comparison history. Duplicate files are kept as separate assets and use their
known locations to avoid swapping metadata. A file that no longer has a match
is removed along with its Aether-managed metadata and generated derivatives.

Reconciliation happens only after every configured root has been read
successfully. If a root is disconnected or unreadable, the scan fails without
treating that entire library as deleted.

## Database

SQLite stores:

- media roots, folders, names, relative paths, and technical metadata
- content digests and scan state
- scores, favorites, tags, and search text
- comparison decisions and calculated rankings
- sessions and failed-sign-in records
- generated-derivative records

Source files are not copied into SQLite. Changes that affect several records use
a transaction so a partial update is not left behind.

Search uses SQLite FTS5. A small CJK substring index supports partial filename
search for Korean and similar writing systems.

## Generated Media

The cache contains data that Aether can recreate from source files:

- WebP image thumbnails
- full-resolution browser PNGs for HEIC/HEIF photos
- JPEG video posters
- short browser-friendly video previews
- prepared presentation video and animation frame atlases

Concurrent requests for the same preview share one generation job. When a scan
removes an asset, its generated files are removed. A startup sweep also clears
cache entries that no longer belong to a database asset or source revision.
Private media responses require authenticated revalidation before reuse; asset
URLs also carry source versions so replaced files cannot reuse a stale decoded
image. Public static files are opened inside the web build through verified
file descriptors, and source/cache streams reject symlink swaps.

### HEIC Photos

`heif-decoder.ts` inspects real HEVC-backed HEIC/HEIF through maintained libheif
CLI tools. Display generation copies a bounded, verified source descriptor into
private cache scratch space, then decodes the primary photo. It applies HEIF
orientation once and retains alpha and embedded color profiles. 10-bit SDR uses
a 16-bit PNG container to preserve gradation. Every temporary file is removed
in `finally`; only the source-versioned PNG survives under `cache/display-images`.
Thumbnails reuse that display copy. Original download routes remain unchanged.

Input, decoded dimensions, collection size, output size, command output, time,
threads and pending work are bounded: 256 MiB encoded input, at most four
photos and 64 million total display pixels per file, at most 64 million pixels
per coded image extent, a 512 MiB decoded-pixel budget, and 128 MiB per browser
PNG. Native decoder overhead is additional to the pixel budget. One HEIC job
decodes at a time, with up to 32 pending jobs. Metadata commands have 10-second
deadlines and a 1 MiB box-dump limit; conversion has a 30-second deadline and two
codec threads. HDR/PQ/HLG and unsupported color metadata
fail explicitly. Unprofiled NCLX accepts sRGB or unspecified transfer only;
non-sRGB transfer curves require a usable embedded ICC profile. Shared jobs
avoid duplicate conversions, and source identity
is checked again before publication. Source changes and asset removal retire
both registered display copies and thumbnails. The browser's shared image URL
helper selects the display route in cards, Feed, Compare, viewer and editor.

The runtime container uses updated Debian Trixie packages for libheif and its
libde265 decoder. The verification target adds the x265 fixture encoder and
checks actual decoded pixels, alpha, primary-image selection, profiles,
orientation, authentication and original-file integrity. See
[libheif](https://github.com/strukturag/libheif),
[Debian security updates](https://security-tracker.debian.org/tracker/source-package/libheif)
and [sharp's HEIF requirements](https://sharp.pixelplumbing.com/api-output/#heif).

## Web App

The browser application is split by feature:

- **gallery**: virtualized media grid and card details
- **feed**: one-item vertical browsing
- **compare**: leaderboard and pairwise ranking
- **media**: previews, fullscreen viewing, and annotations
- **folders**: folder tree and navigation
- **toolbar**: sorting, layout, search, and filters
- **settings**: appearance, status, and selective database resets

The server remains authoritative for library data. The browser cancels obsolete
reads and uses records returned by the server after a change. Scroll position
and appearance choices are browser-local conveniences, not part of the library
database.

`LibraryViewOptions` groups the existing library controls behind one toolbar
button, using the shared shadcn Popover on desktop and Sheet at the mobile
breakpoint. Tabs separate Filters, Sort, and Layout (Compare omits Sort); only controls that
affect the current view are shown. The panel owns its active tab, while
`useLibraryControls` continues to own query settings and open/close state.
Changes use the existing query, URL, and restoration paths. The bounded
`toolbar/view-layout-state.ts` cache retains independent aspect choices for
Gallery and Ranking, migrating the older Comparison preference and normalizing
older Feed preferences to Portrait. Explicit
URL and restored active-view state take precedence. Card-info visibility is
stored separately per view; Feed and Ranking default to none. Feed stays Portrait
and Ranking defaults to Original proportions. Grid size remains Gallery-only. Clearing filters
leaves search, sort, and layout untouched.

The web app saves the page, library query, comparison workspace, Settings tab
and optional viewer asset ID. Explicit links take precedence; Home Screen
launches resume the saved location. Scroll positions use bounded localStorage
records, with migration from older sessionStorage records. Foreground refreshes
preserve loaded depth and anchors; `visibilitychange` and `pagehide` save pending
position changes when the page is hidden.
Leaderboard unmount checkpoints retain the last measured position when a
header resize would clamp the departing viewport's scroll position.

Ranking saves ordered asset IDs, the last choice that can be undone, and IDs for
requests with an unknown result. The server validates resumed IDs against
current filters and uses request IDs to apply each vote or Undo once. Resetting
comparisons invalidates older pending requests. Server records remain authoritative.

Production builds emit a service worker with a cache name derived from the
build's public assets. It precaches only the static application shell and lazy
chunks, bypasses all private API requests, and provides navigation recovery when
the network fails. Worker updates wait for previous clients to close; they do
not force a running session to reload. Development runs do not register it.

The iPhone Home Screen shell uses `viewport-fit=cover` and Apple's
[`black-translucent` status-bar setting](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html).
Mobile Feed fills the dynamic viewport without a header or top padding.
`LibraryPathBar` uses the sidebar's shared mobile breakpoint to render only the
view selector and existing library options over the media, with top/right
safe-area spacing. Both follow the shared Feed visibility state and become
inert while hidden. An empty feed keeps them available. Other views and desktop
Feed retain the complete header. At narrow workspace widths, a shadcn radio menu
replaces the header's segmented view selector so search and controls fit one row.
Headers and interactive controls retain their safe-area insets. A pointer-transparent
gradient covers only the top safe area in standalone mode, including light
pages and offline recovery. The layout uses the viewport iOS exposes, without
negative offsets or physical-screen sizing to compensate for system-owned
areas. Some iOS versions still exclude the status-bar strip; see
[WebKit issue 301994](https://bugs.webkit.org/show_bug.cgi?id=301994).

## Video Playback Controls

Feed and the expanded viewer share an event-driven playback observer and control
bar. The media element owns current time, duration, buffered/seekable ranges,
pause, and mute state. Commands run in the originating user gesture, and stale
play requests and detached element listeners cannot update a replacement source.
Preview and viewer keep their existing source selection and poster-to-first-frame
behavior. Feed keyboard commands use registered playback commands.
Feed transports use the shared portal pattern to stay anchored to the portrait
media frame. Decoded dimensions supplement indexed metadata for Original layouts
in Gallery and Ranking. Feed details, actions, and playback
controls share one visibility state. Tapping
the media hides or reveals them together without changing playback; hidden
controls leave the pointer, keyboard, and accessibility navigation paths.

Only the active Feed video attaches a native source and requests automatic
buffering. Once it has decoded future data and about two seconds buffered,
Feed may prepare the next item's capabilities and a low-priority 512 KiB byte
range. The request shares the bounded range reader with Comparison. Waiting,
seeking, pause, hidden pages, offline state and constrained connections stop
speculation; a new active item cancels obsolete work. No private prewarm state
is persisted outside the existing authenticated browser cache.

Poster failures are independent of video playback. Failed decorative images
are removed, and valid posters remain until the first video frame is presented.
The viewer never inherits a previous item's poster during navigation.
The preview grid constrains its layers to the card's dimensions so intrinsic
poster sizes cannot enlarge the video or interfere with visibility tracking.

The viewer keeps a separate thumbnail layer mounted while capabilities and the
full image load. A successful original decode or first painted animation frame
hides it; capability results and image errors do not. Both image layers share
the active framing geometry. Image errors retain the preview and offer Retry;
missing thumbnails cannot block the original. Readiness belongs to the current
asset and source so late loads cannot reveal a previous item. Highlight previews
use the selected-start poster from the first render, including before animation
capabilities resolve and while prepared video or animation frames load.
Cards and the viewer retain one poster through animation preparation, hiding it
and the loading background together at first paint to preserve transparency.
Animation readiness follows the selected range and clears when backing canvas
storage is released during inactivity or backgrounding.

A shared slim loading bar stays above retained thumbnails and posters while
the displayed source is loading or being prepared. It follows decoded image,
presented video-frame and painted animation readiness, independently of poster
readiness or speculative comparison preloading. The bar is indeterminate;
server preparation does not report a percentage. Hidden or inactive media and
terminal errors stop the indicator, and reduced-motion mode uses a static bar.
An event-driven buffering observer also shows the bar when native playback runs
out of future data. It retains the painted frame, clears on recovery or pause,
and never reloads, seeks or restarts the video to handle a wait.

Explicit pause intent is separate from temporary hold, background, and panel
pauses. Lifecycle events pause media synchronously; foreground autoplay is
limited to muted media and preserves explicit pause. The viewer uses container fullscreen where
available, native iPhone video fullscreen otherwise, and native controls if a
fullscreen request fails.

The shared transport owns its bottom safe-area spacing. Feed metadata reserves
its height, with one continuous gradient behind the title and transparent
playback bar. Viewer controls overlay the media, which fits the full safe-area
viewport without reserving space for the bar. Both surfaces use a 56px single
row before safe-area spacing, with 44px touch targets. Non-interactive time
labels sit inside the timeline above its track; keyboard order follows the
visible play, seek, mute, and expansion controls.
Safe-area tokens follow [WebKit's guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/),
and native presentation capabilities are detected at runtime.

## Saved Media Presentation

### Metadata

Schema migration 18 adds versioned per-asset presentation metadata: optional
source-time highlight, fit policy, normalized focal point, bounded zoom,
playback rate, and repeat/bounce preference. Repository hydration batches these
records with library, detail, comparison, and mutation results. Saves use an
expected revision in a transaction; resets also advance revisions, so an old
editor cannot restore cleared preferences. Migration 19 adds a bounded JSON
map for Square, Portrait and Landscape frames; the original fields represent
Original framing. Existing custom crops migrate into each aspect preset. Missing
presets use neutral centered defaults, independent of Original. Older clients
that omit the map preserve it; an explicit empty map clears it. Framing reset
clears all presets. The migration 20 `feed_framing` column is retained for database
and backup compatibility; the current Feed uses the Portrait preset. Older maps
survive ordinary saves and are cleared by framing reset. Known identical content retains edits
through safe moves or timestamp changes; a content replacement clears them.

### Processing And Delivery

`routes-presentation.ts` validates edits and verifies the resolved source before
and after capability probing. `presentation-media.ts` verifies still/video/
animation capabilities, rather than treating an extension as proof of animation.
`presentation-video.ts` generates complete highlight or silent bounce MP4s and
selected-start posters. `presentation-animation.ts` produces composed, alpha-
preserving PNG atlases with original frame delays: sharp for GIF/WebP, FFmpeg
for APNG/AVIF, including selected-start animation posters. A temporary uncompressed
TIFF frame store keeps GIF/WebP atlas generation to one in-memory batch. Every
source passes shared path validation. FFmpeg uses local
protocol/container allowlists, argument arrays, deadlines and output limits.

Opaque rendition keys include source identity and only the edits affecting the
bytes. Rate/framing changes reuse renditions. Generation is shared, bounded,
atomically published, and rechecks the source and key before publication.
Authenticated GET/HEAD/range responses use private versioned browser caching;
capabilities and manifests use `no-store`. Capability probes use a per-database
128-entry source-stat cache and sixteen-job admission limit; generation queues
are also bounded and share two processing slots. Completed replacements remove
only their superseded registered files. No private response enters the service
worker shell cache. Source downloads remain unchanged. Reset/delete/scan cache
cleanup includes presentation files while preserving unrelated current jobs.

Bounce playback checks for an existing rendition before probing source frames.
Newly prepared Bounce files include a small registered timing/capability sidecar
under the same private cache directory. Source and rendition filesystem
fingerprints, current presentation keys, bounded metadata and safe file access
must agree before it can replace probing after a restart. Missing or invalid
metadata falls back to normal analysis; no source paths enter the response.
The sidecar follows the rendition's reset, replacement and removal lifecycle.

### Editor And Framing

The shared editor uses explicit draft Save/Cancel, Playback/Framing sections and
a single preview in a fullscreen dialog. Draft framing is selected by aspect;
switching aspects retains every draft and one Save writes them atomically.
Gallery and Ranking resolve their selected preset through `presentation-model.ts`,
while Feed always resolves Portrait. Desktop uses preview/inspector columns;
compact layouts keep the preview and transport above a scrolling inspector, with safe-area
header/footer actions. Loading and failure states share that shell. The dialog
shell is available immediately; editing tools and metadata load in parallel,
metadata failures offer Retry within the dialog. A failed tools download offers
Reload, since older browsers may retain failed module requests until reload. Playback and
Framing tabs follow the [WAI tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/),
retain invalid time drafts and keep one mounted preview/transport; switching tabs
does not pause playback. Seeking pauses at a full-source timestamp. Native play
failures restore the Play action; decode failures leave framing available.
Video previews start with sound after an explicit Play gesture, with a shared
speaker control in both tabs. Muting is local to the open editor and never
changes the source or saved presentation. Bounce previews stay silent.

Editor shortcuts follow the active section and preserve focused text fields,
sliders, tabs and menus. Framing arrows use the measured pan geometry to adjust
the crop position by 12px, or 1px with Shift; `-`/`=` adjust zoom
by 5%, or 1% with Shift. Fit keeps movement and zoom disabled. Preview and highlight timelines
use 100 ms arrow steps, 1 ms with Shift, one-second Page steps and bounded
Home/End targets; keyboard adjustments pause and seek. These controls edit
source time without claiming exact video-frame stepping. Pending saves and
reloads disable editing shortcuts.

The framing selector exposes Fit and Fill only. Legacy `auto` records remain
valid and display the invoking view's equivalent explicit choice; Original
Ranking resolves to Fit, while other card frames resolve to Fill. This display
resolution requires no bulk migration or asset write when the editor opens.
Saved changes still require explicit Save.

Before a preference is saved, the expanded viewer uses original proportions with
neutral position and zoom. Its `ViewerViewOptions` shadcn dropdown can apply the
saved frame and geometry for the invoking aspect (Gallery/Ranking selection or
Feed Portrait).
The on/off choice is a browser-local appearance preference stored as a boolean
in localStorage. It survives previous/next navigation, closing and reopening,
reloads and logout; it contains no asset or media data. Missing or invalid stored
values default to off, and unavailable storage does not prevent viewing.
Framing changes leave the mounted media, source URL, current time and pause intent
intact. The menu portals inside the viewer container so it
remains available in browser fullscreen; native iPhone video fullscreen retains
system controls and original proportions.

Feed has one portrait layout: a centered, width-limited media frame on desktop
and the available viewport on compact screens. Transport, details, tap surfaces
and expand actions share that frame as their positioning container. The
navigation/curation rail stays beside it on desktop and within phone safe areas.
Feed always applies the Portrait preset and starts the editor on Portrait;
Gallery and Ranking retain aspect selection. Old Feed layout links, preferences
and checkpoints normalize to Portrait without discarding other browsing state.
Geometry changes reuse existing media bytes. Viewer framing is a display-only
choice; editing still uses explicit Save/Cancel. Time handles follow the [W3C multi-thumb slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider-multithumb/);
direct framing and reversible edits follow [Apple Photos](https://support.apple.com/en-us/104968).
`presentation-geometry.ts` defines the common Fit/Fill, focal point and zoom
mapping. Indexed photo and editor dimensions include EXIF orientation to match
the browser's display. Delayed curation responses preserve newer presentation revisions.
Unknown save outcomes are reconciled by reading the current record before retry;
conflicts require an explicit reload rather than silently replacing a draft.

### Playback And Limits

`ControlledAnimation` draws verified atlas frames on canvas, retaining variable
delays and alpha. It uses bounded shared atlas decoding, a source-time timeline,
repeat/bounce ordering, and the same transport controls as video. The decoded
atlas cache retains at most three 2048px atlases (48 MiB RGBA), plus two bounded
concurrent fetch/decode jobs. Hidden or
obsolete browser work is cancelled. Inactive or hidden animation canvases release
their backing storage; lightweight Gallery canvases use the thumbnail-size
budget, while Feed, Comparison, viewer and editor retain source-size frames. Shared server generation already started
finishes within its processing limits and rejects stale output. Video speed uses
positive native playback rates;
[negative rates are not portable](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate),
so saved bounce is a bounded generated sequence rather than a negative rate.
Video drafts preview forward and disclose that Bounce applies after Save;
saved bounce playback uses a complete rendition, including native fullscreen.
Repeat highlights use the authenticated original stream and a shared source-time
section observer (`video-section.ts`). It clamps seeks and loop boundaries, waits
for a selected frame before revealing the video, and cancels frame callbacks on
hide or replacement. It uses
[media currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime)
and presented-frame callbacks with a timeupdate/animation-frame fallback. An
unsupported native codec uses the complete encoded section with an explicit local
timeline; this compatibility copy remains limited to two minutes and 1080px.
Video Bounce prepares a silent native video from the selected source frames,
with reversed interior frames so the endpoints are not repeated. It preserves
coded dimensions, sample aspect ratio, rotation, color metadata and variable
frame durations for supported 8/10-bit YUV 4:2:0 SDR inputs (`yuv420p` or
`yuv420p10le`) with even coded dimensions of at least 16px. Encoded timestamps
use a microsecond timebase; each output packet is checked against the selected
source timeline at that precision. HDR, Dolby Vision,
interlaced video, odd dimensions, nonzero stream/container timestamp origins and
unsupported formats/profiles have Bounce disabled; ordinary source playback and
Repeat remain available. Timestamp-origin support requires separate browser and
container timeline validation before that restriction can be relaxed.

Bounce probes FFmpeg's file-valued filter option and installed encoders once per
process search path. Current releases use `-/filter_complex`; older releases
use `-filter_complex_script`. This avoids FFmpeg 9's removed script option
without inlining a potentially large timeline into a command argument. Both
paths read the same private, bounded filter file. Missing tools or encoders
produce fixed public error codes; bounded subprocess diagnostics stay private.

Full-range 8-bit YUV 4:2:0 MOV recordings are also supported. The legacy
`yuvj420p` format is treated as `yuv420p` with an explicit full-range flag;
decoding keeps the input and output ranges full before storing planar samples.
Source-frame and output validation check both layout and range. No range
reduction, rescaling or tone mapping is applied. See FFmpeg's
[pixel format definitions](https://ffmpeg.org/doxygen/8.0/pixfmt_8h.html).

Lossless HEVC uses an `hvc1` MP4 when the browser reports HEVC support. A lossless
H.264 QP0/High444 Predictive copy provides an alternative for supporting browsers.
Decoded-frame equality is distinct from copying the original bitstream or using
a visually lossless quality setting. Browser codec claims do not establish
native iPhone compatibility; real-device acceptance is tracked separately.

One Bounce job runs at a time. Queued Bounce work waits outside the shared
processing slots so posters and other media can continue. A section can contain
up to thirty seconds and 3,600 source frames.
`presentation-bounce-frames.ts` decodes the section once
into independently lossless-compressed frames in a private temporary directory,
then feeds them forward and backward to one encoder with pipe backpressure.
The whole section is never buffered as raw frames in memory. Timestamp scripts
preserve variable frame holds without growing the subprocess argument list.

Limits are a 256 MiB estimated decoded-frame working budget, 2 GiB of temporary
frame storage, 1 GiB of final output and a five-minute preparation deadline.
Codec/runtime overhead is additional to the decoded-frame estimate. The
temporary frame store and any partial output are removed on success or failure;
startup clears abandoned work after a crash. Files that exceed a processing
budget fail explicitly without reducing resolution or quality. Capabilities and
save validation expose the available duration, including the frame-count limit
at high frame rates. Actual selected frame counts are checked beyond estimates.
The source/range timeline cache admits eight pending probes and retains at most
64 entries. Bounce keys include `bounce-lossless-v5`, invalidating earlier
prepared output and cached capability limits without changing full-source or
animation identities.
Animations retain source dimensions up to 2048px per side in lossless PNG atlases,
with an adaptive tile grid. Limits remain sixty seconds, 600 frames, 64 million
total source pixels, 2048px atlases and 64 MiB encoded output. Larger sources are
rejected rather than downscaled. PNG composition retains decoded 8-bit RGBA;
HDR/high-bit-depth and color-profile fidelity are not guaranteed by the current
FFmpeg/sharp/canvas pipeline. Rendition identity v2 invalidates older scaled
atlases; ordinary successful publication removes superseded registered files. Atlas jobs
have a two-minute budget, including a sixty-second source-decoding deadline.
These are editing/playback budgets,
not restrictions on indexing ordinary source media.

Media failures use one compact themed notice on each surface. Gallery and
Comparison cards remain noninteractive inside their preview buttons; Feed and
the viewer provide Retry for recoverable failures. After the final Bounce
codec attempt fails, one authenticated HEAD request reads a whitelisted
`x-aether-media-error` code without downloading the video. A healthy HEAD
response distinguishes native decoding from server preparation failures;
native network errors retain their network classification. Diagnostics are
bounded, cancelled on hide, exit, retry or source replacement, and cannot
publish results for a stale source. A viewer-owned animation error suppresses
the canvas component's duplicate notice.

The highlight-only preference follows validated URL/resume state and is also
available in the viewer View options menu, alongside the independent framing
choice. The highlight option is disabled for items without a saved section
without clearing the remembered preference. Comparison applies that range
selection while keeping 1×/repeat and its saved View options framing. Layout changes leave the ordered pair
and Undo untouched; comparison cards do not expose Edit. Presentation-only reset leaves navigation,
ranking and Undo intact. Per-asset edits remain server-owned; private in-memory
capability/atlas caches are cleared on sign-out.

### Gallery And Viewer Actions

Gallery actions use the shared Radix ContextMenu primitive, matching existing
menu tokens and the [Radix desktop/touch interaction](https://www.radix-ui.com/primitives/docs/components/context-menu).
Keyboard context-menu keys, focus restoration, scroll cancellation and trailing
touch clicks are guarded. Curation holds do not trigger a menu. Viewer chrome
supports explicit media clicks alongside idle hiding; Info keeps media running
while its focus layer guards shortcuts. Thumbnail/source layers share framing
and swap only after decode/presentation, without blur, scale or crossfade dimming.

## Pairwise Ranking

Aether keeps the latest active choice for each pair while retaining reversible
decision events. A regularized Bradley-Terry model turns the active comparison
graph into relative scores. Direct score edits are stored separately so they do
not disappear when comparisons change.

The ranking session keeps a lookahead of up to three distinct pairs in memory.
A bounded, authenticated prefetch request excludes the visible pair and pairs
already queued. Selection still follows the server's ranking policy. After a
choice, the vote request offers the next prepared pair; the server validates it
against the updated filters and comparison generation before accepting it.
Invalid candidates fall back to a new server-selected pair. The client waits
for the vote acknowledgement, uses the returned records and progress, and
refills the queue. It never displays an unconfirmed vote as saved.

Preparation decodes thumbnails for every queued item and requests at most
the first 512 KiB of a video. Displayed images retain their prepared thumbnail
while the original or controlled animation loads. Native animated originals
are not prepared because their bytes and decoded frames are not used by the
atlas renderer. Preparation does not guarantee immediate video or animation
playback.
When the browser reports data-saving mode, a 2G connection, or an estimated
downlink below 1 Mb/s, only the first queued pair's thumbnails are prepared;
video bytes are not requested. Hidden pages cancel preparation.
Changing filters, undoing, resetting comparisons, or restoring the session
discards outdated candidates. Prefetched records and media are not persisted
in ranking checkpoints or the service worker's public cache; media uses the
existing authenticated private browser cache.

The lifecycle and loading behavior follows the browser guidance for
[hidden pages](https://developer.chrome.com/docs/web-platform/page-lifecycle-api),
[image decoding](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode),
and [HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests).

Zero is the only unranked score. Positive scores are ranked.

## Data Directory

**AETHER_DATA_DIR** contains the database, generated cache, internal backups,
private settings, private native-tool temporary work under `tmp`, and a safety
marker. Temporary process scopes are removed on exit; dead-process work is
pruned under an exclusive runtime or maintenance lock. Docker mounts the same directory at
**/data**. Source media remains on separate read-only mounts.

See [Data management](data-management.md) for backup, rebuild, and wipe
behavior.

## Deliberate Limits

Aether does not include multi-user accounts, public sharing links, cloud sync,
source-file editing, or automatic cloud analysis.
