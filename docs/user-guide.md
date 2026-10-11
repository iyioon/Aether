# User Guide

You can also open this guide from **User guide** in Aether's sidebar.

## First Run

1. Sign in with the password set by the server owner.
2. Open the sidebar and start a library scan.
3. Choose a folder, or use search and filters in the toolbar.

Aether reads your photos and videos where they already live. It keeps scores,
favorites, tags, search data, and generated previews in the Aether data
directory. It does not edit source media.

## Browse Your Library

The sidebar follows your media folders. Expanding or selecting a folder does
not change anything on disk.

- **Gallery** shows many items at once. Use the toolbar to change sorting,
  filters, tile size, tile shape, and visible details.
- **Feed** shows one item at a time. It uses the same search and filters as the
  gallery.
- **Compare** first shows the leaderboard. Select **Rank media** to choose
  between pairs.

In comparison mode, select the item that should rank higher or skip the pair.
The left and right arrow keys choose the matching side. You can undo the most
recent choice. Choosing the same pair again replaces the earlier choice.

**Compared** is the number of items included in at least one current pair.
**Active pairs** is the number of unique pair choices. These numbers show how
much comparison evidence you have collected; they are not a completion target.

## View Photos And Videos

Select a gallery item to open the fullscreen viewer. Use the previous and next
buttons to move through the current filtered list.

In the feed, tap the media to hide or show controls. Press and hold a video to
pause it, use the timeline to seek, and use the sound button to toggle audio.
Videos begin muted so they can play reliably after a page load.

Aether uses cached thumbnails and posters while larger files load. If a browser
cannot play a source video, Aether can use a browser-friendly preview instead.

## Scores, Favorites, And Tags

Every item starts with a score of zero. A score above zero appears in the
**Ranked** filter. Use the score controls on a card or in media details to raise
or lower it.

Comparison choices produce a relative comparison score. Manual score changes
are kept separately and added to it. In media details:

- **Use comparison score** removes the manual adjustment.
- **Reset comparisons** removes that item's pair choices, keeps its manual
  score, and recalculates related items.

Favorites do not affect scores. Use them as a separate quick filter.

Tags help group and find media. Aether can suggest tags from existing tags,
filenames, folders, and an optional image-analysis service. Suggestions are not
saved until you apply them.

## Edit Several Items

Select multiple gallery items to change their score, favorite state, or tags
together. A failed batch is not partly saved.

## Search

Search checks filenames and folder paths. Partial words work, including partial
Korean text in filenames.

## Download

Downloads require a signed-in Aether session. The browser receives the media,
not its absolute filesystem path.

## Settings And Reset

Settings contains appearance choices and a safe summary of the server. Secret
values and absolute server paths are not sent to the browser. Library controls
such as view, sorting, tile size, and filters stay in the library toolbar and
survive a reload through the page address.

The **Database** tab can reset scores, favorites, tags, or comparison history.
Nothing is selected by default. Review the choices, enter `RESET`, and confirm.
This does not delete source media, indexed files, folders, server settings, or
generated previews.

To rebuild the whole index or remove all Aether-managed data, stop the server
and follow [Data management](data-management.md).
