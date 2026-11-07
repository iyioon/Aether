# User Guide

Open **Account → User guide** at the bottom of the sidebar. Its topics match the
sections below.

## Browse

### Sign in and scan

1. Sign in with the server’s shared password.
2. Use the refresh button beside **Folders** to find new or changed media.
3. Choose a folder or search by filename and path.

Search includes partial words and Korean text. Selecting several tags finds
items carrying all of them.

### Choose a view

Use the view buttons beside search, or open **Change view** in a narrow window.

- **Gallery** shows a grid. Open a card to use the viewer. Right-click or
  long-press its preview for actions. Scrolling cancels a touch hold; score
  holds keep their usual behavior.
- **Feed** shows one item at a time in Portrait. Swipe up or down on phones,
  or scroll on desktop. Tap the media to hide or show controls.
- **Compare** shows the leaderboard. Choose **Rank media** to compare pairs.

The sidebar’s **Account** menu contains Trash, Activity, User guide, Settings and
Sign out. A count on Account shows operations in progress or needing attention.

Open **View options** for Filters, Sort and Layout. Compare has Filters and
Layout. **Clear filters** keeps search, sort and layout. Gallery and Ranking
remember their card shape and details separately; Feed uses Portrait.

Scores, favorites and tags update when saved. If a change affects the current
sorting or filters, cards stay in place until you choose **Update results** or
change the view. This lets you adjust a score several times without moving its
controls. **Update results** is above the search bar. Loading more results pauses
while sorting or filtering changes are waiting.

Completed uploads, restores, moves, renames and deletions update the Gallery
automatically. Aether keeps your browsing position where possible and waits for
selection or editing to finish. Any waiting score or tag changes keep their
current order until you choose **Update results**.

### Use the viewer

Use previous/next or the left/right keys to move through results. **Info** opens
details without stopping playback. **More** contains Edit media, Download and
available file actions. Tap the media to hide or show controls.

**View options** includes **Play highlights only** and **Use saved framing**.
Saved framing initially stays off and follows your remembered browser choice;
toggling it does not edit saved frames. Native iPhone fullscreen uses system
controls and original proportions.

Videos start muted. An explicit pause survives leaving and returning to the
app; audible playback waits for Play. In Feed, holding a video pauses it until
release. Focused seek controls use arrows for one second, Page keys for ten
seconds, and Home/End for the limits.

A preview remains visible while the full photo or first playback frame loads.
A slim bar shows loading, preparation or buffering. An accent segment in the
seek bar marks a saved highlight during full playback. If loading fails, use
**Retry**; if the server is busy, wait briefly before retrying.

### Resume on iPhone

In Safari, choose **Share → Add to Home Screen**, using a stable, trusted HTTPS
address and enabling Open as Web App. Aether remembers the page, query, scroll,
viewer and ranking pair/Undo in this browser. Explicit links take precedence.
Session expiry keeps your place for sign-in; sign-out clears private resume
state. Appearance choices remain. Restricted storage or clearing site data can
remove saved state.

The interface can reopen offline after loading online. Media and library data
require the signed-in server. Updates take effect after existing app windows
close. Phone controls use safe areas; iOS may still reserve status-bar space.

## Edit Media

### Open and save

1. Right-click or long-press a Gallery preview, or open the viewer’s **More** menu.
2. Choose **Edit media**.
3. Adjust Playback or Framing, then choose **Save**.

Save applies both tabs and closes when complete. **Cancel** discards
unsaved changes. **Reset** changes the draft and still needs Save. Switching
tabs retains the draft and playback; seeking pauses at the chosen frame.

Errors remain beside Save with the draft intact. Retry checks an interrupted
save before sending it again. If another window saved first, reload its
settings and preview before saving. Correct invalid times before retrying.

### Set highlights and playback

Drag highlight handles or enter Start and End. Seek in the preview and choose
**Start here** or **End here** to mark a frame. Timeline arrows adjust 100ms,
or 1ms with Shift. Page keys adjust one second; Home/End jump to the limits.

Choose speed from 0.5× to 2× and **Repeat** or **Bounce**. Repeat plays forward;
Bounce plays forward and backward without sound. Supported videos use a
compressed playback copy of a section up to 30 seconds at the source dimensions
and frame timing. HDR and some other formats require Repeat. Large dimensions
or frame rates can exceed processing or device limits. Supported full-range
SDR MOV screen recordings can use Bounce.

