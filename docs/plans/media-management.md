# Media Management Plan

Status: Implementation complete; native macOS and device acceptance pending.\
Reviewed: 2026-11-07.

## Outcome And Scope

Add media from a phone or computer, create folders, rename media and folders,
move them within or between assigned roots, and delete media to a recoverable
Trash. Single-item and selected-item actions use the same server operations.
Renames, moves and restores retain asset IDs, tags,
favorites, presentation settings and comparison history.

This extends the current source-read-only product boundary. Enable writes
explicitly for named media roots; existing installations remain read-only.
Presentation editing continues to change metadata rather than source bytes.

Included: device uploads, folder creation, single-item media and folder rename,
same-drive and cross-drive media and folder moves, Trash, restore, permanent deletion from Trash, progress,
cancellation and recovery. Existing external file copying and scanning
remain supported. Excluded: arbitrary server-path imports, URL imports, archives,
folder uploads, folder deletion, source transcoding, cloud sync,
public uploads and device photo-library synchronization.

## Delivery Tracker

| Stage | Deliverable                         | State                 | Completion requirement                                                                                                                                       |
| ----- | ----------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F0    | Filesystem and upload proofs        | Verified on Linux     | Demonstrate safe file/subtree publication, metadata preservation, recovery and resumable uploads before choosing dependencies.                               |
| F1    | Write policy and durable operations | Verified on Linux     | Root capabilities, path safety, schema, scanner coordination, startup recovery and maintenance guards pass fault tests.                                      |
| F2    | Create, rename and move             | Verified on Linux     | Create folders and rename media/folders; complete same-drive and cross-drive moves with stable IDs, collision handling, recovery and stable Gallery updates. |
| F3    | Trash and restore                   | Verified on Linux     | Active visibility, ranking, restore, retention, purge and maintenance behavior pass recovery tests.                                                          |
| F4    | Add media                           | Verified on Linux     | Secure resumable uploads publish complete files and index them through the shared operation path.                                                            |
| F5    | Release acceptance                  | Device checks pending | Desktop, actual iPhone PWA, container, security, failure, cleanup and documentation checks pass.                                                             |

The mutation implementation supports Linux and macOS through descriptor-based
native operations and a successful per-volume no-replacement probe. Other
platforms retain read-only browsing and metadata editing. Linux acceptance is
recorded below; native macOS and external-volume acceptance remain separate
release checks.
Filesystem proofs cover actual cross-device copies, whole-tree metadata,
collisions, source/parent replacement, quarantine and recovery. The maintained
tus adapter passes authenticated creation, offsets, resume-prefix verification,
CSRF, termination and unchanged-byte publication checks. Platform support is a
capability boundary, not an unchecked rename fallback. Full verification,
browser acceptance and real-device checks still govern release readiness.

Automated acceptance passed on Linux: repository verification, Chrome desktop
and phone browser suites, both 1,024-item mixed-library resource checks,
production dependency audit, Compose validation/build, media-decoder verification
and disposable container tests for read-only/writable roots and cross-drive
moves/restores. Browser resource reports distinguish JavaScript heap from
aggregate browser-process RSS; they do not establish an actual iPhone memory
budget. Actual macOS and installed iPhone acceptance has not been performed.
F5 remains open for those device checks.

Implement in this order. Each stage includes its API, minimal working UI,
regressions and affected documentation. Update this tracker when a stage changes
state; keep supporting detail here rather than creating a document per task.
Revise read-only claims before the first file-management action ships, with the
guide instructions delivered alongside each action. F5 verifies consistency;
it is not the first documentation pass.

## User Experience

### Surfaces And Navigation

Keep management separate from View options, which continues to control filtering,
sorting and presentation. Extend the existing interface rather than adding a
file-manager mode or controls over every thumbnail.

