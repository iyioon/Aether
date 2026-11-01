# Media Management Plan

Status: Planned; implementation has not started.\
Reviewed: 2026-11-01.

## Outcome And Scope

Add media from a phone or computer, move media and folders within or between
assigned roots, and delete media to a recoverable Trash. Single-item and
selected-item actions use the same server operations. Moves and restores retain asset IDs, tags,
favorites, presentation settings and comparison history.

This extends the current source-read-only product boundary. Enable writes
explicitly for named media roots; existing installations remain read-only.
Presentation editing continues to change metadata rather than source bytes.

Included: device uploads, folder creation, same-drive and cross-drive media and
folder moves, Trash, restore, permanent deletion from Trash, progress,
cancellation and recovery. Existing external file copying and scanning
remain supported. Excluded: arbitrary server-path imports, URL imports, archives,
folder uploads, folder deletion, source transcoding, cloud sync,
public uploads and device photo-library synchronization.

## Delivery Tracker

| Stage | Deliverable                         | State   | Completion requirement                                                                                                         |
| ----- | ----------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| F0    | Filesystem and upload proofs        | Planned | Demonstrate safe file/subtree publication, metadata preservation, recovery and resumable uploads before choosing dependencies. |
| F1    | Write policy and durable operations | Planned | Root capabilities, path safety, schema, scanner coordination, startup recovery and maintenance guards pass fault tests.        |
| F2    | Move media and folders              | Planned | Complete same-drive and cross-drive flows with stable asset/folder IDs, collision handling and recovery of whole folders.      |
| F3    | Trash and restore                   | Planned | Active visibility, ranking, restore, retention, purge and maintenance behavior pass recovery tests.                            |
| F4    | Add media                           | Planned | Secure resumable uploads publish complete files and index them through the shared operation path.                              |
| F5    | Release acceptance                  | Planned | Desktop, actual iPhone PWA, container, security, failure, cleanup and documentation checks pass.                               |

Implement in this order. Each stage includes its API, minimal working UI,
regressions and affected documentation. Update this tracker when a stage changes
state; keep supporting detail here rather than creating a document per task.

## User Experience

### Add Media

Keep one Add media button in the Gallery toolbar, available even when empty.
Use the native multi-file picker on desktop and phones; desktop drag-and-drop
opens the same flow. Choose a writable destination, defaulting to the current
folder when possible. The destination picker can create one folder without
turning the main folder tree into a file manager.

Show a compact file list with transfer progress and distinct Uploading,
Checking and Added states. A full byte transfer is not yet a successful import.
Allow pause, resume, cancel and retry of failed items. Keep one operations panel
reachable after its initial dialog closes; navigation must not unmount its queue.
Show aggregate progress without creating a notification for every item.

Copy the bytes supplied by the device picker without modifying or deleting the
device's copy. Test iPhone Photos and Files separately: the operating system may
provide a converted file, and the app cannot promise access to the camera
original. HEIC, MOV and animated formats use the existing media inspection path.
Live Photo pairs are separate files, not a new combined asset type.

### Move Media

Add a Move to action to the Gallery context menu and selected-item actions. Provide it
through the viewer's More menu; Feed can use that viewer action. Preserve the
current clean cards and Feed control rail. Comparison choice cards stay focused
on ranking.

Use one destination picker with named roots, folder navigation and New folder.
Disable ineligible destinations with a concise reason for unavailable roots.
Keep the filename. A conflict offers Skip or Keep both, with an available suffix;
the default is Skip. Never offer silent replacement. Moving into the current
folder is a no-op. A batch reports each item's result and retries failed items
without repeating successful ones.

### Move Folders

Add a Move to action to the folder context menu, including long press, and an
accessible actions button for the selected folder. Reuse the media destination picker;
the initial interface moves one folder at a time. Folder drag-and-drop and
folder deletion remain outside this delivery.

Move the whole folder, including nested and empty folders, hidden regular files
and sidecars that Aether does not index. Show its destination, item count and
total size before starting. A name conflict offers Skip or Keep both for the
whole folder, without merging or replacing a destination tree. Moving to the
existing parent is a no-op. An assigned root is a valid destination but cannot
itself be moved. Reject destinations outside assigned roots, the source folder
or its descendants, reserved Trash/staging directories and overlapping
operations. Reject symlinks, special files, nested mounts or required
filesystem metadata that cannot be preserved safely; never omit them silently.

