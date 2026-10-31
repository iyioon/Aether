# Media Playback And Presentation Plan

Status: Presentation, lossless Bounce and HEIC implemented; automated local, browser and container checks verified. Device acceptance is tracked below.\
Reviewed: 2026-10-31.

## Outcome And Scope

Provide shared playback controls, safe phone layouts, and non-destructive saved
presentation across Gallery, Feed, viewer and Comparison. Presentation includes
highlights, position/zoom, speed and repeat/bounce for videos and animated GIF,
WebP, APNG and AVIF. Source files and downloads remain unchanged.

The current delivery covers presentation settings and HEIC photos. A video identification/loading badge is excluded. iOS may
reserve a status-bar strip; do not compensate with physical-screen dimensions
or unsupported fullscreen tricks.

## Delivery Tracker

| ID  | Deliverable                                     | State                               | Remaining acceptance                                     |
| --- | ----------------------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| M0  | Capability and resource proofs                  | Local and container proofs verified | Actual iPhone acceptance; representative server load     |
| M1  | Shared controls and safe areas                  | Implemented                         | Installed iPhone, VoiceOver and rotation checks          |
| M2  | Saved presentation, revisions, cache and resets | Implemented                         | Production deployment acceptance                         |
| M2a | Controlled GIF/WebP/APNG/AVIF                   | Implemented                         | Real-device playback and resource acceptance             |
| M3  | HEIC/HEIF display                               | Automated gates verified            | Actual iPhone acceptance and representative library load |
| M4  | Highlights, speed, repeat and posters           | Implemented                         | Device and native fullscreen acceptance                  |
| M5  | Framing and Comparison aspects                  | Implemented                         | Device acceptance across orientation changes             |
| M6  | Video and animation bounce                      | Local and container proofs verified | Real iPhone; representative server load                  |
| M7  | Cross-feature verification                      | Automated gates verified            | Actual devices and representative server load            |

HEIC uses the shared media surfaces and preserves the original download.

## Product Decisions

- One shared editor, one preview, Playback and Framing sections. Still files
  show Framing directly. Fullscreen on desktop and phones. Explicit Save/Cancel;
  Reset changes only the draft. Switching aspects retains all pending frames.
  Preview and seeking stay outside the tabs; switching tools preserves playback.
  Seeking pauses anywhere in the full source. Loading, failure and editing use
  one shell with the same header and footer.
- Highlights use original source times and two labelled handles plus editable
  time fields. Speed presets: 0.5×, 0.75×, 1×, 1.25×, 1.5× and 2×.
- Fit shows the whole item. Fill supports drag, pinch, keyboard movement and
  bounded zoom. These are the editor's only framing choices. Legacy Auto records
  remain supported and show the invoking view's matching Fit/Fill choice,
  without bulk migration or asset writes on open. Each
  Original/Square/Portrait/Landscape frame is independent;
  one Save writes all drafts. Cards use the preset for the selected aspect; the
  expanded viewer initially uses original proportions. Its View options can apply
  the invoking Gallery/Ranking aspect or Feed Portrait and the corresponding
  saved position/zoom. This browser-local appearance preference retains both on
  and off through previous/next, close/reopen, reload and logout. It stores only
  a boolean; changing it preserves media and playback without editing saved frames.
- Feed keeps one portrait layout, centered on desktop and filling compact
  viewports. Its transport and details stay attached to the frame; the editor
  opens on Portrait and uses that saved preset. View options keeps card info
  without an aspect selector. Normalize older Feed layouts without losing the
  current item or navigation state.
- Play highlights only is a remembered View options preference, shared with the
  viewer menu. It is disabled for items without a saved section. The viewer menu
  also provides Use saved framing, initially off until a preference is saved;
  native iPhone video
  fullscreen retains original proportions and system controls. With highlights off,
  items with highlights play their full source in Repeat; saved speed/framing
  still apply. Without a highlight, Bounce applies to the full item.
- Comparison uses normal-speed forward repeat with selected aspect framing and
  the shared Play highlights only preference. View options → Layout changes shape and card info
  without changing pair selection or Undo. Each view remembers these choices;
  Feed stays Portrait; Ranking defaults to Original. Both start with no card info. Feed metadata uses compact icon/value rows and a
  heart only for favorites. Comparison cards have
  no Edit action; Feed and viewer use a pencil icon.
- Video bounce is silent. Its saved rendition is continuous forward/reverse;
  draft preview plays forward until Save. Animation retains alpha and variable
  delays, with interior frames reversed to avoid duplicate endpoint holds.
- Keep ordinary Gallery tiles lightweight; transport controls belong in Feed
  and the expanded viewer. Gallery Edit and Download actions belong in the
  viewer toolbar and the card context menu (right-click, keyboard or touch hold).
  Do not add a second speed or crop control panel.