| Surface         | Presentation and actions                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gallery toolbar | Keep search and controls on one row. Place view switching at the far right after a vertical separator. Show Add media only in Gallery, beside Select and View options; use a named icon button on narrow screens. Keep Add media in the Gallery empty state.                                                                                                                              |
| Gallery card    | Extend the existing right-click/long-press menu with Rename…, Move to… and Move to Trash. Keep Info, Edit media and Download. Do not restore hover buttons.                                                                                                                                                                                                                               |
| Selection       | Replace the large persistent batch editor with a compact strip: count, Move to…, Edit details, Trash and Done. Edit details separates Score and Tags into tabs with bottom-right Cancel and Apply actions. Selection checkboxes appear only in selection mode; Select loaded retains its explicit scope.                                                                                  |
| Media viewer    | Introduce More for Edit media, Download, Rename…, Move to… and Move to Trash; retain View options, Info and Close directly. Keep controls visible while a menu or action is open. Feed uses these viewer actions; its rail and comparison voting cards gain no management icons.                                                                                                          |
| Folder tree     | Keep navigation and expansion behavior. Provide New folder, Rename… and Move to… in the relevant folder menu, with a visible actions button for the selected folder. Assigned roots allow child creation but cannot be renamed or moved; folder deletion is excluded.                                                                                                                     |
| Sidebar         | Use one Account card at the bottom of the sidebar. Its menu contains Trash, Activity, User guide, Settings and Sign out, following [shadcn’s sidebar account menu](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/blocks/sidebar-07/components/nav-user.tsx). Show a count on Account for running work or items needing attention. Trash remains a separate page. |

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
Apply the timing and reconciliation rules in
[Gallery updates and stable editing](#gallery-updates-and-stable-editing).

### Selection And Edit Details

Keep the selection strip to one row on desktop and two rows on phones, above the
bottom safe area. Show a corner checkbox on every card in selection mode and a
thin accent border on selected cards; keep unselected previews legible. The whole
card toggles selection instead of opening the viewer or changing its score.
Retain Select loaded, Clear and Done; selecting loaded items must not include
unloaded results or automatically select items loaded later. For exactly one
selected media item, offer Rename… in More; omit it for a multi-item selection.

Edit details opens a Dialog on desktop and a Sheet on phones. Keep one title and
the selected count in the header, followed by the existing shared Tabs with two
labels: Score and Tags. Start on Score for each new editor session. Show only
the active panel, including on desktop; do not put the two editors in columns or
repeat the tab name as a panel heading. Keep favorites with Score.

| Tab   | Controls                                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------- |
| Score | Always-visible shared score control and favorite control. Remove the Change score checkbox and its explanation. |
| Tags  | Add to existing, Replace existing, tag entry and suggestions, and Clear tags.                                   |

Use one stable footer for both panels. Group Cancel, then Apply, at the bottom
right, with the existing outline and primary Button variants. Keep the same order
and alignment on phones; two buttons fit at 320 px without a full-width stack.
The body scrolls when necessary while tabs and footer remain available. Reserve
space above the bottom safe area and software keyboard; do not overlay fields
or add Apply buttons beside individual controls. Match the existing media editor's
footer appearance without adding its Reset action.

Remove the score opt-in without changing untouched scores. Initialize the score
from the selection when every item has the same value; show Mixed when values
differ. Extend `MediaScoreControl`'s editor mode for a mixed readout and numeric
entry instead of building a second score widget. Mixed represents an unset
numeric draft, not zero or the first item's score. Direct entry chooses an
absolute value; step buttons operate once a numeric value is available. Track
score edits separately from the displayed initial value and include `score` in
the request only after an intentional change. Opening the editor, switching tabs,
or changing only favorites or tags must omit it. An explicit zero remains valid
and means unranked; invalid, negative and noninteger drafts block Score Apply.
An untouched Mixed score is unset, not invalid, and permits favorite-only Apply.
Favorites also need uniform-on, uniform-off and mixed baselines, so choosing
either on or off from a mixed selection is an intentional update.

Keep independent drafts, validation and save feedback for the two tabs. Switching
tabs neither saves nor clears a draft. Store drafts above tab panels so unmounting
inactive content cannot lose them. Tag changes, including Clear tags, remain
staged until Apply; clearing then uses the existing destructive confirmation.
An invalid or unchanged inactive draft does not block applying the active tab.

Apply submits only the active tab: Score uses the existing atomic score/favorite
batch write; Tags uses the existing atomic tag batch write. Do not combine these
requests or imply they commit together. Disable Apply when the active draft has
no valid changes or a save is pending. After server acknowledgement, use returned
asset records for Score and hydrate affected records after Tags, whose current
response contains tags and an updated count. Patch displayed values without
reordering or removing selected cards; defer query reconciliation as described
below. Update only the submitted tab's
baseline and keep the editor open so the other tab's draft remains available.
Show one shared success toast naming the submitted change and affected count.
Keep validation and save failures beside the active field or footer, with the
draft intact and no duplicate error toast. Reconcile an unknown result before retry.
Cancel closes the editor and discards all unsaved drafts, retaining earlier
applied changes and the Gallery selection. Escape and the close control follow
Cancel. Freeze editing, tab changes and dismissal during a pending save; do not
present Cancel as reversing a request already sent to the server.

Key drafts by the selected asset IDs and editor/query context, not just the count
or favorite summary. Snapshot the IDs, active tab and submitted values for each
request. A selection change, including a different set with the same count,
invalidates the old editor context. Late results must not reset a newer draft or
close another editor. Guard repeated Apply synchronously as well as visually.

Use the [WAI tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) through
the existing [Radix-backed Tabs](https://www.radix-ui.com/primitives/docs/components/tabs):
named tab panels, active-tab state, arrow/Home/End navigation and Tab into the
active fields. Both panels are local, so automatic activation can remain enabled.
Inactive controls leave the keyboard and accessibility paths. Enter submits only
the active form, and editor controls retain the existing keyboard-layer guards.
The persistent footer follows [Carbon's modal structure and action ordering](https://www.carbondesignsystem.com/building-blocks/core/components/modal/guidelines);
its bottom-right grouping and tab-specific Apply scope are Aether's product
choices, retaining the existing components and separate mutation contracts.

Extend `BatchActionsBar`, `batch-curation-model.ts` and `useBatchSelection.ts` for
the tab drafts and untouched-field rules. Reuse the shared score/favorite controls,
Tabs, Dialog/Sheet and Button primitives, and the media editor's draft/footer
patterns. Match typography, spacing, borders, radii, icons, focus treatment and
motion through the shared tokens. Check light/dark themes, desktop, 320 px phones,
coarse-pointer landscape, zoom and keyboard-open layouts without clipping.

### Gallery Updates And Stable Editing

Separate record updates from changes to result order and membership. Patch
acknowledged scores, favorites, tags, names and locations by stable ID across
the Gallery, viewer and open detail surfaces. Retain the existing score-hold
preview and per-asset mutation queue: holding previews locally and commits on
release; repeated requests preserve the latest intended value. A save must not
rebuild the grid, replace thumbnails with skeletons or move its control between
successive taps, key presses or holds.

For score, favorite or tag changes that affect the current query, keep the
displayed result order and membership until the user chooses **Update results**
or changes the query. This applies to direct card controls, viewer annotations
and Edit details. Update the value immediately, even when it no longer matches
the current filter. Show one compact Update results action in the existing
Gallery toolbar while reconciliation is pending; reserve its space to avoid
moving adjacent controls. Do not add a toast, modal, repeated subtitle or a
refresh action on every card. The pending action explains the temporary result
snapshot; the result count updates with the accepted replacement results. While
pending, show the loaded count as "80 shown" rather than presenting an outdated
total as current. Announce the transition to pending once, without moving focus;
these are saved edits awaiting updated results, not unsaved changes.

Do not automatically reorder after a save response, an idle timeout, pointer
release, editor close or selection Done. This keeps a touch user free to pause
and increase the same score again. Update results becomes available after writes
settle and the open editor/menu and selection task finish. Keep it keyboard
reachable, with a concise accessible reason when unavailable. Applying either
Edit details tab leaves both the selection and other tab's draft intact.
An explicit folder, search, filter, sort or view change establishes fresh results
and clears the old pending state; preserve the random seed unless the user asks
to reshuffle. Foreground and watcher refreshes use the same policy while the
current Gallery context remains active.

Only defer reconciliation when a changed field can affect the current result.
Tags currently affect filtering, not sorting; do not introduce a tag-sort mode
to solve this problem.

| Change                             | Effect on the current Gallery                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Score or favorite                  | Patch the returned record immediately. Offer Update results for score sorting, including favorite tie-breaks, or an affected ranked/unranked/favorites filter. Other sorts retain their visible order without an Update results prompt solely for a score change.                                                     |
| Tags                               | Patch acknowledged tags after bounded record hydration. Offer Update results when an active tag filter can change membership. An unfiltered Gallery keeps its order.                                                                                                                                                  |
| Media rename                       | After commit, patch the name and search fields by the same card ID. Offer Update results for affected filename order, date-order name tie-breaks or search membership; retain unrelated order.                                                                                                                        |
| Media or folder move               | Apply only committed moves. An item moved within the selected recursive folder scope retains its slot; moving outside removes it at the next safe boundary after commit. Patch paths, counts, tree and breadcrumbs without navigating to the destination; affected search/filter membership waits for Update results. |
| Folder creation or rename          | Insert or patch the committed folder by ID. Preserve the active folder, expanded ancestors and breadcrumb context; a created empty folder does not reset the media grid. Folder rename also updates descendant paths and offers Update results for affected path search.                                              |
| Add or restore                     | Only fully committed assets become eligible for ordinary media access. Offer Update results once per completed batch for matching additions; do not guess their rank within a partially loaded result or scroll to the first new item.                                                                                |
| Move to Trash or confirmed removal | Disable ordinary media actions immediately; remove the committed subset at the next safe boundary. Preserve failed items and unrelated result order; never leave a deleted source interactive to keep the layout stable.                                                                                              |

Apply confirmed structural removals at the next safe interaction boundary after
acknowledgement; closing a task before it finishes must not suppress its eventual
update. Do not interrupt another press, editor or selection task. A queued job,
transfer percentage or cancellation request is not a committed change. Coalesce
affected tree/list reads for a batch; do not reload once per file. Preserve any
pending score/tag Update results state
when applying structural changes: remove unavailable IDs and merge committed
changes without silently resorting all other cards. If a full query replacement
is needed, keep that replacement behind Update results. Partial operations apply
only successful records and retain failures in the existing selection/Activity
context.

Changes from another device, a scan or a watcher must not replace the grid during
a press/hold, keyboard edit, open menu/dialog or selection task. Patch known
record values without overwriting unsaved drafts. If a source is confirmed removed
or trashed, disable its actions immediately; retain a noninteractive placeholder
only until
the active interaction can finish, then remove it safely. Never restore a trashed
record from a delayed response. Temporary drive outages show unavailable media
without mass removals; an unavailable drive is not an empty folder. Keep remote
additions and ordering changes behind the same single
Update results action.

On reconciliation, preserve the loaded depth and an unaffected visible card's
ID and pixel offset. If it has left, choose the next surviving neighbor in the
previous order, then the previous one. Do not follow an edited card to its new
rank or jump to the top. Restore focus to the same surviving control by ID;
if its card leaves the viewport/results, use the nearest visible logical
neighbor or the toolbar without scrolling to a distant rank. Account for
virtualized rows unmounting cards. Keep a moved viewer item open by stable ID
with its new location; Previous/Next use the last accepted result order until
reconciliation. Retain its former neighbor IDs if a move removes it from that
list, so navigation still reaches a surviving neighbor rather than using a missing
index. After reconciliation, use surviving former neighbors or show the end of
the results when the open item remains outside the query. Trash advances to the
next surviving item, then the previous,
or closes an empty viewer. Keep transitions restrained and respect reduced motion.

Make ordered reads consistent with writes. Extend the planned library mutation
revision to cover metadata, indexing and file-operation commits. Return committed
revisions with mutation acknowledgements, and list records, total and revision
from one consistent database read. Reject an older
same-query response after a newer mutation acknowledgement, not only after a
query change. Guard tree reads and record hydration as well as the list. A
multi-page refresh must use one revision; retry a bounded number of times if it
changes, retaining the usable grid and pending action if updates continue.
When a known change affects no current sort/filter dependency, quietly revalidate
the loaded window before appending at a newer revision; do not replace its order
or prompt solely for unrelated metadata. Unexpected differences use Update results.

The current server uses offset pagination. While order/membership is pending,
pause both automatic append and Load more, with Update results as the route to
continue. Replace the paging action with the same Update results command while
pending, so it remains reachable after a long scroll and on phones. Do not append
a new offset page to the frozen old order or sort only loaded cards: ID
deduplication cannot recover skipped records. Even a locally applied structural
removal invalidates the old paging window until reconciliation. Update results
refetches the loaded window at one revision using the server's canonical filters
and tie-breaks, then replaces ordered IDs/count together and resumes pagination.
Abort or reject obsolete refresh/append responses, including responses from
before a structural operation. New writes during refresh keep it pending rather
than allowing a stale replacement to win. Announce the completed update once
through the existing results status, without a routine toast or focus change.
If removals empty the loaded window, keep Update results and selection Done/Cancel
reachable. Do not claim that the library or query is empty until an authoritative
refresh confirms it.

A failed refresh retains acknowledged edits and the last usable results. Offer
Retry through Update results; do not report the save as failed or submit it
again. A query change discards only obsolete reads and pending layout state,
never an accepted write. Flush existing mutation/checkpoint lifecycle handling
on visibility changes and pagehide; do not depend on a debounce firing before
phone suspension. On return, revalidate source availability and saved IDs while
preserving the active context and pending update policy. Clear private pending
state on explicit logout and reject callbacks from an older session.

Deliver this behavior with the F2 interface work for existing score/tag controls
as well as rename/move; extend committed insertion/removal to F3 and F4. Reuse
the existing list, mutation queue and scroll-restoration helpers. Predictable
input and meaningful focus follow [WCAG on input](https://www.w3.org/WAI/WCAG22/Understanding/on-input.html)
and [focus order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html).
The explicit Update results policy is Aether's design choice; those criteria do
not prescribe a specific sorting policy or delay.

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

### Create Folders

Offer New folder in the selected folder's actions and in the shared destination
picker. Create one child in that folder; an assigned writable root is also a
valid parent. From the folder menu, use the existing Dialog/Sheet with a Folder
name field, Create and Cancel. In the picker, keep the existing inline field
instead of opening a second dialog. Display the parent by its relative breadcrumb,
retain the typed name after a failure and show validation beside the field.

Return the new folder record only after exclusive filesystem creation and the
database commit succeed. Insert it into the tree immediately and preserve its ID
through rescans, even while empty. Do not adopt an existing directory as a
successful creation. Reserve and verify the parent, journal intent and coordinate
with scans through the shared operation runner. Unknown results reconcile the
original request ID. Recovery may remove only a verified operation-created
directory that is still empty; never delete contents added by another process.

### Rename Media And Folders

Provide Rename… for one media item in the Gallery card menu, viewer More and
single-item selection More, and for one folder in its actions menu. Batch rename
is outside this delivery. Use the existing Dialog/Sheet with the current name,
one Name field, Save and Cancel; retain the draft on errors. For media, edit only
the filename stem and keep the original extension visible and fixed. Rename only
the selected media file, without renaming sidecars or changing file contents.
Folder rename changes the whole subtree, including unindexed contents, under the
same parent. Assigned root names remain operator configuration.

An identical name is a no-op. Reject a name collision without replacing a file
or merging folders; keep the form open for another name. Support case-only
renames only where F0 proves safe publication and recovery on that filesystem;
otherwise explain the limitation. Apply the shared name validation and recheck
write access, current source and parent versions when the operation starts.

Use the same durable operation and no-replacement guarantees as Move. Reserve
the old and new names, and the full subtree for folders. Preserve asset/folder
IDs, scores, favorites, tags, presentation settings and comparison history;
commit descendant locations and search fields together. Reuse the stable-folder-ID
work for Move rather than deriving new IDs from renamed paths. Recreating an old
name receives a new ID. Refresh names, breadcrumbs, search results and open views
from returned records, retaining the current folder/viewer by ID. Restore from
Trash follows a renamed folder's preserved ID, as it does after a folder move.

### Add Media

Use the native multi-file picker on desktop and phones; desktop drag-and-drop
opens the same Add media page. Show filenames, sizes, selected count,
total size, destination and one Add files action before uploading. Default to the
current folder only when writable; otherwise ask for a destination. Changing it
uses the shared picker, preserving the review without stacking modal layers.
Allow removing files and adding more before submission. Show the actual configured
limits and actionable validation near affected rows; reject folder drops with
an explanation rather than silently ignoring their contents.

Keep Add media as a page in the application shell, with a visually hidden task
heading for orientation, a compact destination row and a file-picker/drop area.
After selection, use a compact Choose more files control above the file summary
and list. Use one scrolling body and a persistent footer, with Cancel immediately
left of the primary Add files action. Cancel clears the unsubmitted selection
and returns to the library. Ordinary library or history navigation retains the draft
in memory within the current tab; a reload requires selecting the files again.
Cancel in the destination picker only abandons that folder change. Back to files
in conflict review returns to the selection, while Cancel closes the task.

Keep the growing transfer list in Activity. Follow
[Carbon's uploader guidance](https://www.carbondesignsystem.com/building-blocks/core/components/file-uploader/guidelines)
for multi-file lists, action hierarchy and file-specific errors. Keep a native
file-picker button alongside drag-and-drop, following
[WAI's dragging alternatives](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html).
Transfer starts only after Add files; success requires server acknowledgement
of publication and indexing. Add files returns to the library and opens Activity.
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
for that batch. Omit explicitly skipped items before admission and show the
included/skipped counts; an all-skipped review submits no work. Never offer
replacement or merge. Preview is advisory: publication rechecks names without
replacement. A newly occupied destination is reported in Activity rather than
opening a surprise dialog over the current view. A refusal before any filesystem
claim is a known failure; ambiguous claimed work needs recovery. Retry only
unsuccessful items.

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
Migration retains the existing path-derived folder IDs. Scanner discovery reuses
stored IDs by current location and allocates fresh IDs for new folders;
recreating an old path receives a new ID. Commit
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
Keep file selection and destination review on the Add media page. Activity has
one title and contains only accepted transfers and operation results.
Show a count on Activity only for running work or items needing attention. Closing
the panel is not cancellation. A shared summary toast may offer View activity; avoid
per-file notifications and persistent status overlays on media cards.

| State                                               | Presentation and action                                                                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queued                                              | Filename and destination; Cancel before work starts.                                                                                                                                                                          |
| Uploading / Moving                                  | Byte progress when measurable, with count and current phase; Pause/Resume only for device upload transfer. Cancel stops only safely cancellable work; after partial commit use Stop remaining.                                |
| Checking / Creating / Renaming / Adding / Finishing | Plain phase text and indeterminate progress where the total is unknown; do not imply that 100% transferred means complete.                                                                                                    |
| Paused                                              | Explain Offline, Sign in to continue or Select the same file to resume, with the corresponding action. Accepted server work may continue while the client reconnects.                                                         |
| Needs attention                                     | File-specific reason and a relevant action, such as Choose destination, Keep both, Select file or Retry. Preserve successful siblings. Unknown outcomes show Checking status and reconcile the original request before retry. |
| Complete                                            | Confirm Folder created, Renamed, Added, Moved, Restored or Moved to Trash only after acknowledgement; one batch toast with Undo for Trash. Results remain reachable after the notification disappears.                        |

Use neutral text for normal phases, the existing accent for progress and primary
actions, and destructive styling for permanent deletion. Pair color with text and
icons. Do not show estimated time until measured throughput supports it. Explain
iPhone interruption only when relevant: incomplete transfers may pause when the
app leaves the foreground; return to resume. Do not promise background upload.

### Toast Notifications

Reuse the existing Sonner notifications and `components/ui/sonner.tsx`, mounted
once by `App.tsx` at top center. Keep its theme, icons, close button and shared
dismissal behavior. Apply the repository's [notification rules](../engineering.md#notifications)
to these flows and existing event messages; no feature-specific toast host or
new notification framework is needed. Use a short result title, adding a
description only for a useful consequence or next step.

| Event                                                                                                           | Toast and retained feedback                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Folder created; media or folder renamed                                                                         | One success toast after acknowledgement: Folder created, Media renamed or Folder renamed. Name validation and collisions remain in the form.                                               |
| Score Apply                                                                                                     | One success summary naming the score/favorite changes and affected count. Keep the editor and the Tags draft open.                                                                         |
| Tags Apply or another explicit tag submission                                                                   | One success summary for added, replaced or cleared tags and the affected count. Keep unrelated drafts.                                                                                     |
| Presentation Save                                                                                               | One Media edits saved success toast after the acknowledged save; validation, conflicts and save failures remain in the editor footer.                                                      |
| Add media or Move completes                                                                                     | One success summary per operation/batch with the actual completed count; View activity can open its retained results. Uploading 100% is not completion.                                    |
| Move to Trash completes                                                                                         | One count summary with Undo, invoking the shared restore operation. Restore remains available in Trash after the toast disappears.                                                         |
| Restore, Delete permanently or Empty Trash completes                                                            | One acknowledged count summary. Permanent deletion retains its existing confirmation before execution.                                                                                     |
| Operation partly succeeds                                                                                       | A warning summary with completed/unsuccessful counts and View activity. Preserve successful items and actionable failures in Activity.                                                     |
| Accepted operation fails, or needs a decision while Activity is closed                                          | One error for a known failure, or warning for Needs attention, with View activity. Keep detailed reasons and recovery actions in Activity.                                                 |
| Transfer pauses or an outcome is unknown                                                                        | Keep Paused or Checking status in Activity. Use one informational/warning toast only when attention is needed outside the open task; do not announce a final result before reconciliation. |
| User-started scan finishes                                                                                      | Keep the existing success, warning and error variants. Routine watcher activity stays in library status; a background problem requiring action can notify once.                            |
| Library-data or per-item comparison reset completes                                                             | One success toast after acknowledgement, retaining confirmation and result scope. Keep correctable errors in the active reset dialog.                                                      |
| Quick score/favorite adjustment, comparison vote or ordinary Undo                                               | The changed control or comparison state is success feedback. A failed mutation uses one local error or a toast when no useful local recovery surface exists.                               |
| Sign-out fails                                                                                                  | Keep the existing error toast. Incorrect passwords and session expiry use persistent sign-in feedback; successful sign-in/sign-out need no toast.                                          |
| Selection, tab/view changes, Cancel, unchanged submission, appearance change, media loading or download handoff | No routine toast. Use selection state, controls, existing media notices or Activity; do not claim that a browser download has completed.                                                   |

Give each accepted operation or explicit save one notification owner. Extend the
existing status-formatting helpers and hooks rather than emitting from both the
component and AppShell. Derive deduplication from job/request identity and its
acknowledged result, not only a status string or effect rerun. Repeated polling,
idempotent retries, reconnects and foreground refresh must not repeat completion.
Coalesce work completed while hidden into a bounded foreground summary with
View activity, retaining individual results there. Do not replay historical
completions on every reload or emit per-file/chunk notifications.

Use success, warning, error and info variants according to the actual outcome;
pair their icons with text. Keep progress in the existing buttons and Activity,
with one final batch summary. An acknowledgement that is followed by a failed UI
refresh must not become a false save-failed message or trigger the mutation again.
Undo waits for the restore acknowledgement before announcing Restored. All toast
actions use current server checks and the same durable requests as ordinary UI
actions. Expired receipts or unavailable sources lead to Activity/Trash recovery.

Keep actionable results in Activity or Trash and preserve form errors until
resolved, so expiry of a toast never removes the only recovery route. Verify
that notifications remain visible and announced with Dialog/Sheet open,
including Edit details staying open after Apply, and that toast actions respect
the active focus layer. Announce a result once without moving focus; avoid
duplicating it across toast and panel live regions. Preserve safe areas,
readable wrapping, close/action targets, reduced motion and keyboard reachability.
Use the existing shared settings for brief messages; allow time to read and
activate Undo or View activity without relying on the toast as their only entry.

Scope pending notification work to the authenticated session. Dismiss private
queued/visible toasts on logout or session expiry, reject callbacks from the old
session and keep toast text out of persisted browser checkpoints. A 401 uses the
existing sign-in notice rather than also reporting every interrupted request as
a separate save or transfer error. Retain accepted server work for reconciliation
after sign-in.

During implementation, review `AppShell.tsx`'s duplicated media-update error
toast/inline rendering, its batch-status notifications and scan-state effect;
`app/useLibraryTree.ts`'s job identity; reset notifications; and the annotation
and presentation editor save paths. Resolve event ownership with the feature
changes. In particular, two distinct scans with the same terminal state must
remain distinguishable, while a repeated observation of one job must stay quiet.
Deliver shared event ownership, explicit-save toasts and duplicate-error cleanup
with the F2 interface work; extend the same policy to Trash/restore/purge in F3
and uploads in F4. F5 checks consistency across these and existing scan, reset,
annotation and sign-out flows.

This applies [Carbon's distinction between toast and inline feedback](https://www.carbondesignsystem.com/building-blocks/core/components/notification/guidelines)
and [WCAG status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
to Aether's existing toast implementation. The event matrix is an application
policy, not a requirement to toast every state change.

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

## User Guide And Product Copy

### Media Handling

The editor saves presentation metadata and generated playback files without
rewriting source contents. File management also creates, renames, uploads, moves
and deletes files. The guides describe those actions alongside their permissions
and recovery limits.

Remove the global "Your originals stay unchanged" callout and its shield styling
when file management ships. Replace it with a normal Media files topic explaining
which actions read files, which change their location, and which delete them.
Do not replace the callout with another safety slogan. Distinguish source-file
contents from location and lifecycle: preserving bytes does not mean a file
cannot move or be deleted.

The topic must cover these facts once, in plain language:

- Browsing, scans and thumbnail generation read assigned media folders. They do
  not move files or change their contents.
- Scores, favorites, tags, highlights and framing are stored separately. HEIC
  display copies and prepared playback are generated files; Download returns the
  stored source, without baking in presentation edits.
- File management is off by default and is enabled per assigned folder by the
  server operator. All signed-in devices share that access; it is not a per-user
  permission or a switch that the guide can enable.
- Add media creates files in the selected media folder. The device's copy is
  kept; a phone may supply a converted file through its picker.
- New folder creates an empty folder in the chosen parent. Rename changes a file
  or folder's name without changing its contents; media retains its extension.
- Move changes the file or folder's location. Move to Trash relocates media into
  Trash inside its assigned media folder. The file still occupies disk space.
- Trash retains files for 30 days unless they are permanently deleted sooner.
  Delete permanently, Empty Trash and retention cleanup remove those files.
  Unavailable drives must reconnect before deletion can finish. Explain restore
  conflicts in the restore instructions.
- Aether stores library records, settings and generated previews separately from
  source files. Added files and Trash use space in the assigned media folders;
  a move to another drive temporarily needs space on both drives. Keep storage
  paths, temporary-file layout and recovery internals in operator documentation.
- Aether database backups do not include source media or Trash payloads. Users
  need a separate media backup; Trash is recovery, not a backup. Library-data
  resets do not delete source files, but maintenance may require resolving
  unfinished operations and Trash first.

Use scoped statements such as "Playback and framing settings do not change the
source file." For destructive controls, describe the actual result: "Move these
items to Trash. You can restore them for 30 days." Permanent-deletion confirmation
must state that the files will be deleted and cannot be restored from Aether.
Keep complete policy details in Media files; show only the relevant consequence
beside an action.

### Guide Structure And Presentation

Maintain the embedded guide and `docs/user-guide.md` with matching topic order,
action names and limitations; identical prose is not required. Keep deployment
commands, filesystem internals and detailed codec limits in the existing operator
and architecture docs, linked only where needed. Do not add a documentation
framework or Markdown-rendering dependency for this change.

Regroup the existing six topics instead of appending tabs for every new feature:

| Topic        | Content                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Browse       | Sign in and scan, find media, choose a view, use playback/viewer controls and resume on iPhone.                                              |
| Edit media   | Open the editor, save or cancel, choose highlights/playback and adjust saved frames.                                                         |
| Rank media   | Compare pairs, Undo and understand comparison scores; keep score definitions here.                                                           |
| Manage media | Scores/favorites/tags and selection, Add media, create folders, rename/move media and folders, use Activity, restore and permanently delete. |
| Media files  | Read/write permissions, source files versus generated copies, storage, Trash retention and backup coverage.                                  |
| Help         | Common loading/save/transfer problems, relevant Settings/reset instructions and keyboard shortcuts.                                          |

Keep the existing one-panel-at-a-time navigation. Use the shared Tabs with short
labels and a responsive wrapped layout, not a growing strip of tabs or anchors
that scroll a long page. Allow another column arrangement on narrow phones before
shrinking labels or touch targets. Retain the selected topic by extending the
existing location-state mechanism, with validated topic IDs and explicit topic
links taking precedence; do not create a separate persistence system. Topic
restoration and explicit links are implemented and covered by location and browser
tests. Older saved locations without a topic and invalid values fall back to
Browse. Guide entry retains the library query, viewer item, ordered pair, Undo
and scroll context for return.

Use one User guide page title. Remove the introductory marketing subtitle,
numbered onboarding cards, shield callout and repeated icon tiles. Present tasks
as short headings, necessary prerequisites and numbered steps with the final
action and result. Use simple paragraphs or lists for explanations and one compact
shortcut list in Help. Do not add an introductory sentence that repeats its
heading, descriptions under every heading, feature-summary cards or decorative
icons. Keep warnings only where they affect a decision.

For example, Move media needs selection, Move to…, destination navigation and
Move here, followed by where to check progress. Explain conflicts in that task
and transfer recovery in Activity; do not repeat those explanations in every
topic. Use the exact labels in the shipped interface. Distinguish atomic score/
tag updates from file batches that can partly succeed. Instructions for disabled
file actions must explain the writable-folder requirement without exposing server
paths or implying that a browser permission prompt can grant server access.

Apply [Microsoft's procedure guidance](https://learn.microsoft.com/en-us/style-guide/procedures-instructions/writing-step-by-step-instructions)
and [Google's documentation style guidance](https://developers.google.com/style/highlights)
through the repository's [product-copy rules](../engineering.md#product-copy-and-user-documentation).
These rules also apply to dialogs, menus, empty states, notifications and settings.
Review the affected controls together: retain descriptions of consequences,
permissions, empty-result scope and recovery; remove subtitles that repeat labels
or promote the feature. Apply the same review to later UI work rather than bundling
an unrelated application-wide rewrite into this feature.

### Repository Audit And Delivery

The following locations contain existing claims or behavior that need review.
This is a delivery checklist, not a blanket replacement of "read-only" or
"unchanged": read-only defaults, scan behavior, presentation-only edits and
database-reset assurances remain valid with the correct scope. Preserve historical
changelog entries; add a new entry when behavior ships. Until then, current
product documentation must continue to describe the released behavior.

| Location                                                                                                                                                 | Required revision and timing                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/guide/UserGuidePage.tsx`, `docs/user-guide.md`                                                                                  | At F2, remove the global unchanged/no-move promise, regroup the guide and add Media files, folder creation, media/folder rename and move instructions. Document Edit details' Score/Tags tabs and active-tab Apply without a Change score step. Explain that saved values update immediately and Update results reapplies affected sorting/filters. Add Trash at F3 and uploads at F4. Scope Bounce, scan, download and batch assurances to their actions; update instructions for the viewer More menu. |
| `apps/web/src/styles/guide.css`, `tests/e2e/user-guide.spec.ts`                                                                                          | With the guide revision, remove obsolete callout/card styles, align compact layouts with the shared coarse-pointer/landscape breakpoint and test panel switching, topic restoration/links, keyboard focus and phone layouts. Verify reading order, 200% zoom, safe areas and no horizontal overflow.                                                                                                                                                                                                     |
| `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/app-location-state.ts` and its tests                                                    | With the guide revision, extend URL/resume state for validated topics and older saved locations, and preserve library context on guide entry and return. Cover explicit links, invalid topics, reload, unavailable storage and return to the viewer or ranking session.                                                                                                                                                                                                                                  |
| `README.md`                                                                                                                                              | At F2, replace the global no-source-modification statement with private indexing and explicitly enabled file management. At F4, describe authenticated device uploads without implying a public hosted service. Keep the read-only default deployment explicit.                                                                                                                                                                                                                                          |
| `AGENTS.md`, `CONTRIBUTING.md`, `docs/development.md`                                                                                                    | At F1, replace blanket source-read-only constraints with default read-only access and writes only through the authorized management operations. Keep destructive tests restricted to disposable media and preserve read-only scanners/processors.                                                                                                                                                                                                                                                        |
| `docs/architecture.md`                                                                                                                                   | At F1–F4, revise the read-only diagram, Data Directory and Deliberate Limits sections for capabilities, operation storage and lifecycle. Distinguish file management from excluded source-content rewriting.                                                                                                                                                                                                                                                                                             |
| `docs/security.md`, `SECURITY.md`                                                                                                                        | At F1, qualify deployment read-only claims and document explicit writable roots and shared access. Keep authentication, path boundaries and presentation processors' inability to write sources. Retain the vulnerability-reporting policy.                                                                                                                                                                                                                                                              |
| `docs/installation.md`, `docs/configuration.md`, private configuration examples, `docker-compose.yml`, `docs/release-checklist.md`                       | At F1, document the per-root write opt-in and explicit mount override; test both deployment modes. Keep default media mounts and the container root filesystem read-only.                                                                                                                                                                                                                                                                                                                                |
| `docs/data-management.md`, README maintenance instructions                                                                                               | At F1–F3, document original-file staging/Trash locations, operation metadata, backup exclusions and maintenance blockers. Preserve the guarantee that database maintenance does not delete originals.                                                                                                                                                                                                                                                                                                    |
| `apps/web/src/components/settings/DataResetSettingsSection.tsx`, `SettingsPage.tsx`                                                                      | Keep the reset's file-preservation explanation scoped to that reset; prefer a factual title such as "Source files are kept" over a general safety assurance. Keep "Read-only values" for status fields; it does not describe media permissions. Show write capabilities without adding a second configuration control.                                                                                                                                                                                   |
| `apps/web/src/components/LoginScreen.tsx`, `apps/web/src/components/app/scan-status.ts`                                                                  | With the copy revision, remove the sign-in slogan and secondary text that only repeats a status title. Keep session-expiry guidance, scan results and actionable failures. Apply the same rule to the generic Settings page subtitle.                                                                                                                                                                                                                                                                    |
| `apps/web/src/components/gallery/GalleryGrid.tsx`, `apps/web/src/components/feed/FeedPreview.tsx`, `apps/web/src/components/compare/LeaderboardView.tsx` | At F4, distinguish an empty library or folder from no search/filter matches. Offer Add media or scan guidance where relevant; explain the writable-folder requirement when needed. Keep minimum-item guidance for ranking.                                                                                                                                                                                                                                                                               |
| `docs/plans/media-experience.md`, `docs/README.md`, `CHANGELOG.md`                                                                                       | Scope presentation preservation claims where needed, update guide links/index descriptions and record the enabled file-management behavior alongside its release.                                                                                                                                                                                                                                                                                                                                        |

At F5, review rendered content and repository text together: no remaining global
promise that Aether cannot move/delete media, no unsupported feature described as
available, no duplicate policy callouts, and no instructions that disagree with
the action labels or confirmation scope. Verify read-only and writable guide
paths, correct partial-success feedback, and agreement between the embedded and
Markdown guide. Review UI copy alongside functional tests; do not use brittle
whole-paragraph snapshots as a substitute for checking meaning and behavior.

## Filesystem And Data Contracts

### Permissions And Destination Safety

Introduce a writable-root allowlist keyed by existing stable root names,
initially empty. A move requires both source and destination writes; uploads and
folder creation require destination writes. Rename requires write access to the
source root and parent. Trash and restore also check the relevant root's
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

Accept asset or folder IDs, destination/parent folder IDs, expected versions
and a validated basename. Reject empty names, traversal, absolute paths,
separators, control characters, reserved names and invalid or ambiguous
destination names. Creation and rename must reject names that become hidden or
excluded from scanning. Bound name length for the target filesystem; do not
silently trim or normalize the name. Respect filesystem case and Unicode
behavior. Do not trust the browser's MIME type or file size.
Resolve and verify source descriptors and destination parents under their roots.

F0 must prove publication without replacement and safe source retirement on
Linux, macOS and the filesystems used for deployment. A check followed by
ordinary rename is insufficient; copying directly to a visible final name is
also insufficient. Exercise parent/leaf replacement and symlink races. If a
small maintained native helper is needed for directory-relative operations,
review it before adoption. Unsupported filesystems remain read-only, without a
weaker fallback or claims of safety against hostile host writers.

### Durable Operations

Use one focused server feature for folder creation, rename, move, trash, restore, purge and upload
publication. Keep transport validation, filesystem execution and SQLite writes
in their existing layers. Do not add an external queue or general workflow
framework.

Append migrations for operation and per-item records, plus asset lifecycle and
Trash metadata. Keep lifecycle separate from existing inspection status.
Mutations carry opaque expected source/lifecycle versions, separate from
presentation revisions, so a stale selection cannot delete a replacement file.
Operation receipts survive asset purge. Store immutable request
identity, expected source or creation-parent revision/descriptor, intended destination, owned stage,
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
Retained rows use a reserved physical Trash path under the existing location
uniqueness constraint; original location and physical Trash identity are stored
separately. Root/folder
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

Explicit renames and moves update the existing asset ID, name/location/search fields and exact
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
surfaces under the [Gallery update policy](#gallery-updates-and-stable-editing).
Patch records immediately; an acknowledgement does not itself replace the
Gallery's ordered result window. Discard obsolete list/tree reads and prepared comparison pairs;
revalidate new votes and Undo against active assets while preserving receipts
for previously acknowledged requests. Preserve scroll depth and the current
anchor when possible. A moved item can remain open by stable ID even if
it leaves the current folder; Previous/Next use the last accepted result order,
excluding unavailable items, until reconciliation. Trashing
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

| Area                         | Extend                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write policy and startup     | `apps/server/src/config/config.ts`, `http/app.ts`, private configuration examples, Compose and runtime drain order.                                                                                                                                                                                                               |
| Operation feature            | Focused routes, schemas, repository and filesystem modules under `apps/server/src/library`; reuse the repository facade and descriptor validation.                                                                                                                                                                                |
| Lifecycle and reconciliation | `db/database.ts`, `library/asset-query.ts`, repository folder/scan/ranking/comparison modules, `scanner.ts`, watcher coordination and direct media resolution.                                                                                                                                                                    |
| Cache and maintenance        | Existing derivative/presentation cache cleanup, `maintenance` backup/restore/data commands and startup recovery.                                                                                                                                                                                                                  |
| Browser                      | `api/client.ts`, AppShell feature hook, GalleryCardActions, BatchActionsBar, shared score/favorite controls, folder create/rename actions, media rename dialog, destination picker, viewer More menu, sidebar Trash and Activity panel.                                                                                           |
| Edit details                 | `batch/BatchActionsBar.tsx`, `batch/batch-curation-model.ts` and tests, `batch/useBatchSelection.ts`, `MediaCurationControls.tsx`, `styles/batch-actions.css`, existing Tabs/Dialog/Sheet primitives and media-editor footer/draft patterns.                                                                                      |
| Notifications                | `App.tsx`, `components/ui/sonner.tsx`, AppShell event ownership, existing `app/scan-status.ts`/`app-helpers.ts` formatters, library job polling, settings resets, annotation/editor save paths and operation/Activity hooks.                                                                                                      |
| Gallery updates              | `assets/useAssetList.ts`, `media/useMediaActions.ts`, `media/asset-score-mutation-queue.ts`, `batch/useBatchSelection.ts`, `gallery/GalleryGrid.tsx`, AppShell refresh predicates, shared toolbar/paging controls and `scroll-restoration.ts`; server list/mutation revision contracts in repository modules and `api/client.ts`. |
| Existing state               | Library tree/list refresh, selection, viewer anchors, scroll restoration, random order, comparison generation/resume and unauthorized handling.                                                                                                                                                                                   |

Server paths after a listed application root are relative to its `src` directory.
Do not move unrelated modules or rename existing components to deliver this work.

## Verification And Completion

| Coverage                | Required cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization and paths | Default read-only behavior; configured root capabilities; auth/CSRF on all upload methods; traversal, symlink/parent swaps, hard links, reserved names, Unicode/case collisions and concurrent destination creation.                                                                                                                                                                                                                                                                                                                                                                                           |
| Files and recovery      | Fault injection before/after each durable phase; same/cross-drive moves; source replacement; disk full; quota races; permission loss; disconnected drives; crash/restart; process shutdown; unknown files; cancellation; partial batches and request-ID replay.                                                                                                                                                                                                                                                                                                                                                |
| Creation and rename     | Writable-parent validation; empty folders after rescan; exclusive creation and concurrent conflicts; preserved media extensions and sidecars; invalid/hidden names; identical-name no-op and case-only rename; no overwrite or merge; stable asset/folder IDs and recreated old names; subtree/scan races, expected-version conflicts, unknown outcomes and crash recovery; updated search, breadcrumbs and resumed views.                                                                                                                                                                                     |
| Folder moves            | Protected-root source rejection; valid root destinations; same-parent no-op; self/descendant rejection; no merging; stable folder/asset IDs and recreated paths; empty/hidden/sidecar entries; unsupported metadata/symlinks/mounts; bounded inventories; concurrent changes and crash recovery; search/counts and open-folder restoration; restoring Trash after its original folder moves.                                                                                                                                                                                                                   |
| Metadata and media      | Stable IDs with duplicate content; annotations, frames/highlights, manual scores and history across move/restore; active-only ranking and direct access; invalidated derivatives; stale generator publication; watcher/scan races and repeated cleanup.                                                                                                                                                                                                                                                                                                                                                        |
| Selection               | Select loaded scope; query changes and different selected IDs with the same count; single-item Rename visibility; selection retained after editor close; consistent light/dark, desktop and phone layouts.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Edit details            | Score/Tags panels and keyboard navigation; no Change score opt-in; uniform/mixed scores and favorites; untouched score omission and explicit zero; invalid numeric drafts; independent drafts across tab switches without requests; active-tab-only Apply; staged tag clearing/confirmation; Cancel after another tab succeeded; failure/unknown-result recovery; duplicate Apply and stale responses; footer order/visibility at 320 px, zoom and with the phone keyboard.                                                                                                                                    |
| Gallery reconciliation  | Repeated score taps, holds and key presses under both score directions; favorite ties; score/tag filter exits; unrelated-sort stability; explicit Update results and pending count; editor/selection continuity; rename/search and recursive move membership; task closed before completion; partial commits, remote removals and temporarily empty loaded windows; anchored insertion/removal and virtualized focus; stale same-query reads, newer writes during refresh and multi-page consistency without skipped/duplicate records; paused paging, refresh failure/retry, foreground and phone suspension. |
| Notifications           | One acknowledged outcome per request/job or batch; correct partial/failure counts and severity; no duplicate toast/inline errors or historical replay; distinct scans with the same outcome; retries/polling/foreground deduplication; unknown outcomes and post-save refresh failures; no per-file/progress flood; Undo and View activity plus durable alternatives; old-session callback suppression and private-toast dismissal; Dialog/Sheet announcements and action focus; phone safe areas, keyboard and reduced motion.                                                                                |
| Uploads                 | Partial/duplicate/out-of-order chunks; offset/checksum errors; spoofed type/length; unsupported media; HEIC/MOV/animation inspection; oversized input; inactivity expiry; reselected changed file; browser close; login expiry and bounded memory/disk.                                                                                                                                                                                                                                                                                                                                                        |
| Maintenance             | Fresh/upgrade schemas; old backups; paused work/Trash guards; no historical operation replay; unavailable Trash payloads; root removal; backup/source separation and rebuild/wipe data safety.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Interface               | Visible alternatives to context menus; single/batch operations; mixed eligibility; folder navigation and inline creation; name conflicts; retry of failed items only; Activity after close; read-only/offline/empty states; independent Trash search; dialog/selection-bar focus; keyboard/VoiceOver; 320 px, landscape, safe areas and software keyboard; viewer neighbors, stale editors/pairs and foreground restoration.                                                                                                                                                                                   |

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