Inventory the source into a bounded durable manifest. Reserve the entire source
and destination subtrees before execution. Revalidate their identities and
contents as work proceeds; external changes require recovery rather than guessed
deletions. F0 must establish limits for manifest depth, entries and total bytes,
and preservation of supported permissions, timestamps and extended attributes.

A same-drive move publishes the directory without replacement. A cross-drive
move copies and verifies the complete tree in an owned destination stage, then
publishes its top-level directory without replacement. A folder is one durable
operation item, not a series of visible imports. For cross-drive copies, retain
the source until publication and the metadata commit succeed; same-drive rename
must recover the interval before its DB commit. Retire only verified manifest
entries and remove only empty directories; never recursively delete a source
tree that may have acquired new files. Interrupted retirement remains reserved
for recovery, and the folder is not reported as complete until cleanup succeeds.

Preserve the moved folder's ID, descendant folder IDs and every asset ID.
Current folder IDs derive from paths; adapt scanner discovery to reuse stored
IDs by current location and allocate fresh IDs for new folders. Migration must
retain existing IDs, and recreating the old path must receive a new ID. Commit
all descendant root/path changes, the top folder's parent, active asset locations,
search rows and folder counts together. Resolve descendants using the folder
hierarchy and exact path segments rather than an unescaped string prefix.
Refresh breadcrumbs/tree and keep an open moved folder selected by ID; reject
stale folder versions and invalidate obsolete comparisons and reads.

If media was trashed before its original folder moved, leave its payload in the
original root's Trash. Restore follows the preserved folder ID to its current
location, showing that destination and checking both roots' write permissions.
Keep deletion-time root/path details for history separately from physical Trash
identity. If the folder is unavailable, request another destination. A recreated
old pathname with a new folder ID must not silently become the restore target.

### Delete And Restore

Label the ordinary action Move to Trash. Use the existing shadcn AlertDialog
with the selected count and a short explanation that files leave the library
and can be restored for 30 days. Cancel receives initial focus. Show Undo after
success; it starts the same restore operation used by the Trash view.

Add one Trash destination in the library sidebar. Show name, original folder,
thumbnail, deletion date and remaining retention. Provide Restore and Delete
permanently for one or more items, plus Empty Trash with a separate destructive confirmation.
Restoring to an occupied location offers Skip, Keep both or another writable
destination. It never overwrites a replacement file.

Trash does not free the file's disk space. Display the retained size. Purge
expired items only after verifying their ownership and identity; unavailable
drives wait until available. A restore accepted before expiry claims the item
against concurrent purge. Missing or unrecognized files require attention rather
than automatic removal of their recovery records.

Use shared menus, Dialog/Sheet, AlertDialog, Progress and status styles. Maintain
safe areas, reachable touch targets, keyboard navigation, focus restoration,
screen-reader progress and reduced motion. Long press remains the mobile Gallery
context action; selected-item actions provide a visible alternative.

## Filesystem And Data Contracts

### Permissions And Destination Safety

Introduce a writable-root allowlist keyed by existing stable root names,
initially empty. A move requires both source and destination writes; uploads
require destination writes. Trash and restore also check the relevant root's
permission. All signed-in devices share these capabilities; this adds no users
or roles. Reject unknown writable roots and overlapping configured roots whenever
either is writable. A writable subtree must not also be indexed through a
read-only parent. Nested filesystems are not writable through a parent root;
configure disjoint roots on each filesystem so Trash stays on the source drive.
Navigation can reach an assigned root but cannot move above it. File and folder
operations cannot rename, move or delete that root. Another root is eligible
only when separately assigned and writable; filesystem paths supplied by the
browser never grant access to a parent or sibling outside those boundaries.

Keep the default Compose media mount read-only. Document an explicit writable
mount override for chosen roots, retaining the read-only container filesystem,
unprivileged user and capability restrictions. Return root IDs, labels and
allowed actions to the browser, never absolute paths or OS error details.

Accept asset IDs, destination folder IDs and a validated basename. Reject
traversal, absolute paths, separators, control characters, reserved names and
invalid or ambiguous destination names. Respect the destination filesystem's
case and Unicode behavior. Do not trust the browser's MIME type or file size.
Resolve and verify source descriptors and destination parents under their roots.

F0 must prove publication without replacement and safe source retirement on
Linux, macOS and the filesystems used for deployment. A check followed by
ordinary rename is insufficient; copying directly to a visible final name is
also insufficient. Exercise parent/leaf replacement and symlink races. If a
small maintained native helper is needed for directory-relative operations,
review it before adoption. Unsupported filesystems remain read-only, without a
weaker fallback or claims of safety against hostile host writers.