## Implemented Contracts And Evidence

### Storage, identity and reset

Schema migration 18 adds per-asset metadata with optimistic revisions. Migration
19 adds independent aspect presets, retaining earlier custom crops in each shape.
Migration 20 remains for database/backup compatibility; its older Feed overrides
are preserved by ordinary saves but no longer affect the portrait Feed. Framing
reset clears both maps.
API saves
require an expected revision; resets advance it. Full returned asset records are
authoritative, and delayed curation responses retain newer presentation edits.
Unknown save outcomes are read back before retry, and conflicts keep drafts.
A changed physical source requires a scan before saving. Safe identity moves and
known identical bytes retain edits; replacing content clears them.

Rendition keys contain only opaque source/variant identity. Framing and speed
reuse bytes; range and loop changes invalidate affected files and jobs. Saves
and playback reset remove obsolete section/bounce files; framing reset keeps
playback bytes. Selective reset preserves unrelated curation and navigation.
Backups include presentation metadata and optionally generated cache.

Evidence: `apps/server/test/presentation.test.ts`, migration and restore tests;
web presentation model, geometry, record ordering and URL-state tests.

### Media processing and playback

- GIF/WebP use sharp's animated decoder; APNG/AVIF use FFmpeg. Disposable tests
  verify variable delays, alpha, APNG blend/dispose and selected-start posters.
- Composed lossless PNG atlases preserve source resolution and transparency,
  rejecting frames beyond 2048px per side instead of downscaling. Adaptive
  atlases are at most 2048px, with sixty seconds, 600 frames, 64 million total source
  pixels and 64 MiB encoded output. Atlas generation has a two-minute job budget;
  source decoding has a sixty-second deadline. Composed GIF/WebP frames use a
  temporary uncompressed TIFF store so one atlas batch is held in memory.
  Client atlas decoding is bounded and shared.
- Repeat video highlights loop the original authenticated stream at source times
  in Feed, viewer and Comparison. A shared section observer clamps seeks and
  waits for an in-range presented frame; hidden/replaced work is cancelled.
  Unsupported codecs fall back to complete compatibility highlights: at most two
  minutes, 1080px, 128 MiB and a 120-second encode deadline, with a completeness
  check. Short Gallery previews are never used as complete sections.
- Video Bounce prepares decoded-pixel-lossless HEVC (`hvc1`) or H.264 QP0 video
  with source frame timing, coded dimensions/SAR, color metadata and rotation.
  Eligible inputs are 8/10-bit 4:2:0 SDR; unsupported HDR/Dolby Vision,
  interlaced, odd-sized, nonzero timestamp-origin or unusual formats/profiles
  use Repeat. Endpoints are not duplicated and video Bounce stays silent.
  One job prepares up to thirty seconds and 3,600 source frames using a private
  lossless-compressed frame store and streaming encoder. Budgets are 256 MiB of
  estimated decoded work, 2 GiB of temporary frames, 1 GiB of output and five
  minutes. Temporary work is removed on completion or failure. Actual frame
  counts are rechecked; timeline probes are bounded and source/range keyed.
  A Bounce-only identity invalidates earlier prepared output and capability limits.
- Authenticated private GET/HEAD/range delivery; `no-store` metadata/manifests.
  Local protocol/container allowlists, deadlines, byte limits, safe cache paths,
  shared jobs, atomic publication and stale-source checks protect processing.
- Hidden or obsolete browser playback/preparation stops. Shared server jobs already
  started finish within their processing limits; stale output is discarded. Explicit
  pause remains distinct from panel/background pauses. The service worker caches
  only the public shell.

