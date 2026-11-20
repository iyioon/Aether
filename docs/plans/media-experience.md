# Media Playback And Presentation Plan

Status: Presentation, Bounce and HEIC implemented; automated checks and device acceptance are tracked below.\
Reviewed: 2026-11-21.

## Outcome And Scope

Provide shared playback controls, safe phone layouts, and non-destructive saved
presentation across Gallery, Feed, viewer and Comparison. Presentation includes
highlights, position/zoom, speed and repeat/bounce for videos and animated GIF,
WebP, APNG and AVIF. Source files and downloads remain unchanged.

The current delivery covers presentation settings and HEIC photos. A video identification/loading badge is excluded. iOS may
reserve a status-bar strip; do not compensate with physical-screen dimensions
or unsupported fullscreen tricks.

## Delivery Tracker

| ID  | Deliverable                                     | State                                       | Remaining acceptance                            |
| --- | ----------------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| M0  | Capability and resource proofs                  | Local, container and load proofs verified   | Actual iPhone and deployment acceptance         |
| M1  | Shared controls and safe areas                  | Implemented                                 | Installed iPhone, VoiceOver and rotation checks |
| M2  | Saved presentation, revisions, cache and resets | Implemented                                 | Production deployment acceptance                |
| M2a | Controlled GIF/WebP/APNG/AVIF                   | Implemented                                 | Real-device playback and resource acceptance    |
| M3  | HEIC/HEIF display                               | Automated and mixed-library checks verified | Actual iPhone and library acceptance            |
| M4  | Highlights, speed, repeat and posters           | Implemented                                 | Device and native fullscreen acceptance         |
| M5  | Framing and Comparison aspects                  | Implemented                                 | Device acceptance across orientation changes    |
| M6  | Video and animation bounce                      | Local, container and load proofs verified   | Real iPhone and deployment acceptance           |
| M7  | Cross-feature verification                      | Automated and mixed-library checks verified | Actual devices and library acceptance           |

HEIC uses the shared media surfaces and preserves the original download.

## Product Decisions

- One shared editor, one preview, Playback and Framing sections. Still files
  show Framing directly. Fullscreen on desktop and phones. Explicit Save/Cancel;
  Reset all clears the presentation draft until Save. Switching aspects retains all pending frames.
  Preview and seeking stay outside the tabs; switching tools preserves playback.
  Seeking pauses anywhere in the full source. Loading, failure and editing use
  one shell with the same header and footer. Preview Retry retains drafts and
  position. Space controls preview playback; neutral Left/Right keys seek in
  Playback, while Framing retains its crop shortcuts.
- Highlights use original source times and two labelled handles plus editable
  time fields. Speed presets: 0.5×, 0.75×, 1×, 1.25×, 1.5× and 2×.
- Fit shows the whole item. Fill supports drag, pinch, keyboard movement and
  bounded zoom. These are the editor's only framing choices. Legacy Auto records
  remain supported and show the invoking view's matching Fit/Fill choice,
  without bulk migration or asset writes on open. Each
  Original/Square/Portrait/Landscape frame is independent;
  one Save writes all drafts. Cards use the preset for the selected aspect; the
  expanded viewer defaults to original proportions unless Settings chooses saved
  framing or a remembered choice. Its View options can apply
  the invoking Gallery/Ranking aspect or Feed's resolved preset and the corresponding
  saved position/zoom. With Remember last, this browser-local appearance choice
  retains both on and off through previous/next, close/reopen, reload and logout.
  The remembered choice stores only a boolean; changing it preserves media and
  playback without editing saved frames.
- Feed fills the available workspace on desktop and phones. In View options →
  Layout, Media layout offers Fill screen and Original, separate from Play
  highlights only. Fill screen chooses the closest framing from the source's
  Original proportions and explicitly saved presets, including the selected
  highlight. Original contains the full source without saved crops. Transport
  and details stay attached to the workspace frame. The editor and viewer use
  the resolved aspect. Normalize older fixed Feed layouts to Fill screen while
  retaining Original and the current item and navigation state.
- Play highlights only is a View options preference, shared with the viewer menu
  and initialized from Settings → Playback or the resumed session/link. It is
  disabled for items without a saved section. The viewer menu also provides Use
  saved framing, initialized on opening from the Full view framing default;
  native iPhone video
  fullscreen retains original proportions and system controls. With highlights off,
  items with highlights play their full source in Repeat; saved speed/framing
  still apply. Without a highlight, Bounce applies to the full item.