### Durable Operations

Use one focused server feature for move, trash, restore, purge and upload
publication. Keep transport validation, filesystem execution and SQLite writes
in their existing layers. Do not add an external queue or general workflow
framework.

Append migrations for operation and per-item records, plus asset lifecycle and
Trash metadata. Keep lifecycle separate from existing inspection status.
Mutations carry opaque expected source/lifecycle versions, separate from
presentation revisions, so a stale selection cannot delete a replacement file.
Operation receipts survive asset purge. Store immutable request
identity, expected source revision/descriptor, intended destination, owned stage,
verified size/digest, durable phase and result. Reusing a request ID with different
input is a conflict; unknown outcomes query or retry the original ID.

The server owns accepted work. A browser disconnect does not cancel a move or
deletion. Start with one filesystem mutation at a time and a bounded queue.
Upload byte transfer can run separately with bounded concurrency. Cancellation
stops queued items and safely discards uncommitted work; a committed item requires
a separate reverse operation. A partially successful batch is not an atomic
filesystem transaction.

Journal intent before changing files. For a cross-drive move, copy from a
verified descriptor to an exclusive destination stage, verify its bytes, flush,
publish without replacement, and durably commit the asset's new location before
retiring the verified old entry. Record each recoverable boundary. If source
identity changes, retain the verified destination and original entry for review.
Recovery inspects actual files and recorded identities instead of blindly
replaying commands. Never remove the only verified copy. A same-drive fast path
must preserve these guarantees and recover the interval before its DB commit.

Do not hold a SQLite transaction during a large transfer. Coordinate scanner
discovery/reconciliation and short filesystem publication with this runner so
intermediate locations cannot become new assets or trigger missing-file deletion.
Reserve both old and new locations through source retirement and any recovery,
including cases retaining two copies for review. Coalesce watcher notifications
into a fresh scan only after those locations are reconciled. Lock related
presentation/annotation mutations briefly and reject stale revisions. Existing
reads may finish, but new requests follow the current asset lifecycle.

### Trash Storage And Maintenance

Keep trashed original bytes in an app-reserved, protected directory on their
current media root, addressed by opaque IDs and excluded from scanning. For
example, a root at `/media/library` keeps its Trash under
`/media/library/.aether-trash`, never in `/media` or beside the data directory.
The reserved name and directory ownership must pass F0 validation. Folder moves
cannot include, target, merge or relocate this reserved storage. This
avoids copying large videos to the data drive. All metadata, restore locations,
operation records and resumable upload staging remain under `AETHER_DATA_DIR`.
Cross-drive publication also needs an exclusive stage on the destination
filesystem. Reserved root directories hold only these pending originals and
trashed originals, with no database, cache or sidecar metadata. Journal ownership
before creating them, exclude them from scans, and recover/clean only verified
owned stages. Never adopt or remove unknown existing contents.

Trash retains the asset record while releasing its active pathname for reuse.
Replace unconditional location uniqueness with an active-location constraint;
retain original location and physical Trash identity separately. Root/folder
pruning must not cascade-delete retained Trash records. A removed root remains
unavailable for restore until safely remapped or re-enabled. Root names and paths
alone do not establish ownership on a replacement drive: verify recorded root
and payload identities before adopting, restoring or purging its contents.

Add a maintenance guard before enabling writes: rebuild, wipe and database
restore refuse unresolved operations, paused uploads and nonempty current Trash.
The operator must finish/cancel transfers and restore or explicitly purge Trash
first. `data:status` reports these blockers. Maintenance may inspect Trash through
validated descriptors, but must never modify or recursively delete source roots
or silently erase recovery metadata. Detect unknown reserved-root payloads after
lost/replaced state and disable writes pending recovery. Provide a narrowly
scoped offline recovery action, with record IDs and explicit confirmation, for
acknowledging originals on a permanently lost drive. It must not authorize
deletion of unknown files or bypass path checks.

Database backups still exclude original and Trash bytes. Document this and
their separate filesystem backup requirement. Quiesce filesystem commits and
capture the database at a documented recoverable operation boundary. Restore
must invalidate historical operation execution and upload sessions, never replay
old deletes or moves. If a backup contains Trash
records, validate the corresponding payloads and root identities before accepting
it; missing payloads require restoration from the filesystem backup. Reconcile
the complete source library before re-enabling writes after database restore.
Cover fresh, upgrade, backup, rebuild, restore and wipe behavior before releasing
F3.

