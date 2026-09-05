# User Guide

## First Run

1. Sign in with the configured password.
2. Open the sidebar.
3. Press the scan button to index the configured media folders.
4. Browse from the folder tree or use search and filters from the top toolbar.

Aether reads source media in place. It stores library metadata, ratings, favorites, and tags in SQLite under the configured config directory.

## Browsing

The sidebar mirrors the configured folder roots. Folders can be expanded, collapsed, and selected without changing the original folder structure.

The gallery view is the default browser. Use it when you want to scan many items quickly. Controls let you choose the sort field and direction, grid density, tile aspect ratio, visible card metadata, media type, rating state, and tag filters.

The feed view shows one item at a time in a vertical scroll flow. It uses the same filtered collection as the gallery, so search and filters carry across both views.

## Viewing Media

Click a gallery item to open the fullscreen viewer. Use the previous and next controls to move through the current filtered collection. Videos support seeking when the browser and source format support it.

In feed view, clicking the media hides or shows the browsing chrome. Use the expand control for the fullscreen viewer, and the info control for ratings, favorites, and tags.

## Ratings, Favorites, And Tags

Aether uses a 0-10 rating scale. You can rate or clear ratings from gallery cards, the feed information drawer, and the fullscreen viewer.

Favorites are stored separately from rating. Use them for quick filtering regardless of score.

Tags are normalized for matching while preserving a readable display value. Suggestions come from existing tags, filenames, folders, and optionally local vision suggestions when configured.

## Batch Editing

Select multiple gallery items to apply the same rating, favorite state, or tag operation. Batch changes are transactional on the server: if the request fails validation, no partial annotation write is kept.

## Search

Search matches indexed filename and folder path text. CJK n-gram indexing supports substring search for Korean and similar scripts, so partial Korean terms can match filenames without spaces.

## Downloads

Downloads use authenticated asset routes. The browser never receives the source file's absolute filesystem path.

## Settings

Open Settings from the sidebar to adjust browser-local appearance preferences and browsing defaults such as view mode, sort field, sort direction, grid size, tile aspect ratio, visible card information, media filter, and rating filter. These controls use the same state as the gallery toolbar, so changes take effect immediately.

Settings also shows read-only server, security, watcher, media root, and AI status. Sensitive values such as password hashes, session secrets, absolute paths, config directories, and cache directories are not sent to the browser.
