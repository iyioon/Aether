# User Guide

The same concise guide is available inside Aether from **User guide** in the sidebar.

## First Run

1. Sign in with the configured password.
2. Open the sidebar.
3. Press the scan button to index the configured media folders.
4. Browse from the folder tree or use search and filters from the top toolbar.

Aether reads source media in place. It stores library metadata, scores, favorites, and tags in SQLite under the configured config directory.

## Browsing

The sidebar mirrors the configured folder roots. Folders can be expanded, collapsed, and selected without changing the original folder structure.

The gallery view is the default browser. Use it when you want to scan many items quickly. Controls let you choose the sort field and direction, grid density, tile aspect ratio, visible card metadata, media type, score state, and tag filters.

The feed view shows one item at a time in a vertical scroll flow. It uses the same filtered collection as the gallery, so search and filters carry across both views. Static images appear immediately from a cached thumbnail, then crossfade to the original after the browser finishes decoding it. If the original format cannot be displayed, the thumbnail remains available as the fallback.

The comparison view opens on a leaderboard for the same filtered collection. Select **Rank media** to compare two items at their largest practical size. Choose the item that should rank higher, or skip a pair when there is no useful preference. The left and right arrow keys choose the corresponding item on a keyboard. The most recent choice can be undone, and choosing the same pair again replaces the earlier active preference rather than counting twice.

During a comparison session, **Compared** counts media that currently appears in at least one active pair, while **Active pairs** counts the unique current matchups. These describe comparison coverage; they are separate from the **Ranked** filter, which means a positive final score.

## Viewing Media

Click a gallery item to open the fullscreen viewer. Use the previous and next controls to move through the current filtered collection. Videos support seeking when the browser and source format support it.

In feed view, click or tap the media to hide or show the browsing chrome. Press and hold a video to pause it temporarily; playback resumes when the press ends. Use the bottom timeline to seek, the sound control to toggle audio, and the expand control to open the fullscreen viewer. Select the media title to open scores, favorites, and tags.

Feed videos try the authenticated original stream first. If the browser cannot decode the source codec or container, Aether falls back to a generated browser-compatible preview. Videos begin muted so autoplay remains reliable after loading or refreshing the page.

Comparison videos use their decoded poster while the original stream starts and while a replay seeks back to the beginning. This avoids exposing an empty video frame on mobile devices. Use the fullscreen button on either item when you want to inspect it before choosing.

## Scores, Favorites, And Tags

Aether stores a non-negative media score without a fixed scale such as 1–5 or 1–10. Every item starts at zero, which means unranked. On a gallery card, use the up-arrow button to increase its score. Hover or focus the score control to reveal the decrement action. The Ranked filter includes values above zero; Unranked includes zero.

Pairwise choices are fitted into a relative score using the active comparison graph. The comparison workspace gives priority to items with less evidence and to close matchups, so rankings improve without requiring every possible pair. Direct score changes are retained as a separate manual adjustment.

For an item with comparisons, open media details to see its comparison score, manual adjustment, and final score. **Use comparison score** removes the manual adjustment without changing pairwise choices. **Reset comparisons** removes every active pair involving that item after confirmation, preserves its manual score, and recalculates related media.

Favorites are stored separately from score. Use them for quick filtering regardless of score.

Tags are normalized for matching while preserving a readable display value. Suggestions come from existing tags, filenames, folders, and optionally local vision suggestions when configured.

## Batch Editing

Select multiple gallery items to apply the same score, favorite state, or tag operation. Batch changes are transactional on the server: if the request fails validation, no partial annotation write is kept.

## Search

Search matches indexed filename and folder path text. CJK n-gram indexing supports substring search for Korean and similar scripts, so partial Korean terms can match filenames without spaces.

## Downloads

Downloads use authenticated asset routes. The browser never receives the source file's absolute filesystem path.

## Settings

Open Settings from the sidebar to adjust browser-local appearance preferences and browsing defaults such as view mode, sort field, sort direction, grid size, tile aspect ratio, visible card information, media filter, and score filter. These controls use the same state as the gallery toolbar, so changes take effect immediately.

Settings also shows read-only server, security, watcher, media root, and AI status. Sensitive values such as password hashes, session secrets, absolute paths, config directories, and cache directories are not sent to the browser.

The **Database** tab can selectively reset scores, favorites, tags, or comparison history. Nothing is selected by default. Review the descriptions carefully, confirm the selected categories, and type `RESET` before the transaction runs. These actions do not delete source media, indexed assets, folders, accounts, server configuration, thumbnails, posters, or preview clips.