### Identity And Active Views

Explicit moves update the existing asset ID, location/search fields and exact
physical identity; they do not rely on content matching during a later scan.
Refresh source/cache versions after a changed descriptor. Retire only affected
derivatives and prevent in-flight generation from publishing an obsolete result.
Do not promise to reuse Bounce or HEIC output until identity checks establish
that reuse is safe.

Trash is excluded from folder counts, search, random order, tags in use,
rankings, comparison selection and every ordinary direct detail/media/download/
thumbnail/edit route. Provide dedicated authenticated Trash metadata and thumbnail
routes with verified Trash descriptors. Retain or regenerate a bounded thumbnail
for recognition; retire heavyweight renditions and block ordinary asset writes.
Preserve tags, presentation and comparison history for restore; suspend
preferences involving inactive assets from active ranking calculations while
retaining manual adjustments outside disposable ranking projections. Permanent
purge removes associated metadata and generated files after file deletion is
verified, and prunes orphan relations safely. A recorded, verified purge can
complete metadata cleanup after a crash; an unexpectedly missing payload cannot.

Use returned records and a library mutation revision to refresh all affected
surfaces. Discard obsolete list/tree reads and prepared comparison pairs;
revalidate new votes and Undo against active assets while preserving receipts
for previously acknowledged requests. Preserve scroll depth and the current
anchor when possible. A moved item can remain open by stable ID even if
it leaves the current folder; Previous/Next use the refreshed result. Trashing
the viewed item advances to a surviving neighbor or closes the viewer. A deleted
editor target becomes unavailable without discarding another item's draft.
Refresh on foreground and reject stale URL/checkpoint IDs after restoration.

## Upload Security And Recovery

Use a maintained tus implementation for resumable transport if F0 confirms
Node 24, Fastify 5, same-origin session/CSRF and cleanup compatibility. Evaluate
`@tus/server`, its file store and `tus-js-client`; load browser upload code only
when needed. Do not build a second private upload protocol. Authenticate every
creation, offset, transfer, cancellation and status request. Apply CSRF to unsafe
methods before accepting bytes; opaque upload URLs are not authorization.

Stream to private, owned staging under the data directory. Keep the global
1 MiB JSON limit; configure bounded binary transfer separately. Enforce the
declared and actual length, offset, checksum, supported type/signature, bounded
media inspection, per-file and aggregate disk budgets, admission limits and
timeouts. Use logical admission reservations and free-space checks on both
staging and destination volumes, accounting for simultaneous jobs and shared
volumes. Other host processes can still consume space; disk-full errors must
recover safely. Do not execute uploaded content or serve incomplete files.
Publish complete verified files through F1, preserving
their received bytes and assigning new IDs; distinct identical files do not
silently inherit another asset's metadata.

Initial limits to validate in F0: 100 items per batch, two transfer streams, one
mutation worker, 16 MiB chunks, 20 GiB per file and 20 GiB total upload staging.
Retain at least 2 GiB free on each involved volume. Make byte budgets operator
configurable and document proxy limits; these are proposed resource defaults,
not measured performance claims. Expire inactive uploads after 24 hours and
completed operation receipts after seven days. Never expire unresolved recovery
records or unverified Trash. Bound pending requests and retained status lists.

On iPhone suspension or lost connectivity, pause UI polling and resume from the
server's acknowledged offset on return. Do not depend on unload handlers,
background JavaScript, keepalive or the service worker to finish a video upload.
After a reload, offer reselection of the same file; verify the retained prefix
against it before appending. Hash incrementally without retaining the whole
video in memory. A changed file starts a new transfer. Bytes already fully
received can finish server validation/publication after the browser closes.

Persist no file blobs, private filenames or source paths in browser checkpoints.
Disable upload SDK defaults that persist filenames in fingerprints or URL stores.
Retain only bounded opaque operation IDs, cleared on logout; recover status from
authenticated endpoints after sign-in. Logout stops local transfers without
claiming accepted server work was cancelled. Retry within the receipt lifetime
uses the original request; expired outcomes need explicit reconciliation.
Cleanup removes only verified operation-owned staging and terminal records.
Unknown leftovers stay protected and visible to the operator.

## Repository Integration