- Comparison uses saved playback mode and speed with selected aspect framing and
  the shared Play highlights only preference. View options → Layout changes shape and card info
  without changing pair selection or Undo. Each view remembers these choices;
  Feed defaults to Fill screen; Ranking defaults to Original. Both start with no card info. Feed metadata uses compact icon/value rows and a
  heart only for favorites. Comparison cards have
  no Edit action; Feed and viewer use a pencil icon.
- Video bounce is silent. Its saved rendition is continuous forward/reverse;
  draft preview plays forward until Save. Animation retains alpha and variable
  delays, with interior frames reversed to avoid duplicate endpoint holds.
  Video uses high-quality compressed playback at the original dimensions and
  frame timing, replacing bit-exact lossless copies. HEVC retains supported
  input bit depth; H.264 uses 8-bit SDR for native compatibility. Original
  sources and downloads remain unchanged.
- Keep ordinary Gallery tiles lightweight; transport controls belong in Feed
  and the expanded viewer. Gallery Edit and Download actions belong in the
  viewer toolbar and the card context menu (right-click, keyboard or touch hold).
  Do not add a second speed or crop control panel.
- Playback bars mark saved highlights with a rounded accent segment inside the
  seek track, hidden during highlight-only playback. The editor follows its
  draft in both tabs, with precise descriptions for assistive technology.

## Implemented Contracts And Evidence

### Storage, identity and reset

Schema migration 18 adds per-asset metadata with optimistic revisions. Migration
19 adds independent aspect presets, retaining earlier custom crops in each shape.
Migration 20 remains for database/backup compatibility; its older Feed overrides
are preserved by ordinary saves but no longer affect Feed. Framing
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
  atlases are at most 2048px, with sixty seconds, 600 frames and 64 MiB encoded
  output. GIF/WebP allow 256 million total frame pixels, decoded in ranges of
  at most 64 million pixels into one temporary uncompressed TIFF store. APNG/AVIF
  retain a 64-million total-frame-pixel limit. Header-only inspection checks the
  timeline before decoding. Atlas generation has a two-minute job budget;
  source decoding has a cumulative sixty-second budget. Stores align with atlas
  boundaries and replace the preceding store, keeping one atlas batch in memory.
  Client atlas decoding is bounded and shared.
- Repeat video highlights loop the original authenticated stream at source times
  in Feed, viewer and Comparison. A shared section observer clamps seeks and
  waits for an in-range presented frame; hidden/replaced work is cancelled.
  Unsupported codecs fall back to complete compatibility highlights: at most two
  minutes, 1080px, 128 MiB and a 120-second encode deadline, with a completeness
  check. Short Gallery previews are never used as complete sections.
