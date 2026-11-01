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

### Surfaces And Navigation

Keep management separate from View options, which continues to control filtering,
sorting and presentation. Extend the existing interface rather than adding a
file-manager mode or controls over every thumbnail.

| Surface         | Presentation and actions                                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gallery toolbar | Keep search and controls on one row. Add media sits beside Select and View options; on narrow screens it can be a named icon button. Keep an Add media action in the empty-library state.                                                                                 |
| Gallery card    | Extend the existing right-click/long-press menu with Move to… and Move to Trash. Keep Info, Edit media and Download. Do not restore hover buttons.                                                                                                                        |
| Selection       | Replace the large persistent batch editor with a compact strip: count, Move to…, Edit details, Trash and Done. Edit details opens the existing score/favorite/tag controls. Selection checkboxes appear only in selection mode; Select loaded retains its explicit scope. |
| Media viewer    | Introduce More for Edit media, Download, Move to… and Move to Trash; retain View options, Info and Close directly. Keep controls visible while a menu or action is open. Feed uses these viewer actions; its rail and comparison voting cards gain no management icons.   |
| Folder tree     | Keep navigation and expansion behavior. Provide New folder and Move to… in the relevant folder menu, with a visible actions button for the selected folder. Assigned roots cannot move; folder deletion is excluded.                                                      |
| Sidebar         | Add Trash beside the library destinations and Activity as the single entry for transfers and operation results. Trash is a page, not another Gallery/Feed/Compare layout.                                                                                                 |