**Play highlights only** uses saved sections in Gallery, Feed, Compare and the
viewer. Repeat highlights can span up to two minutes. If necessary, Aether
prepares a compatible section. First playback may take time; later visits reuse
it. Saving or changing a Bounce section turns on Play highlights only; framing
and speed changes keep that preference.

GIF, WebP, APNG and AVIF playback editing depends on decoding and processing
limits. A file unavailable for playback editing can still support framing.
See [presentation formats and limits](architecture.md#saved-media-presentation).

### Adjust framing

Choose Original, Square, Portrait or Landscape. Each keeps independent position
and zoom. **Fit** shows the whole item. **Fill** covers the frame; drag to
position and pinch or use Zoom to enlarge it. Arrow keys move 12px, or 1px with
Shift. Use `-`/`=` to zoom 5%, or 1% with Shift. Focused fields, tabs and menus
keep their own keys.

Switch shapes and save once to keep all changes. Feed uses Portrait; Gallery
and Ranking use their selected shape. The viewer uses the complete source unless
Use saved framing is enabled. Edits are shared through the server. Safe moves
retain them; replacing source contents clears source-dependent presentation.

## Rank Media

1. Open **Compare**, then **Rank media**.
2. Choose the left or right item, or **Skip** when you have no preference.
3. Use **Undo** to reverse the last choice. Return to the leaderboard for the order.

The active folder, search and filters determine the pool. Choosing the same pair
again replaces its earlier preference. Comparison plays forward at 1× using the
selected saved framing; Play highlights only changes its range. Layout changes
preserve the pair and Undo.

Zero means unranked; a positive score means ranked. Info separates comparison
score, manual adjustment and final score. **Use comparison score** removes the
manual adjustment. **Reset comparisons** removes the item’s pair choices while
keeping its manual score.

**Compared** counts items in current pairs. **Active pairs** counts distinct
pairs with a saved choice. Neither means every item is ranked. Favorites are
independent of score.

## Manage Media

File actions require writable roots configured by the operator. All signed-in
devices share that access. Browser permission prompts cannot enable server writes.

### Edit details

1. Choose **Select media** in Gallery and select cards. **Select loaded** includes
   only currently loaded cards.
2. Choose **Edit details**.
3. Use **Score** for scores/favorites or **Tags** for labels, then choose **Apply**.

Apply saves only the active tab and leaves the editor open. Switching tabs keeps
both drafts. **Mixed** means selected values differ; enter a score to replace
them. An untouched score is kept. An explicit zero means unranked.

Choose **Add to existing**, **Replace existing** or **Clear all tags**.
Stage up to 50 tags with **Add** or Enter, then choose **Apply**. Clearing tags
requires confirmation. Suggestions are optional; only chosen tags are saved.
Each Score or Tags submission saves all selected items together. **Cancel** discards unsaved
drafts while retaining earlier applied changes. **Done** returns to browsing.

### Create or rename a folder

1. Right-click a folder in the tree, or select it and open **Selected folder
   actions**. With the folder focused, use Shift+F10 or the Menu key.
2. Choose **New folder** or **Rename**.
3. Enter the name and choose **Create folder** or **Rename**.

New folder creates a child of that folder. Assigned roots cannot be
renamed or moved. A folder rename includes its contents.

### Rename or move media

1. Right-click or long-press a Gallery preview, or open the viewer’s **More** menu.
   Select Gallery cards for several items.
2. Choose **Rename** or **Move to**.
3. For a rename, enter a name and choose **Rename**. The media extension stays
   fixed. For a move, open the destination folder and choose **Move here**.

Use a folder’s actions to move its whole subtree, including unindexed files and
empty subfolders. Unsupported filesystem metadata or special entries can prevent
a move.

If **Name conflicts** appears, choose **Skip** or **Keep both** for each listed
item and review the proposed names before confirming again. **Apply to remaining
conflicts** repeats the choice for later items. Skipped items are left in place;
existing files and folders are not replaced or merged. Add media and Restore use
the same review. Names are checked again when the action runs.

Moves retain item IDs, scores, favorites, tags and comparison history. The current
folder stays selected by ID when moved. Check **Activity** for progress, partial
results and recovery; retry only unsuccessful items.

### Add media

1. In Gallery, open **Add media** and select **Choose files**, or drop files into
   the grid on desktop.
2. Review the files, limits and writable destination. Use **Choose more files**
   to extend the selection.
3. Choose **Add files**. **Activity** opens with upload progress.

**Cancel** clears the unsubmitted selection and returns to the library. Leaving
through library navigation or browser history keeps the selection in the current
tab until a reload. Folder uploads are not supported.

### Use Trash

1. Select media and choose **Move to Trash**.
2. Confirm. After completion, choose **Undo**, or open **Account → Trash** and
   select **Restore**.

Trash retains files for 30 days by default and still uses disk space. The Trash
page shows each item's original folder, retained size and deletion date, along
with the server's retention period. Search finds retained items; selecting items
shows actions for that selection. Restore uses the original folder when available, following it if renamed or moved; otherwise
choose another writable destination. Conflicts never replace existing files.
Items being restored or deleted show their current status. Use **View activity**
for details; other items remain available.

**Delete permanently** cannot be undone. **Empty Trash** includes items hidden
by its search and requires a separate confirmation. An unavailable drive remains
unavailable; it is not an empty Trash.

### Check Activity

Open **Account → Activity** in the sidebar for upload progress, completed work and
items needing attention. Activity opens as a page. Each result identifies its
media or folder, action, time and status. Use **Needs attention** to find paused
uploads and operations that need recovery. **Refresh Activity** checks for the
latest results. Leaving the page does not cancel accepted work.

Routine file actions keep the current view open and report their result in a
notification. Use **View activity** for details.

Uploads can pause offline or when the app leaves the foreground. Return to
resume. After a reload, choose **Resume** and select the same file beside its transfer; Aether checks the
retained bytes before continuing. An upload is complete after the file has been
added to the library.

Resolve a reported problem, then use **Check again** to resume the same
operation. **Cancel remaining** stops safely cancellable file operations;
completed items require a reverse operation. A batch can partly succeed.
Checking status means the outcome is still unknown; wait for a confirmed result
before starting the same action again.

If **Move to Trash** was interrupted, keep the media drive connected and use
**Check again** in **Activity**. Leave Aether's managed folders untouched while
it checks the retained file.

## Media Files

### Read and write access

Media roots are read-only by default. The operator enables named writable roots
and writable filesystem mounts. **Settings → Server** shows each root’s current
access. Scanning reads files and updates the index.
Scores, tags, favorites, comparison history, playback and framing are stored
separately from source files.

File commands create, rename or move media and folders. Move to Trash relocates
source files; permanent deletion removes their retained copies. Presentation
editing does not change file contents. Download returns the source file.

### Generated copies and device files

Aether creates thumbnails and playback copies for display. HEIC/HEIF photos use
a full-resolution PNG with orientation, transparency and color profile. The main
photo in a collection is shown. Some HDR, color formats and large files cannot
be displayed. Native installations need the [HEIC tools](installation.md#heic-tools).
Restart and scan if tools were installed after startup.

Adding media copies the bytes supplied by the device picker and keeps the
device’s copy. A phone may supply a converted file; Aether cannot choose a
different camera original. Live Photo pairs are separate files.

### Storage and backups

Metadata and generated copies use Aether’s data directory. Trash remains on its
media drive. Database backups exclude source media and files in Trash; back up those
files separately. Finish or cancel transfers and restore or purge Trash before
destructive data maintenance. See [Data management](data-management.md).

## Help

For loading failures, use **Retry** on the media. If the server is busy, wait
briefly. Ask the operator to check decoder tools for HEIC display failures;
Download still returns the source.

Save errors keep the draft beside the failed action. Activity keeps transfer
failures and recovery steps. A saved edit followed by a refresh failure needs
**Update results**, not another save. Sign in again after session expiry.
Reconnect an unavailable drive before retrying work on it.

### Reset library data

In **Settings → Database**, select scores, favorites, tags, comparisons,
playback/highlights or position/zoom to reset. Review the choices, enter `RESET`
and confirm. Source media is retained. Playback and framing reset separately.
For index rebuild, restore or wipe, follow [Data management](data-management.md).

### Keyboard shortcuts

Focused fields, menus and dialogs keep their own keys.

| Keys                         | Action                           |
| ---------------------------- | -------------------------------- |
| `/`                          | Focus search                     |
| Ctrl/⌘ + B                   | Toggle sidebar                   |
| Up/Down or Page keys in Feed | Previous/next item               |
| Home/End in Feed             | First/last loaded item           |
| Enter in Feed                | Open viewer                      |
| Left/Right in viewer         | Previous/next item               |
| Up/Down in viewer            | Increase/decrease score          |
| Left/Right in Compare        | Choose an item                   |
| Space in Feed/viewer         | Play/pause                       |
| M in viewer                  | Mute/unmute                      |
| I in viewer                  | Open Info                        |
| Shift + F10 on a card        | Open actions                     |
| Escape                       | Close the active panel or viewer |
