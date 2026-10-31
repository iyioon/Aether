# Security

Aether is designed for a private home server or trusted network. It is not a
multi-user service and should not be placed directly on the public internet.

## Trust Model

- One shared password protects the app.
- Passwords are checked with Argon2id hashes.
- Sessions are stored on the server and referenced by signed cookies.
- Failed sign-ins are throttled and temporarily locked.
- Sign-in throttling stores a keyed digest of the request source, not its raw
  network address.
- Requests that change data require a CSRF token.
- Media routes require a valid session and use asset IDs instead of source paths.
- Aether resolves media paths inside configured roots and rejects symlink escapes.
- The Docker container runs without root privileges or Linux capabilities.
- Docker mounts source media read-only.

The Settings page reports whether important options are enabled, but it does not
send secrets or absolute server paths to the browser.

## Network Access

Docker binds to `127.0.0.1:3030` by default. Keep that setting and use an HTTPS
reverse proxy, or connect through a private VPN.

For an HTTPS proxy, set:

```bash
AETHER_COOKIE_SECURE=true
AETHER_TRUST_PROXY=true
```

Only trust proxy headers when every request passes through a proxy you control.
`npm run dev:lan` uses plain HTTP and is meant only for short tests on a trusted
network.

## Browser Privacy

The page title does not include media names, and media URLs use opaque asset IDs.
Search text and selected tags can appear in the page URL, so they may be kept in
browser history.

Saved navigation and ranking state includes filters, asset IDs, and scroll
positions in local storage. Signing out clears that state, pending image
preloads, readiness hints, decoded animation atlases and capability caches. Appearance
preferences remain in this browser. The viewer's Use saved framing preference
stores only a boolean in localStorage and remains after signing out; it contains
no asset IDs, media paths or media content. Each browser/device keeps its own
choice. The service worker caches only public application files; private API
responses and media bypass it.

Comparison preloading requests a small number of upcoming items through the
same authenticated media routes. Its queue stays in memory and stops when the
page is hidden; it does not create a separate persistent media store.
Feed prepares only the next video, with a low-priority range of at most 512 KiB
after current playback has buffered ahead. Hidden, offline and constrained
connections stop preparation, as do current playback waits and pauses.

Metadata responses are marked `no-store`. Media files and generated previews
use private browser caching with `no-cache`: the browser must authenticate and
revalidate them before reuse, including conditional requests. Versioned media
URLs also separate changed source versions. Secure sign-out requests browser
cache clearing where supported, while retaining appearance preferences. This
does not guarantee removal of previously cached bytes, downloads, browser
history, restored tabs or mobile app-switcher screenshots, which the device
controls.

Use the browser's site-data and download controls when a device must forget a
library.

## Local Data

The database, cache, internal backups, native-tool temporary work and private
settings live under `AETHER_DATA_DIR`. The process sets `TMPDIR`, `TMP` and `TEMP`
to a protected per-process directory before loading image processors. These
scopes are removed on normal exit; startup clears verifiably abandoned
same-host scopes without deleting an active backup's work. They are not
encrypted by Aether. Protect the host account,
use encrypted storage when needed, and restrict access to the data directory.
On removable or network storage, confirm that file permissions are actually
enforced. Some volumes let every local account act as the file owner; use an
encrypted volume or enable ownership when other local accounts are not trusted.

A successful scan removes database records and generated derivatives for source
files that are confirmed missing. Deleted information may still exist in
browser storage, logs, backups, filesystem snapshots, or storage hardware. See
[Data management](data-management.md) for rebuild and wipe instructions.

Startup also removes unfinished cache records, obsolete source versions and
retired presentation files. Normal scans preserve active processor work while
removing confirmed obsolete files. The latest 20 finished scan jobs are retained;
stored scan failure messages exclude source paths. Expired sessions and stale
sign-in throttling records are pruned at startup and hourly. Comparison history
is retained for rankings, Undo and idempotent retries until the related media or
ranking data is removed.

## Secrets

Keep password hashes, session secrets, and media-root paths in
`aether-data/private.env`. Never commit that file or the data directory.
Private settings are read from a validated ordinary file that is neither a
symlink nor a hard link, using no-follow opening and owner-only permissions.
Inherited shell settings take precedence.

Rotate `AETHER_SESSION_SECRET` if it is exposed. This signs every current device
out. Change the password hash as well if the password may be known.