Evidence: `apps/server/test/presentation-media.test.ts`, video processing tests;
web animation timeline/manifest/cache tests; `tests/e2e/presentation.spec.ts`.
See [Architecture](../architecture.md#saved-media-presentation) and
[Security](../security.md#presentation-processing) for current module contracts.

### Interaction references

Use [Apple Photos trimming](https://support.apple.com/en-us/104968) and
[direct crop gestures](https://support.apple.com/en-ie/guide/iphone/iph0f3ebb1dd/ios)
as interaction references. Use the existing
[shadcn Dialog](https://ui.shadcn.com/docs/components/radix/dialog),
[Radix Slider](https://www.radix-ui.com/primitives/docs/components/slider), and
[W3C multi-thumb slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider-multithumb/).
Use the [WAI tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
for the tool inspector. Use [Radix ContextMenu](https://www.radix-ui.com/primitives/docs/components/context-menu)
for Gallery desktop/touch actions, retaining scroll and curation holds.
Negative native playback rates are
[not portable](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate);
FFmpeg's [reverse filter](https://ffmpeg.org/ffmpeg-filters.html#reverse) buffers
frames, which requires explicit resource bounds.
Use [x265 lossless](https://x265.readthedocs.io/en/master/lossless.html) and
[Apple codec guidance](https://developer.apple.com/streaming/hls-authoring-specification-for-apple-devices.html)
for encoding/profile decisions. Exact decoded equality and visually lossless
encoding are different promises. Lossless H.264 High444 is outside Apple's usual
H.264 profile guidance; reported HEVC support still requires device testing.

## Remaining Work

1. Repeat the verification gate, browser suite, dependency audit and container
   checks for subsequent behavior changes. Local checks passed for this delivery:
   verification/build, desktop and phone browser flows, dependency audit,
   Compose validation, container build/media tests and an isolated runtime smoke
   check covering authentication, CSRF, scanning, both Bounce codecs, ranges,
   logout and unchanged source files.
2. Follow [Presentation acceptance](../release-checklist.md#presentation-acceptance)
   on a real installed iPhone: VoiceOver handles, short landscape, keyboard,
   pinch/drag, safe areas, Home/return and native fullscreen section bounds.
   On iPhone 16, verify actual lossless HEVC playback and native fullscreen;
   codec detection and desktop pixel tests do not establish device support.
3. Validate packaging/runtime decoder behavior in the production container and
   representative server load. Run decoder fixtures with the runtime's
   Debian FFmpeg package through the `media-verification` Docker target. Require
   that result alongside the production image health check; local decoder
   fixtures do not establish production-container support.
4. Verify HEIC through Gallery, Feed, Compare, viewer and framing on actual devices.
   Maintained libheif CLI tools decode genuine HEVC primary photos into full-size
   profile-preserving PNGs; tests cover 8/10-bit SDR, alpha, orientation, collections,
   stale sources, bounded work and unchanged downloads. Unsupported HDR and
   resource limits fail explicitly. See [HEIC tools](../installation.md#heic-tools).
5. Preserve decoded-frame hash and timestamp regression coverage for lossless
   Bounce. Native and container tests cover VFR, 8/10-bit samples, source
   color/orientation, frame boundaries and resource rejection. Do not extend
   support to HDR or per-frame Dolby Vision metadata
   on the strength of SDR tests. A future [WebCodecs](https://www.w3.org/TR/webcodecs/)
   reversal alternative would need demuxing, bounded keyframe windows/decoded
   memory, cleanup and a separate
   [iPhone native-fullscreen solution](https://bugs.webkit.org/show_bug.cgi?id=206854).

## Deferred Improvements

### Bounce startup performance

Status: Cache reuse and bounded Feed preparation implemented. Preparation after
Save remains deferred.

Currently, Save validates the selected section and stores presentation settings.
The first playback request generates the lossless Bounce video and saves it in
the managed cache. Current files survive server restarts. Playback now checks
the cache before source-frame analysis; newly prepared files also retain bounded
timing/capability metadata for safe reuse after restart. Source identity, edit
keys and verified file access still apply. Missing metadata uses normal analysis.

Feed gives the current video priority and prepares at most 512 KiB of the next
video after the current one has buffered ahead. Preparation stops for buffering,
pause, hidden pages or constrained connections. Inactive Feed videos do not
download complete sources. The shared loading bar also indicates native
buffering while keeping the current frame visible.

Remaining optional work: start bounded server preparation after a successful
Bounce save, sharing jobs with playback requests. Saving settings and finishing
preparation must remain distinct outcomes: preparation failure must not undo
saved edits, and readiness requires atomic publication. Continue after browser
closure, reconcile pending work against current settings after server
interruption, and discard obsolete work after source, range or reset changes.
Let the viewing client select a supported codec and retain lazy fallback without
preparing both formats for every save. Reuse existing processing queues rather
than adding a general job framework.

Keep the existing lossless quality, processing limits, managed data directory
and cleanup rules. HEVC and H.264 have separate files; a new browser codec may
require its own preparation. Large lossless files still take time to transfer
and decode. Reuse the shared loading and error feedback.

Acceptance: verify cache reuse before and after restart without repeated frame
analysis; first preparation, codec fallback and concurrent requests; source or
highlight changes during processing; browser closure, server interruption,
failure, retry and obsolete-file cleanup. Measure preparation, transfer and
first-frame decoding separately on representative media. Complete the local,
browser and container checks before release.

Maintain this tracker when a milestone changes, a decision changes, or an
acceptance check reveals a material gap. Put stable user/operator guidance in
its existing document and remove obsolete proposals instead of accumulating
session notes or temporary audit reports.
