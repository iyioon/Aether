# Media Playback And Presentation Plan

Status: Presentation implemented and reviewed; release acceptance is tracked below. HEIC remains separate.\
Reviewed: 2026-10-26.

## Outcome And Scope

Provide shared playback controls, safe phone layouts, and non-destructive saved
presentation across Gallery, Feed, viewer and Comparison. Presentation includes
highlights, position/zoom, speed and repeat/bounce for videos and animated GIF,
WebP, APNG and AVIF. Source files and downloads remain unchanged.

The current delivery covers presentation settings. HEIC decoding is the next
independent feature. A video identification/loading badge is excluded. iOS may
reserve a status-bar strip; do not compensate with physical-screen dimensions
or unsupported fullscreen tricks.

## Delivery Tracker

| ID  | Deliverable                                     | State                              | Remaining acceptance                                                |
| --- | ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| M0  | Capability and resource proofs                  | Local presentation proofs verified | Production-container decoders; HEIC proof; actual iPhone acceptance |
| M1  | Shared controls and safe areas                  | Implemented                        | Installed iPhone, VoiceOver and rotation checks                     |
| M2  | Saved presentation, revisions, cache and resets | Implemented                        | Production deployment acceptance                                    |
| M2a | Controlled GIF/WebP/APNG/AVIF                   | Implemented                        | Real-device playback and resource acceptance                        |
| M3  | HEIC/HEIF display                               | Not started                        | Decoder choice, fixtures, packaging, all media surfaces             |
| M4  | Highlights, speed, repeat and posters           | Implemented                        | Device and native fullscreen acceptance                             |
| M5  | Framing and Comparison aspects                  | Implemented                        | Device acceptance across orientation changes                        |
| M6  | Video and animation bounce                      | Implemented                        | Device acceptance; representative server check                      |
| M7  | Cross-feature verification                      | Implementation and review complete | Release gates, packaging and actual devices                         |

Implementation order was storage/contracts, capability and decoder proofs,
shared editor/framing, controlled animation, section playback, bounce and
cross-feature integration. M3 does not block presentation verification.

## Product Decisions

- One shared editor, one preview, Playback and Framing sections. Still files
  show Framing directly. Explicit Save/Cancel; Reset changes only the draft.
- Highlights use original source times and two labelled handles plus editable
  time fields. Speed presets: 0.5×, 0.75×, 1×, 1.25×, 1.5× and 2×.
- Fit shows the whole item. Fill supports drag, pinch, keyboard movement and
  bounded zoom. Auto retains Gallery/Feed Fill and Comparison/viewer Fit.
  One normalized focal point/zoom applies across shapes; no per-aspect crop table.
- Play highlights only is a remembered View options preference. With it off,
  items with highlights play their full source in Repeat; saved speed/framing
  still apply. Without a highlight, Bounce applies to the full item.
- Comparison deliberately uses full-source, normal-speed forward repeat with
  saved framing. A compact aspect menu changes Original/Square/Portrait/Landscape
  without changing pair selection or Undo.
- Video bounce is silent. Its saved rendition is continuous forward/reverse;
  draft preview plays forward until Save. Animation retains alpha and variable
  delays, with interior frames reversed to avoid duplicate endpoint holds.
- Keep ordinary Gallery tiles lightweight; transport controls belong in Feed
  and the expanded viewer. Do not add a second speed or crop control panel.

## Implemented Contracts And Evidence

### Storage, identity and reset

Schema migration 18 adds per-asset metadata with optimistic revisions. API saves
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
- Composed PNG atlases preserve transparency, with frames at most 512px,
  atlases at most 2048px, sixty seconds, 600 frames, 64 million total source
  pixels and 64 MiB encoded output. Atlas generation has a two-minute job budget;
  source decoding has a sixty-second deadline. Composed GIF/WebP frames use a
  temporary uncompressed TIFF store so one atlas batch is held in memory.
  Client atlas decoding is bounded and shared.
- Complete video highlights: at most two minutes, 1080px, 128 MiB and 120 seconds
  encode deadline, followed by a bounded completeness check. A short existing
  preview is never used as a complete section.
- Video bounce: at most ten seconds, 480px, 24fps and one reverse job at a time
  within the shared two-slot processor. A 480×480/10s/24fps local proof used
  approximately 154 MiB peak resident memory; this is a local measurement,
  not a guarantee for every FFmpeg build or server.
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
Negative native playback rates are
[not portable](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate);
FFmpeg's [reverse filter](https://ffmpeg.org/ffmpeg-filters.html#reverse) buffers
frames, which requires explicit resource bounds.

## Remaining Work

1. Require the verification gate, browser suite, dependency audit and container
   checks before release. Record actual checks in the change report; do not
   treat written tests as proof they ran.
2. Follow [Presentation acceptance](../release-checklist.md#presentation-acceptance)
   on a real installed iPhone: VoiceOver handles, short landscape, keyboard,
   pinch/drag, safe areas, Home/return and native fullscreen section bounds.
3. Validate packaging/runtime decoder behavior in the production container and
   representative server load. CI runs the decoder fixtures with the runtime's
   Debian FFmpeg package through the `media-verification` Docker target. Require
   that result alongside the production image health check; local decoder
   fixtures do not establish production-container support.
4. Start M3 separately: prove real HEVC-backed HEIC pixel decoding, select a
   reproducible decoder for native/container setup, then integrate thumbnail,
   viewer and cache behavior with failure/security fixtures. Metadata-only
   decoding is insufficient; see [sharp HEIF requirements](https://sharp.pixelplumbing.com/api-output/#heif).

Maintain this tracker when a milestone changes, a decision changes, or an
acceptance check reveals a material gap. Put stable user/operator guidance in
its existing document and remove obsolete proposals instead of accumulating
session notes or temporary audit reports.