## Backups

`npm run backup` writes inside the Aether data directory by default. It does not
copy `private.env`. A backup created with an external `--output` path will
survive `data:wipe` and must be managed separately.

Source media is never part of an Aether database backup. Back it up with the
storage system that owns it.

Internal backups publish atomically from private temporary work. Incomplete
internal copies are removed with abandoned process scopes. Completed backups
are retained unless an explicit `--keep` policy, rebuild or
wipe removes them. Restore recovery copies are preserved after an interrupted
swap, and startup refuses to create a replacement empty database while those
copies remain. A verified restore or explicit rebuild can clear that state.

## Optional Tag Suggestions

Tag suggestions are disabled by default. When enabled, Aether sends a resized
image, filename, and existing tags to the configured Ollama-compatible endpoint.
Keep that endpoint local unless you intend to share this information with its
operator.

## Limits

Aether does not provide per-user permissions, account recovery, device
management, public sharing, or a security audit log. Password-only access is a
deliberate fit for a small trusted deployment, not a substitute for network and
device security.

## Presentation Processing

Presentation saves require an authenticated session and the existing CSRF check.
Strict finite, bounded fields and an expected revision prevent malformed edits
and stale overwrites. Processing receives resolved source records; it cannot
write source media. A changed physical source must be rescanned before saving.
Source identity comparisons use exact filesystem timestamps converted to the
same integer milliseconds as scanning; they do not allow a timestamp tolerance.
Device and inode are also rechecked after probing, so an atomic replacement
with the same size and timestamp cannot receive edits validated for another file.
Shared presentation publication performs the same identity check. In-memory
probe and frame-plan caches include the physical source identity, preventing an
atomic replacement from reusing the previous file's metadata or timeline.
Short cache publication and retirement steps share bounded coordination with
presentation saves and resets. No later change can reuse a path while an older
cleanup or rollback is still deleting it. Shutdown drains request processing
before closing the database, removing temporary work or releasing its runtime
lock, including work started by clients that have disconnected.

Rendition and atlas routes keep authenticated private, revalidated caching and HEAD/range
semantics. Their opaque keys contain no private paths. Capability/manifest
responses use `no-store`; the PWA never caches private media or metadata.
Prepared Bounce timing metadata remains beside its registered video in the
managed cache. Reuse requires matching source/rendition fingerprints and current
edit keys, bounded fields and verified file descriptors. Reset, replacement and
asset removal retire the metadata with its video.
Animation cache manifests keep a private source fingerprint, including exact
device/inode and nanosecond modification/change times. Reuse and publication
verify that fingerprint through source descriptors, so a same-size/time
replacement cannot reuse old frames. Public animation manifests omit it.
Older animation caches without a fingerprint are rebuilt once.
Failed playback responses expose only fixed public error codes in
`x-aether-media-error`. The browser can read them with an authenticated,
deadline-limited HEAD request after native playback fails; it does not download
the media body or expose subprocess output, source paths or private settings.
FFmpeg permits local media protocols/containers only and uses fixed argument
arrays, bounded work queues, deadlines, metadata/output limits, and serialized
reverse work. Lossless Bounce retains supported source pixels and timing without
writing the source. It rejects unsupported profiles/metadata and bounds section
duration, frame count, decoded-frame work, temporary disk use, output bytes and
preparation time. Bounce uses a private lossless frame store under the cache and
streams frames through bounded buffers; codec overhead is additional to the
decoded-frame budget. Temporary stores and partial output are removed after
completion or failure, and startup removes abandoned work after a crash.
Animation decoding has
frame, duration, source-size, pixel and byte limits, and rejects excess dimensions
instead of downscaling. Native repeat highlights use the same authenticated
original-stream route and do not create another source copy.
Unsafe source/cache symlinks are rejected. Temporary files are removed on
failure; stale generation is rejected, and successful replacements remove only
superseded registered files. These limits reduce resource exposure; Aether still
expects media folders controlled by its operator.

Ordinary video posters and previews each cap distinct pending jobs at 32,
including active jobs. Requests for existing jobs share work, and ready files
remain accessible when the queue is full. Overload returns `503 processing_busy`
and `Retry-After` without allocating an asset cache directory. Browser media
failures can be retried explicitly; a busy preview must not trigger a larger
original-media download.