| Area                         | Extend                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write policy and startup     | `apps/server/src/config/config.ts`, `http/app.ts`, private configuration examples, Compose and runtime drain order.                                                        |
| Operation feature            | Focused routes, schemas, repository and filesystem modules under `apps/server/src/library`; reuse the repository facade and descriptor validation.                         |
| Lifecycle and reconciliation | `db/database.ts`, `library/asset-query.ts`, repository folder/scan/ranking/comparison modules, `scanner.ts`, watcher coordination and direct media resolution.             |
| Cache and maintenance        | Existing derivative/presentation cache cleanup, `maintenance` backup/restore/data commands and startup recovery.                                                           |
| Browser                      | `api/client.ts`, AppShell feature hook, GalleryCardActions, BatchActionsBar, folder actions, destination picker, viewer More menu, sidebar Trash and one operations panel. |
| Existing state               | Library tree/list refresh, selection, viewer anchors, scroll restoration, random order, comparison generation/resume and unauthorized handling.                            |

Server paths after a listed application root are relative to its `src` directory.
Do not move unrelated modules or rename existing components to deliver this work.

## Verification And Completion

| Coverage                | Required cases                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization and paths | Default read-only behavior; configured root capabilities; auth/CSRF on all upload methods; traversal, symlink/parent swaps, hard links, reserved names, Unicode/case collisions and concurrent destination creation.                                                                                                                                                                         |
| Files and recovery      | Fault injection before/after each durable phase; same/cross-drive moves; source replacement; disk full; quota races; permission loss; disconnected drives; crash/restart; process shutdown; unknown files; cancellation; partial batches and request-ID replay.                                                                                                                              |
| Folder moves            | Protected-root source rejection; valid root destinations; same-parent no-op; self/descendant rejection; no merging; stable folder/asset IDs and recreated paths; empty/hidden/sidecar entries; unsupported metadata/symlinks/mounts; bounded inventories; concurrent changes and crash recovery; search/counts and open-folder restoration; restoring Trash after its original folder moves. |
| Metadata and media      | Stable IDs with duplicate content; annotations, frames/highlights, manual scores and history across move/restore; active-only ranking and direct access; invalidated derivatives; stale generator publication; watcher/scan races and repeated cleanup.                                                                                                                                      |
| Uploads                 | Partial/duplicate/out-of-order chunks; offset/checksum errors; spoofed type/length; unsupported media; HEIC/MOV/animation inspection; oversized input; inactivity expiry; reselected changed file; browser close; login expiry and bounded memory/disk.                                                                                                                                      |
| Maintenance             | Fresh/upgrade schemas; old backups; paused work/Trash guards; no historical operation replay; unavailable Trash payloads; root removal; backup/source separation and rebuild/wipe data safety.                                                                                                                                                                                               |
| Interface               | Single/batch operations, destination conflicts, retry of failed items only, progress after dialog close, accessible confirmation/focus, narrow/landscape layouts, viewer navigation, stale editors/pairs and foreground restoration.                                                                                                                                                         |

Run `npm run verify`, relevant browser suites, the mixed-library resource check,
production dependency audit, Compose validation/build and media verification
when processing dependencies change. Exercise both read-only and writable Docker
mounts using disposable roots on separate filesystems. Actual macOS and installed
iPhone acceptance are required in addition to Chrome phone emulation.

Update the repository guide, architecture, security, data management,
configuration, installation, development, release checklist, user guide,
embedded guide and changelog alongside the relevant implementation stage.
Document limits, Trash storage/retention, backup coverage and maintenance guards.
Keep current product docs accurate until the feature ships. Review the final
diff for path/secret exposure and temporary artifacts; stop test servers and
remove owned fixtures after verification.

## Design References

- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html): layered content validation, access control, bounded uploads and private storage.
- [Node 24 filesystem API](https://nodejs.org/docs/latest-v24.x/api/fs.html): copy operations are not atomic, default copy can overwrite, and filesystem operations need explicit error handling.
- [SQLite atomic commit](https://www.sqlite.org/atomiccommit.html): database transactions protect database changes; file publication needs its own durable recovery protocol.
- [tus resumable upload protocol](https://tus.io/protocols/resumable-upload), [Node server](https://github.com/tus/tus-node-server) and [browser client](https://github.com/tus/tus-js-client): acknowledged offsets and resumable transfer; authentication remains an application responsibility.
- [MDN page visibility](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event): mobile exit can be the last observable page event.
- [Apple Photos deletion and recovery](https://support.apple.com/guide/photos/delete-photos-videos-recover-deleted-pht3bfab2f96/mac): recoverable deletion with a visible 30-day retention period.
- [Radix AlertDialog](https://www.radix-ui.com/primitives/docs/components/alert-dialog): accessible destructive confirmation, consistent with the existing UI primitives.