- Video Bounce prepares high-quality HEVC (`hvc1`) or H.264 High video with
  source frame timing, coded dimensions/SAR, color metadata and rotation.
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
web animation timeline/manifest/cache and preview-seeking tests;
`tests/e2e/presentation.spec.ts`, `tests/e2e/presentation-seeking.spec.ts` and
`tests/e2e/presentation-retry.spec.ts`.
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
Use [x265 quality and bitrate controls](https://x265.readthedocs.io/en/master/cli.html#quality-rate-control-and-rate-distortion-options) and
[Apple codec guidance](https://developer.apple.com/streaming/hls-authoring-specification-for-apple-devices.html)
for encoding/profile decisions. Full resolution is retained; compressed output
does not promise exact decoded-pixel equality. Reported HEVC support still
requires device testing.

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
   On iPhone 16, verify actual HEVC playback and native fullscreen;
   codec detection and desktop pixel tests do not establish device support.
3. Repeat packaging/runtime decoder and mixed-library resource checks when media
   processing changes. Run decoder fixtures with the runtime's
   Debian FFmpeg package through the `media-verification` Docker target. Require
   that result alongside the production image health check; local decoder
   fixtures do not establish production-container support.
4. Verify HEIC through Gallery, Feed, Compare, viewer and framing on actual devices.
   Maintained libheif CLI tools decode genuine HEVC primary photos into full-size
   profile-preserving PNGs; tests cover 8/10-bit SDR, alpha, orientation, collections,
   stale sources, bounded work and unchanged downloads. Unsupported HDR and
   resource limits fail explicitly. See [HEIC tools](../installation.md#heic-tools).
5. Preserve decoded-frame fidelity and timestamp regression coverage for
   Bounce. Native and container tests cover VFR, 8/10-bit samples, source
   color/orientation, frame boundaries and resource rejection. Do not extend
   support to HDR or per-frame Dolby Vision metadata
   on the strength of SDR tests. A future [WebCodecs](https://www.w3.org/TR/webcodecs/)
   reversal alternative would need demuxing, bounded keyframe windows/decoded
   memory, cleanup and a separate
   [iPhone native-fullscreen solution](https://bugs.webkit.org/show_bug.cgi?id=206854).

The opt-in [mixed-library check](../development.md#commands) covers 1,024
synthetic items with 12-megapixel photos, 1080p video, animated WebP and HEIC,
on desktop and phone layouts. Separate concurrent processing checks cover
GIF/WebP/APNG, both Bounce codecs, a 12-megapixel HEIC, warm-cache reuse,
restart, queue overload and reset/removal cleanup. These checks found and fixed
unbounded poster/preview admission and unnecessary server/client animation
decoding. Source hashes and temporary-file cleanup are checked independently.
Synthetic checks do not establish performance on the deployment machine or
actual iPhone memory limits. Dense grids whose original-size animation atlases
exceed the 48 MiB decoded cache can still require repeated decoding; limiting
simultaneous Gallery animation playback remains a separate product decision.

## Multiple Highlights

Extend the existing per-media presentation with up to 20 named highlights. Each
has a stable ID, source-time range, framing, speed and Repeat/Bounce preference.
One main highlight supplies the existing shared playback projection. Earlier
single highlights migrate to that main selection. Source files and downloads
remain unchanged; this is presentation metadata.

Delivery sequence:

1. Add versioned storage and bounded API validation. Preserve optimistic
   revisions, unknown-save reconciliation, safe asset identity and older backups.
   Validate every section against real duration and processing capabilities.
2. Reuse one preview and the Playback/Framing tabs. A Highlight picker selects
   the draft; Add highlight, Name, Make main and confirmed Remove highlight are its only
   additional controls. Valid drafts survive selection changes; invalid times
   must be corrected first. Save applies the collection together; Cancel
   discards it. Removing main selects the first remaining section, and removing
   the last clears playback edits.
3. Add Details/Highlights tabs to Info. Keep Details mounted to retain forms.
   List each section's name, range, speed and Main status, with separate View and
   Make main actions. View is temporary and does not mutate the main selection
   or global preferences. Avoid autoplaying the entire collection, nested
   editors, duplicate playback controls and extra sorting/filtering options.
4. Resolve secondary playback through its own ID and current rendition keys.
   Retain generated files referenced by any saved section. Playback reset clears
   the collection; framing reset clears every section's frames while preserving
   playback. Counts remain media counts. Preserve sections through safe moves,
   Trash/restore and backups; clear them when source contents are replaced.
5. Cover migration, validation, conflicts, reset/restore and secondary rendition
   identity below the UI. Verify desktop/phone editor and Info flows, navigation,
   cancellation, failures, focus, safe areas and actual video/animation playback.
   Run the required verification gate and relevant browser/media checks before
   release; record actual iPhone acceptance separately.

The selected-section inspector follows
[progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/):
show one section's existing tools rather than duplicate them for every section.
Names plus source ranges and speeds support
[recognition rather than recall](https://www.nngroup.com/articles/recognition-and-recall/).
Info uses the shared [WAI tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
with immediately available panels. Viewing and choosing a main highlight are
separate actions, preventing a browsing action from silently changing saved
playback.

## Deferred Improvements

### Bounce startup performance

Status: Cache reuse and bounded Feed preparation implemented. Preparation after
Save remains deferred.

Currently, Save validates the selected section and stores presentation settings.
The first playback request generates the compressed Bounce video and saves it in
the managed cache. Current files survive server restarts. Playback now checks
the cache before source-frame analysis; newly prepared files also retain bounded
timing/capability metadata for safe reuse after restart. Source identity, edit
keys and verified file access still apply. Missing metadata uses normal analysis.
Frame analysis uses one streamed pass and discards earlier keyframe preroll,
keeping short sections late in long videos within the metadata budget. A long
keyframe interval can still require extra source decoding on first preparation.

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

Keep the high-quality, original-resolution playback policy, processing limits,
managed data directory and cleanup rules. HEVC and H.264 have separate files;
a new browser codec may require its own preparation. The `bounce-playback-v6`
identity retires older lossless copies without changing saved settings or other
renditions. High dimensions, frame rates and playback speeds still need sufficient network and
decoding capacity. Reuse the shared loading and error feedback.

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
