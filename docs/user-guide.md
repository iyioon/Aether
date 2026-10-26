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

- **Gallery** shows many items at once. Open **View options** (the sliders button)
  for **Filters**, **Sort**, and **Layout**. Layout changes tile size, tile shape,
  and visible card details.
- **Feed** shows one item at a time. It uses the same search and filters as the
  gallery.
- **Compare** first shows the leaderboard. Select **Rank media** to choose
  between pairs.

View options opens beside the toolbar on desktop and in a bottom sheet on phones.
On narrow screens, search and controls share one row; the current view button
opens the Gallery / Feed / Compare menu. Changes apply immediately. A count on
the button shows active media, score, and tag filters; **Clear filters** removes them without changing search, sorting, or
layout. Multiple tags match items with all selected tags. Feed offers Filters and
Sort; Compare offers Filters. Gallery layout controls appear only in Gallery.

In comparison mode, select the item that should rank higher or skip the pair.
The left and right arrow keys choose the matching side. You can undo the most
recent choice. Choosing the same pair again replaces the earlier choice.

While you compare, Aether prepares up to three upcoming pairs and their display
images in the background. Your choice is confirmed by the server before the
next pair appears. Ready images can appear immediately after confirmation;
video playback and uncached media can still take time to load. Large originals
load when displayed to limit memory use. Aether reduces
preloading when the browser reports a slow connection or data-saving mode, and
stops background preparation while the app is hidden.

**Compared** is the number of items included in at least one current pair.
**Active pairs** is the number of unique pair choices. These numbers show how
much comparison evidence you have collected; they are not a completion target.

## Resume And Home Screen Use

Aether remembers your page, library controls, Settings tab, fullscreen item,
and browsing position in this browser. Ranking also remembers the ordered pair
and the most recent choice you can undo when you return from another view or
reopen the app. A removed item or changed filter may require a new pair. Browser
storage restrictions or clearing website data can remove this saved state.

On iPhone, add Aether to the Home Screen with **Open as Web App** enabled. Use a
stable HTTPS address trusted by the device. Home Screen launches resume the
saved location; an explicit view link opens that view. Browser Back and Forward
follow page and view navigation.

On phones, Feed fills the available screen with a Gallery / Feed / Compare
selector and View options button over the top-right corner of the media. Tap
the media to hide or show both buttons together with details and playback
controls. View options gives direct access to filters and sorting, including
when the feed is empty. Switch to Gallery or Compare for search and folder
navigation.
On supported iOS versions, media extends behind the status bar; a dark gradient
keeps the clock readable. iOS may reserve a strip at the top on some versions,
which the app cannot cover.

After a production build has loaded online, the interface can reopen offline
and show a recovery screen. Photos, videos, library data and editing still
require a connection to your signed-in server. The offline cache contains
only public application files. A new application version activates after its
previous windows close.

Signing out clears saved navigation and ranking state. Session expiration
preserves your destination so you can sign in and continue. Appearance
preferences remain in this browser.

## View Photos And Videos

Select a gallery item to open the fullscreen viewer. Use the previous and next
buttons to move through the current filtered list.
Visible gallery videos play muted previews within the selected card shape,
including portrait videos cropped into landscape cards.

In the feed, tap the media to hide or show details and playback controls together.
The compact video control bar keeps play/pause, seeking, sound, and expansion
on one row, with elapsed and total time above the timeline. Its background blends
into the title's gradient. Press and hold a video to pause temporarily; releasing
it preserves an existing pause. Use the
expansion button to open the viewer.
With the seek bar focused, arrow keys seek one second, Page keys seek ten
seconds, and Home/End jump to the beginning/end.

The viewer overlays playback controls on the media so tall videos can fill the
available height without cropping. It offers browser fullscreen when available,
with native video fullscreen on supported iPhones. System fullscreen
uses the device's controls. Controls remain visible while paused, focused, or
scrubbing. The single-row bar sits above the iPhone Home indicator in portrait and
landscape, with large touch areas for its buttons and timeline.

Videos begin muted. An explicit pause remains paused after leaving and returning
to the app. Muted playback may resume when you return; audible playback waits
for you to press Play again.

Aether uses cached thumbnails and posters while larger files load. If a browser
cannot play a source video, Aether can use a browser-friendly preview instead.
A missing poster does not prevent a supported video from playing.

## Presentation Settings

Choose **Edit media** beside Download on a Gallery card, below the heart in
Feed, beside a Comparison card, or in the viewer toolbar. One editor holds
changes until **Save**; **Cancel** discards the draft. **Reset** restores the
draft defaults, which take effect only after Save. These edits do not change
source files or downloads.

- **Playback:** select start and end handles or enter times for a highlight.
  Preview the section, choose 0.5×–2× speed, and use Repeat or Bounce.
  Bounce plays forward then backward without repeating the endpoint frames;
  video bounce is silent. The video draft previews forward; Bounce applies after Save using a
  generated, continuous forward/reverse rendition.
- **Framing:** choose Auto, Fit, or Fill. Auto keeps each view's usual fit;
  Fit shows the whole item. In Fill, drag or use arrow keys to reposition,
  pinch or use Zoom to enlarge, and preview different card shapes. One saved
  focal point and zoom apply across views, rather than a separate crop per shape.
- **View options → Play highlights only** applies saved sections in Gallery,
  Feed, and the viewer. With this off, an item with a highlight plays its full
  source in Repeat; speed and framing still apply. Bounce without a highlight
  applies to the full item. The playback bar identifies a looping highlight or
  bounce and displays original source times.

Videos support highlights up to two minutes and bounce up to ten seconds.
Animated GIF, WebP, APNG, and AVIF support playback editing within sixty seconds,
600 frames, and the server's decoded-pixel budget. Transparency and individual
frame timing are retained. Large or undecodable files may be unavailable for
playback editing. Preparation can take time on the first playback; retry a
failed request explicitly. Backgrounding pauses playback; preparation may still
be needed when you return.

Comparison always uses the full source at normal speed with forward repeat,
while preserving saved framing. Its aspect button offers Original, Square,
Portrait, and Landscape without changing the pair or Undo.

Settings are shared by devices using the same server. If another window saves
first, the editor keeps your draft and asks you to reload saved settings. If a
source file changes, scan the library before editing it. Safe moves retain edits;
replacing a file's content clears them.

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

The **Database** tab can reset scores, favorites, tags, comparison history,
highlights and playback, or position and zoom.
Nothing is selected by default. Review the choices, enter `RESET`, and confirm.
This does not delete source media, indexed files, folders, or server settings.
Playback reset removes obsolete section and bounce renditions; other previews
remain. Position and zoom reset keeps playback preferences.

To rebuild the whole index or remove all Aether-managed data, stop the server
and follow [Data management](data-management.md).