Long press is a shortcut, not the only way to manage an item: Gallery selection,
the viewer's visible More button and selected-folder actions expose the same
commands. Cancel long press when scrolling starts and preserve the existing
score-hold interaction. Put destructive commands last, separated from ordinary
actions. Hide irrelevant commands in context menus; visible pickers explain
unavailable destinations. These choices follow
[Apple's context-menu guidance](https://developer.apple.com/design/human-interface-guidelines/context-menus).

Read-only installations retain browsing and downloads. Add media remains
discoverable but explains when no writable destination is configured; point to
the operator configuration rather than offering to edit server paths in the
browser. In a mixed selection, identify ineligible items and allow proceeding
with the eligible subset explicitly; never silently omit files. A temporarily
reserved item explains that another operation must finish first.

Keep Library query, selection and scroll restoration separate from Trash state.
Changing a library query clears selection with an announcement. When a successful
move removes a card from the current query, retain the nearest surviving scroll
anchor; an open viewer keeps the moved asset by its stable ID and refreshed
location. Trash advances the viewer to a surviving neighbor, or closes it if none
remains. Failed items remain selected only while that selection context is
unchanged; otherwise their results stay in Activity. Do not reset the entire
library or steal focus when another device completes work.

### Shared Destination Picker

Use one folder browser for Add, Move, Restore to… and New folder. Present it as
an approximately 520 px desktop Dialog and a full-height phone Sheet, using the
existing compact-layout breakpoint. Show the action and item count, named root
and relative breadcrumb, one level of folder rows, and a sticky footer. Tapping
a row enters that folder; the currently displayed folder is the destination.
Use Move here or Restore here to submit that operation, alongside Cancel. When
changing an upload destination, Use folder only updates the upload review; Add
files remains its single submission action. Do not combine row navigation with
destination radio buttons or a second folder tree.

Back navigates within the picker; Cancel dismisses the task. At a root, offer
only other assigned roots, never an operating-system parent. Read-only,
disconnected and prohibited destinations show a short reason and cannot be
submitted. A moving folder and its descendants are ineligible. Keep New folder
as one inline name field with Create and Cancel, with validation beside it;
do not stack another dialog. Recheck permission and availability on submission.

The full-height phone presentation gives a deep hierarchy enough space, following
[Apple's guidance on scoped sheets](https://developer.apple.com/design/human-interface-guidelines/sheets).
Use the existing Radix-backed Dialog/Sheet primitives; this feature does not
require a new drawer dependency, a primitive migration or custom swipe gestures.

### Add Media

Use the native multi-file picker on desktop and phones; desktop drag-and-drop
opens the same review flow in Activity. Show filenames, sizes, selected count,
total size, destination and one Add files action before uploading. Default to the
current folder only when writable; otherwise ask for a destination. Changing it
uses the shared picker, preserving the review without stacking modal layers.
Allow removing files and adding more before submission. Show the actual configured
limits and actionable validation near affected rows; reject folder drops with
an explanation rather than silently ignoring their contents.

Keep the growing upload list in Activity rather than a small modal. This follows
[Carbon's uploader guidance](https://carbondesignsystem.com/components/file-uploader/usage/)
on multi-file lists, progress and file-specific errors. Transfer starts only after
Add files; success requires server acknowledgement of publication and indexing.
Closing Activity preserves the unsubmitted review within the current tab;
Discard releases it. A reload requires selecting those unsubmitted files again.
After acceptance, closing Activity leaves work intact. Navigation must not
unmount transfers. Use the same name-conflict choices as Move; never overwrite
an existing file or treat a skipped upload as Added.

Copy the bytes supplied by the device picker without modifying or deleting the
device's copy. Test iPhone Photos and Files separately: the operating system may
provide a converted file, and the app cannot promise access to the camera
original. HEIC, MOV and animated formats use the existing media inspection path.
Live Photo pairs are separate files, not a new combined asset type.

### Move Media

Use the shared picker and keep the filename. Move here submits the operation
without another confirmation; report its progress in Activity. Moving into the
current folder is a no-op. For known name conflicts, replace the picker body with
a concise review: filename, destination and Skip or Keep both; default to Skip.
Show the proposed suffixed name. Apply to remaining conflicts is available only
for that batch. Never offer replacement or merge. Conflicts discovered during
execution become Needs attention in Activity, rather than opening a surprise
dialog over the current view. Retry only unsuccessful items.

### Move Folders

Add a Move to action to the folder context menu, including long press, and an
accessible actions button for the selected folder. Reuse the media destination picker;
the initial interface moves one folder at a time. Folder drag-and-drop and
folder deletion remain outside this delivery.

Move the whole folder, including nested and empty folders, hidden regular files
and sidecars that Aether does not index. Show its destination, item count and
total size before starting; show Checking folder while inventory is incomplete,
rather than a misleading zero count. Explain that unindexed contents move too.
A name conflict offers Skip or Keep both for the
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

Use a dedicated Trash page with a simple selectable list: static thumbnail, name,
original relative folder, deletion date, remaining days and retained size. On
phones, combine secondary details under the filename instead of shrinking a
desktop table. Show the 30-day retention policy once above the list. Keep
presentation controls, scores and automatic playback out of Trash. Scope its
search to Trash without changing the saved Library query.

Provide Restore and Delete permanently for one or more items, plus Empty Trash
with a separate destructive confirmation showing the affected count and that
recovery will be unavailable. Empty Trash applies to all retained items, including
those hidden by search; state that scope in the confirmation. Unavailable items
remain recorded and report their failure. Restore uses the original folder when available;
otherwise offer Restore to… through the shared picker. An occupied location offers
Skip, Keep both or another destination, never replacement. Show the current
destination when the original folder has moved. Distinguish empty Trash, no search
matches and unavailable drives; unavailable files are not an empty Trash.

Trash does not free the file's disk space. Display the retained size. Purge
expired items only after verifying their ownership and identity; unavailable
drives wait until available. A restore accepted before expiry claims the item
against concurrent purge. Missing or unrecognized files require attention rather
than automatic removal of their recovery records.

### Activity And Feedback

Use a dismissible, non-modal side panel on desktop and a full-height Sheet on
phones. Keep one queue with active and recent results; no separate upload dashboard.
Show a count on Activity only for running work or items needing attention. Closing
the panel is not cancellation. A small summary may offer View activity; avoid
per-file notifications and persistent status overlays on media cards.

| State                         | Presentation and action                                                                                                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queued                        | Filename and destination; Cancel before work starts.                                                                                                                                                                          |
| Uploading / Moving            | Byte progress when measurable, with count and current phase; Pause/Resume only for device upload transfer. Cancel stops only safely cancellable work; after partial commit use Stop remaining.                                |
| Checking / Adding / Finishing | Plain phase text and indeterminate progress where the total is unknown; do not imply that 100% transferred means complete.                                                                                                    |
| Paused                        | Explain Offline, Sign in to continue or Select the same file to resume, with the corresponding action. Accepted server work may continue while the client reconnects.                                                         |
| Needs attention               | File-specific reason and a relevant action, such as Choose destination, Keep both, Select file or Retry. Preserve successful siblings. Unknown outcomes show Checking status and reconcile the original request before retry. |
| Complete                      | Confirm Added, Moved, Restored or Moved to Trash only after acknowledgement; one batch summary with Undo for Trash. Results remain reachable after the notification disappears.                                               |

Use neutral text for normal phases, the existing accent for progress and primary
actions, and destructive styling for permanent deletion. Pair color with text and
icons. Do not show estimated time until measured throughput supports it. Explain
iPhone interruption only when relevant: incomplete transfers may pause when the
app leaves the foreground; return to resume. Do not promise background upload.

### Layout And Accessibility Acceptance

Reuse existing Button, ContextMenu/DropdownMenu, Dialog/Sheet, AlertDialog,
Progress and notification primitives, theme tokens, radii and motion. Keep body
and menu text at the existing 14 px scale, secondary metadata at 12–13 px and
dialog headings at 18 px. Phone text inputs remain at least 16 px. Use the
existing 8/12/16/24 px spacing rhythm; the new feature does not introduce a theme.

Use at least 44 × 44 CSS px touch targets, with folder rows around 48 px. This is
the chosen touch design target, consistent with
[WCAG's enhanced target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html),
not a claim that every WCAG AA control requires 44 px. Keep sticky actions above
the bottom safe area, with matching scroll-content padding. Account for the top
safe area, dynamic viewport, landscape and software keyboard. At 320 px, search
can shrink and actions become named icons; essential actions must not clip.
The selection strip must not cover the last row or remain above an open Sheet.

Follow the [WAI modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/):
give each dialog a title, move focus into it, contain focus while modal, support
Escape and restore focus to its invoker or a surviving neighbor. Close a menu or
mobile sidebar before opening another modal; preserve the pending action through
that transition. A non-modal desktop Activity panel must not trap focus or mark
the library inert. Keep destructive confirmations focused initially on Cancel.

Retain existing tree keyboard navigation and keyboard-layer guards. Enter/Space
activates folder rows; ContextMenu/Shift+F10 opens item commands. Announce batch
starts, failures and completion politely without moving focus or reading every
chunk, following [WCAG status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
Keep filenames fully accessible when visually truncated, associate inline errors
with their fields and honor reduced motion. Verify keyboard and VoiceOver as well
as desktop and actual installed iPhone layouts during implementation.

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
After a known result, changing the destination or collision choice starts a new
request for the affected items; it never changes an unresolved request's input.

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

| Area                         | Extend                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write policy and startup     | `apps/server/src/config/config.ts`, `http/app.ts`, private configuration examples, Compose and runtime drain order.                                                  |
| Operation feature            | Focused routes, schemas, repository and filesystem modules under `apps/server/src/library`; reuse the repository facade and descriptor validation.                   |
| Lifecycle and reconciliation | `db/database.ts`, `library/asset-query.ts`, repository folder/scan/ranking/comparison modules, `scanner.ts`, watcher coordination and direct media resolution.       |
| Cache and maintenance        | Existing derivative/presentation cache cleanup, `maintenance` backup/restore/data commands and startup recovery.                                                     |
| Browser                      | `api/client.ts`, AppShell feature hook, GalleryCardActions, BatchActionsBar, folder actions, destination picker, viewer More menu, sidebar Trash and Activity panel. |
| Existing state               | Library tree/list refresh, selection, viewer anchors, scroll restoration, random order, comparison generation/resume and unauthorized handling.                      |

Server paths after a listed application root are relative to its `src` directory.
Do not move unrelated modules or rename existing components to deliver this work.

## Verification And Completion

| Coverage                | Required cases                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization and paths | Default read-only behavior; configured root capabilities; auth/CSRF on all upload methods; traversal, symlink/parent swaps, hard links, reserved names, Unicode/case collisions and concurrent destination creation.                                                                                                                                                                                                         |
| Files and recovery      | Fault injection before/after each durable phase; same/cross-drive moves; source replacement; disk full; quota races; permission loss; disconnected drives; crash/restart; process shutdown; unknown files; cancellation; partial batches and request-ID replay.                                                                                                                                                              |
| Folder moves            | Protected-root source rejection; valid root destinations; same-parent no-op; self/descendant rejection; no merging; stable folder/asset IDs and recreated paths; empty/hidden/sidecar entries; unsupported metadata/symlinks/mounts; bounded inventories; concurrent changes and crash recovery; search/counts and open-folder restoration; restoring Trash after its original folder moves.                                 |
| Metadata and media      | Stable IDs with duplicate content; annotations, frames/highlights, manual scores and history across move/restore; active-only ranking and direct access; invalidated derivatives; stale generator publication; watcher/scan races and repeated cleanup.                                                                                                                                                                      |
| Uploads                 | Partial/duplicate/out-of-order chunks; offset/checksum errors; spoofed type/length; unsupported media; HEIC/MOV/animation inspection; oversized input; inactivity expiry; reselected changed file; browser close; login expiry and bounded memory/disk.                                                                                                                                                                      |
| Maintenance             | Fresh/upgrade schemas; old backups; paused work/Trash guards; no historical operation replay; unavailable Trash payloads; root removal; backup/source separation and rebuild/wipe data safety.                                                                                                                                                                                                                               |
| Interface               | Visible alternatives to context menus; single/batch operations; mixed eligibility; folder navigation and inline creation; name conflicts; retry of failed items only; Activity after close; read-only/offline/empty states; independent Trash search; dialog/selection-bar focus; keyboard/VoiceOver; 320 px, landscape, safe areas and software keyboard; viewer neighbors, stale editors/pairs and foreground restoration. |

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
