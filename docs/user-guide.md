# User Guide

Open **User guide** in the sidebar for help inside Aether.

## Get Started

1. Sign in with the server's shared password.
2. Start a library scan from the sidebar.
3. Choose a folder or search for media.

Aether reads existing media folders. Scores, favorites, tags and presentation
settings stay in Aether; source files and downloads remain unchanged.

## HEIC Photos

HEIC and HEIF photos work in Gallery, Feed, Compare, the viewer and the framing
editor. Aether creates browser-compatible thumbnails and a full-resolution PNG
with the photo's orientation, transparency and color profile. Download still
returns the original file.

Aether shows the main photo from a collection or Live Photo. Some HDR photos,
unusual color formats and very large files cannot be displayed; the original
still remains available to download. See [supported formats and processing
limits](architecture.md#heic-photos) for details.

Native installations need the [HEIC tools](installation.md#heic-tools). If tools
were installed after Aether started, restart the server and scan again to fill
in photo dimensions.

## Browse

- **Gallery** shows a grid. Select an item to open the viewer. Visible videos
  play muted previews.
- **Feed** shows one item at a time in a portrait frame. On phones, tap the media
  to hide or show the top buttons, details and playback controls together.
- **Compare** opens the leaderboard. Choose **Rank media** to compare pairs.

Open **View options** for filters, sorting and layout. On phones it opens as a
bottom sheet; the view button switches between Gallery, Feed and Compare.
Search and toolbar buttons share one row in Gallery. Mobile Feed has filters
and sorting; switch to Gallery or Compare for search and folder navigation.

Gallery and Ranking remember their card shape and visible details separately.
Gallery also offers tile size. Feed always uses Portrait and offers card details
without a shape selector. Feed and Ranking initially hide card details; Ranking
starts with Original proportions.

Search matches filenames and folder paths, including partial words and Korean
text. Selected tags match items carrying all those tags. **Clear filters** keeps
your search, sort and layout choices.

## View Media

Use the viewer's previous/next buttons or left/right arrow keys to move through
the filtered list. Open **Info** for details and scoring; playback continues
behind the panel. Click or tap the media to hide or show the overlay controls.
Controls also hide during playback, staying visible while paused, focused or
scrubbing.

Video controls provide play/pause, seeking, sound and expansion. With the seek
bar focused, arrow keys move one second, Page keys move ten seconds, and
Home/End jump to the beginning/end. In Feed, holding a video pauses it until
release; an existing pause stays paused.

Videos begin muted. An explicit pause survives leaving and returning to the app.
Muted playback may resume when you return; audible playback waits for Play.
A thumbnail or poster stays visible until the full photo or first playback
frame is ready. With highlights enabled, the preview shows the selected start.
If loading fails in the viewer, the preview stays visible while you retry.
Missing previews do not prevent the media from loading. A slim bar along the
top shows loading or preparation, including while Bounce is being prepared.

The viewer's **View options** includes:

- **Use saved framing:** show the saved Gallery/Ranking frame or Feed Portrait
  frame. Initially off, it otherwise follows your remembered on/off choice in
  this browser, including after navigation, reopening, reload and sign-out.
  Toggling it preserves playback and does not edit saved frames.
- **Play highlights only:** loop the saved section. It shares the library's
  preference and is unavailable for items without a highlight.

Browser fullscreen is available where supported. Native iPhone video fullscreen
uses system controls and original proportions; saved framing applies inside
Aether.

## Edit Media

Right-click a Gallery card, touch-hold its preview, or focus it and press
Shift+F10 for **Info**, **Edit media** and **Download**. Scrolling cancels a touch
hold; score and heart holds keep their usual actions. Edit media is also in the
viewer toolbar and below the Feed heart.

The editor fills the screen. **Save** applies the draft, **Cancel** discards it,
and **Reset** restores draft defaults only after Save. Opening the editor does
not change saved settings. If another window saves first, reload its saved
settings before trying again.

### Playback

Choose a highlight with the start/end handles or time fields. Set a playback
speed from 0.5× to 2× and choose **Repeat** or **Bounce**. Bounce runs forward then
backward; video Bounce is silent and its draft previews forward until Save.
The preview and timeline stay available in both editor tabs. Switching tabs
keeps playback running; seeking pauses anywhere in the full source.

On the preview timeline or a highlight handle, arrows adjust by 100 ms; hold
Shift for 1 ms. Page Up/Down adjust by one second, and Home/End jump to that
control's limits. Keyboard adjustments pause and seek the preview. Text fields,
sliders, tabs and menus keep their own keyboard controls.

Turn on **Play highlights only** in View options to use saved sections in
Gallery, Feed, Comparison and the viewer. With it off, an item with a highlight
plays its full source in Repeat. Bounce without a highlight applies to the full
item. The playback bar identifies the active loop and shows source times.

Repeat highlights use the original video in Feed, Comparison and the viewer.
If the browser cannot play it, Aether prepares a compatible section. Highlights
can span up to two minutes. For supported videos, Bounce prepares a silent
lossless video from a section of up to 30 seconds, keeping the source frames and
timing. Some formats, including HDR video, need Repeat instead. The editor shows
the available limit. Browser support varies, and first playback may need
preparation; prepared sections are reused on later visits.

Supported MOV screen recordings can use Bounce, including full-range SDR video.
The video format and processing limits still apply.

Animated GIF, WebP, APNG and AVIF support playback editing within processing
limits. Preparation may take time on first use. Files that are too large or
cannot be decoded may be unavailable for playback editing; framing remains
available. See [Architecture](architecture.md#saved-media-presentation) for
format and processing limits.

### Framing

Choose **Fit** to show the whole item or **Fill** to cover the frame. In Fill,
drag to reposition, pinch or use Zoom to enlarge. With Framing active, arrows
adjust the framing position by 12 pixels without focusing the preview;
hold Shift for one pixel. Use `-`/`=` to zoom out/in by 5%, or Shift (`_`/`+`)
for 1%. Focused text fields, sliders, tabs and menus keep their own keys. Fit
disables movement and zoom. The grid stays visible in both modes.

Original, Square, Portrait and Landscape keep independent frames. Switching
shapes retains every draft; one Save applies them together. Gallery and Ranking
use their selected frame, and Feed uses Portrait.

Saved edits are shared with other devices using the server. If a source file
changes, scan the library before editing it. Safe moves retain edits; replacing
a file's contents clears them.

## Rank, Score And Organize

Choose the better item in a comparison pair, use the left/right arrow keys, or
skip. **Undo** restores the most recent choice. Choosing the same pair again
replaces its earlier result. Aether prepares upcoming items in the background,
but video and uncached media may still need time to load.

Comparison uses normal-speed forward repeat and the selected saved frame.
**Play highlights only** changes its range; saved speed and Bounce do not affect
ranking playback. Layout changes preserve the pair and Undo. Open the viewer
to edit a comparison item.

Scores combine comparison results with manual adjustments. Zero is unranked;
items above zero appear in the **Ranked** filter. In Info:

- **Use comparison score** removes the manual adjustment.
- **Reset comparisons** removes the item's pair choices and keeps its manual
  score.

**Compared** counts items in current pair choices; **Active pairs** counts unique
choices. They show your comparison history, not a completion target. Favorites
are separate from scores. Use tags to group media; suggestions are saved only
when you apply them.

Select several Gallery items to change scores, favorites or tags together.
A failed batch does not partly save. Download the unchanged source from a card's
context menu or the viewer toolbar while signed in.

## Resume And iPhone Home Screen

Aether remembers your page, controls, browsing position, viewer item and ranking
pair/Undo in this browser. Explicit links take precedence over saved state.
Sign-out clears navigation and ranking state; session expiry keeps your place
for sign-in. Appearance choices remain. Clearing site data or restricted browser
storage can remove saved choices.

On iPhone, use a stable, trusted HTTPS address and add Aether to the Home Screen
with **Open as Web App** enabled. Feed uses the space iOS makes available;
iOS may still reserve part of the status-bar area. Controls stay within the
phone's safe areas in portrait and landscape.

After loading online, the interface can reopen offline with a recovery screen.
Media, library data and editing require a connection to the signed-in server.
An update takes effect after existing app windows close.

## Settings And Reset

Settings contains appearance choices and server status. Library filters and
layout stay in View options.

In **Settings → Database**, select scores, favorites, tags, comparisons,
playback/highlights or position/zoom to reset. Review the choices, enter
`RESET`, and confirm. Nothing is selected initially. Source media, the index,
folders and server settings remain. Playback and framing can be reset
separately.

For a complete index rebuild or removal of Aether-managed data, stop the server
and follow [Data management](data-management.md).
