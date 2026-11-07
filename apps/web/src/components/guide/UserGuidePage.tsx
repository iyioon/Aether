import { useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { guideTopics, parseGuideTopic, type GuideTopic } from "./guide-topics";

const shortcuts = [
  ["/", "Focus search"],
  ["⌘/Ctrl + B", "Show or hide the sidebar"],
  ["↑ / ↓ or Page keys", "Previous or next Feed item"],
  ["Home / End", "First or last loaded Feed item"],
  ["Enter in Feed", "Open the current item"],
  ["← / → in viewer", "Previous or next item"],
  ["↑ / ↓ in viewer", "Increase or decrease score"],
  ["← / → in Compare", "Choose the left or right item"],
  ["Space in Feed or viewer", "Play or pause"],
  ["M in viewer", "Mute or unmute"],
  ["I in viewer", "Open Info"],
  ["Arrows in Framing", "Move 12px; Shift moves 1px (Fill)"],
  ["- / = in Framing", "Zoom 5%; Shift adjusts 1% (Fill)"],
  ["Arrows on editor timelines", "Adjust 100ms; Shift adjusts 1ms"],
  ["Page / Home / End on timelines", "Adjust 1s / jump to limits"],
  ["Shift + F10 on a card", "Open card actions"],
  ["Esc", "Close the current panel or viewer"]
] as const;

export function UserGuidePage({
  topic,
  onTopicChange
}: {
  topic?: GuideTopic;
  onTopicChange?: (topic: GuideTopic) => void;
}) {
  const [localTopic, setLocalTopic] = useState<GuideTopic>("browse");
  const root = useRef<HTMLElement>(null);
  const changeTopic = (value: string) => {
    const next = parseGuideTopic(value);
    setLocalTopic(next);
    onTopicChange?.(next);
    const scroll = root.current?.closest(".library-main");
    if (scroll) scroll.scrollTop = 0;
  };
  return (
    <section ref={root} className="guide-page" aria-labelledby="guide-title">
      <div className="guide-shell">
        <h1 id="guide-title">User guide</h1>
        <Tabs
          className="guide-tabs"
          value={topic ?? localTopic}
          onValueChange={changeTopic}
        >
          <TabsList className="guide-tabs-list" aria-label="Guide topics">
            {guideTopics.map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent className="guide-tab-panel" value="browse">
            <h2>Sign in and scan</h2>
            <ol>
              <li>Sign in with the server’s shared password.</li>
              <li>
                Use the refresh button beside Folders to scan for new or changed
                media.
              </li>
              <li>Choose a folder, or search by name and path.</li>
            </ol>
            <h2>Choose a view</h2>
            <p>
              Use the view buttons beside search, or open Change view in a
              narrow window. Gallery shows a grid. Select a card to open the
              viewer. Right-click or long-press its preview for actions;
              selection and the viewer’s More menu provide the same file
              commands.
            </p>
            <p>
              Feed shows one item at a time. Swipe up or down on phones, or
              scroll on desktop. Compare shows the leaderboard and Rank media.
            </p>
            <p>
              The Account menu at the bottom of the sidebar contains Trash,
              Activity, User guide, Settings and Sign out. Its count shows
              operations in progress or needing attention.
            </p>
            <h2>Filter and sort</h2>
            <p>
              Open View options for Filters, Sort and Layout. Compare has
              Filters and Layout. Clear filters keeps search, sort and layout.
              Gallery and Compare remember their own layouts; Feed uses
              Portrait.
            </p>
            <p>
              Saved score, favorite or tag changes appear immediately. If they
              affect the current sorting or filters, cards stay in place until
              you choose Update results or change the view. Update results is
              above the search bar. Loading more results pauses while sorting or
              filtering changes are waiting.
            </p>
            <p>
              Completed uploads, restores, moves, renames and deletions update
              the Gallery automatically. Aether keeps your browsing position
              where possible and waits for selection or editing to finish. Any
              waiting score or tag changes keep their current order until you
              choose Update results.
            </p>
            <h2>Use the viewer</h2>
            <p>
              Tap the media to hide or show controls. Info opens details without
              stopping playback. More contains Edit media, Download and
              available file actions. View options includes Play highlights only
              and Use saved framing.
            </p>
            <p>
              The preview remains visible while the full photo or video
              prepares. A slim bar shows loading or buffering. Use Retry if
              loading fails.
            </p>
            <h2>Use Aether on iPhone</h2>
            <p>
              In Safari, choose Share → Add to Home Screen. Aether resumes your
              place when you return. Native video fullscreen uses the iPhone’s
              playback controls.
            </p>
          </TabsContent>
          <TabsContent className="guide-tab-panel" value="edit">
            <h2>Open the editor</h2>
            <ol>
              <li>
                Right-click or long-press a Gallery preview, or open the
                viewer’s More menu.
              </li>
              <li>Choose Edit media.</li>
              <li>
                Adjust Playback or Framing, then choose Save. Cancel discards
                unsaved changes.
              </li>
            </ol>
            <h2>Set highlights and playback</h2>
            <p>
              For video and animated images, drag the highlight handles or enter
              Start and End. Seek in the preview and choose Start here or End
              here to mark the current frame. Timeline arrows adjust 100ms;
              Shift adjusts 1ms. Page keys adjust one second; Home and End jump
              to the control’s limits.
            </p>
            <p>
              Choose speed and loop mode. Repeat plays forward. Bounce plays
              forward and backward without sound. Supported videos use a
              compressed playback copy of a section up to 30 seconds at the
              original dimensions. HDR and some other formats require Repeat;
              large files can exceed processing limits.
            </p>
            <p>
              Bounce and framing do not rewrite source bytes. Download returns
              the source file. Use Play highlights only in View options to play
              the saved section. Compare plays forward at 1×.
            </p>
            <h2>Adjust framing</h2>
            <p>
              Choose Original, Square, Portrait or Landscape. Each layout keeps
              its own position and zoom. Fit shows the whole item. Fill covers
              the frame; drag to position and pinch or use Zoom to enlarge it.
              Arrow keys move 12px, or 1px with Shift. Use -/= to zoom 5%, or 1%
              with Shift.
            </p>
            <p>
              Switch layouts and save once to keep all changes. Feed uses
              Portrait. Gallery and Compare use their selected layouts. The
              viewer shows the complete source unless Use saved framing is
              enabled.
            </p>
            <h2>Save or reset</h2>
            <p>
              The preview keeps playing when tabs change. Seeking pauses at the
              chosen frame. Reset needs Save. Settings → Database can reset
              playback or framing for the library.
            </p>
            <p>
              Save closes the editor when complete. A failed save keeps your
              draft and shows a message beside Save. If another window saved
              first, reload its settings before saving again. Changing a Bounce
              section turns on Play highlights only; framing and speed edits
              keep that preference.
            </p>
          </TabsContent>
          <TabsContent className="guide-tab-panel" value="ranking">
            <h2>Compare media</h2>
            <ol>
              <li>Open Compare, then choose Rank media.</li>
              <li>
                Choose the left or right item. Skip when you have no preference.
              </li>
              <li>
                Use Undo to reverse the last choice. Return to the leaderboard
                to see the order.
              </li>
            </ol>
            <p>
              The active folder, search and filters determine the comparison
              pool. Choosing the same pair again replaces the earlier
              preference.
            </p>
            <h2>Read scores and progress</h2>
            <p>
              Zero means unranked; a positive score means ranked. Info shows the
              comparison score, manual adjustment and final score separately.
              Manual adjustments remain when comparisons change.
            </p>
            <p>
              Compared counts items used in at least one current pair. Active
              pairs counts distinct pairs with a saved choice. Neither means
              every item is ranked.
            </p>
          </TabsContent>
          <TabsContent className="guide-tab-panel" value="manage">
            <h2>Edit details</h2>
            <ol>
              <li>
                Choose Select media in Gallery and select cards. Select loaded
                includes only currently loaded items.
              </li>
              <li>Choose Edit details.</li>
              <li>
                Use Score for score and favorites, or Tags for labels. Choose
                Apply to save the active tab.
              </li>
            </ol>
            <p>
              Mixed means selected items have different values. Enter a score to
              replace them; an untouched score is kept. Zero means unranked.
              Switching tabs keeps both drafts. Cancel closes the editor and
              discards unsaved drafts; earlier applied changes remain. Done
              returns to browsing.
            </p>
            <p>
              Choose Add to existing, Replace existing or Clear all tags. Stage
              up to 50 tags with Add or Enter, then choose Apply. Clearing tags
              requires confirmation. Suggestions are optional; only tags you
              choose are saved.
            </p>
            <h2>Create or rename a folder</h2>
            <ol>
              <li>
                Right-click a folder in the tree, or select it and open Selected
                folder actions. With the folder focused, use Shift+F10 or the
                Menu key.
              </li>
              <li>Choose New folder or Rename.</li>
              <li>Enter the name and choose Create folder or Rename.</li>
            </ol>
            <p>
              New folder creates a child of that folder. Assigned roots cannot
              be renamed or moved. Renaming a folder includes its contents.
            </p>
            <h2>Rename or move media</h2>
            <ol>
              <li>
                Right-click or long-press a Gallery preview, or open the
                viewer’s More menu. For several items, select Gallery cards.
              </li>
              <li>Choose Rename or Move to.</li>
              <li>
                For a rename, enter a name and choose Rename. The media
                extension stays fixed. For a move, open the destination folder
                and choose Move here.
              </li>
            </ol>
            <p>
              Use a folder’s actions to move the entire folder, including
              unindexed files and empty subfolders. Check Activity for progress
              or unsuccessful items. Completed moves keep scores, tags and
              comparison history.
            </p>
            <p>
              If Name conflicts appears, choose Skip or Keep both for each item
              and review the proposed names before confirming again. Apply to
              remaining conflicts repeats the choice for later items. Skipped
              items are left in place; existing files and folders are not
              replaced or merged. Add media and Restore use the same review.
              Names are checked again when the action runs.
            </p>
            <h2>Add media</h2>
            <ol>
              <li>
                In Gallery, open Add media and select Choose files, or drop
                files into the grid on desktop.
              </li>
              <li>
                Review the files, limits and writable destination. Use Choose
                more files to extend the selection.
              </li>
              <li>Choose Add files. Activity opens with upload progress.</li>
            </ol>
            <p>
              Cancel clears the unsubmitted selection and returns to the
              library. Leaving through library navigation or browser history
              keeps the selection in the current tab until a reload. Folder
              uploads are not supported.
            </p>
            <h2>Move to Trash and restore</h2>
            <ol>
              <li>Select media and choose Move to Trash.</li>
              <li>
                Confirm the action. Use Undo after completion, or open Account →
                Trash and select Restore.
              </li>
            </ol>
            <p>
              Trash retains files for 30 days by default and still uses disk
              space. Each item shows its original folder, size and deletion
              date. Items being restored or deleted show their current status;
              use View activity for details. Restore uses the original folder
              when available; otherwise choose another destination. Delete
              permanently and Empty Trash cannot be undone. Empty Trash includes
              items hidden by its search.
            </p>
            <h2>Check Activity</h2>
            <p>
              Open Account → Activity in the sidebar for upload progress,
              completed work and items needing attention. Activity opens as a
              page. Each result identifies its media or folder, action, time and
              status. Use Needs attention to find paused uploads and operations
              that need recovery. Refresh Activity checks for the latest
              results. Leaving the page does not cancel accepted work.
            </p>
            <p>
              Routine file actions keep the current view open and report their
              result in a notification. Use View activity for details.
            </p>
            <p>
              Uploads can pause offline or when the app leaves the foreground.
              Return to resume. After a reload, choose Resume and select the
              same file beside its transfer; Aether checks the retained bytes
              before continuing. An upload is complete when it has been added to
              the library.
            </p>
            <p>
              Resolve a reported problem, then use Check again. A batch can
              partly succeed. Cancel remaining stops safely cancellable file
              operations. Retry only unsuccessful items. Checking status means
              the result is still unknown; wait for a confirmed result before
              starting the same action again.
            </p>
            <p>
              If Move to Trash was interrupted, keep the media drive connected
              and use Check again in Activity. Leave Aether's managed folders
              untouched while it checks the retained file.
            </p>
          </TabsContent>
          <TabsContent className="guide-tab-panel" value="files">
            <h2>Read and write access</h2>
            <p>
              Media roots are read-only by default. The server operator must
              enable writes for named roots and provide writable filesystem
              access. Browser permissions cannot enable server writes. All
              signed-in devices share the configured access. Settings → Server
              shows each root’s current access.
            </p>
            <p>
              Scanning reads files and updates the index. Scores, favorites,
              tags, comparison history, playback and framing are stored
              separately from source files. File commands create, rename or move
              folders and media; Move to Trash relocates a file, and permanent
              deletion removes its retained copy.
            </p>
            <h2>Source files and generated copies</h2>
            <p>
              Aether creates thumbnails and playback copies for display. HEIC
              photos use a full-resolution PNG with orientation, transparency
              and color profile. Download returns the source file. Some HDR,
              color formats and very large files cannot be displayed.
            </p>
            <p>
              Adding media copies the bytes supplied by the device picker. The
              device’s copy is kept. A phone may supply a converted file; Aether
              cannot choose a different camera original. Live Photo pairs are
              separate files.
            </p>
            <h2>Storage and backups</h2>
            <p>
              Generated copies and library metadata use the server’s data
              directory. Trash remains on its media drive. Aether database
              backups exclude source media and files in Trash; back up those
              files separately. A disconnected drive remains unavailable until
              reconnected.
            </p>
          </TabsContent>
          <TabsContent className="guide-tab-panel" value="help">
            <h2>Loading, saving and transfers</h2>
            <p>
              For a loading failure, use Retry on the media. If the server is
              busy, wait briefly before retrying. If HEIC display is
              unavailable, ask the operator to check the decoder tools; Download
              still returns the HEIC source.
            </p>
            <p>
              Save errors remain beside the field or action with the draft
              intact. Activity keeps transfer failures and recovery actions. A
              successful save followed by a refresh failure does not need
              another save; use Update results to retry the refresh.
            </p>
            <p>
              Sign in again if the session expires. Reconnect an unavailable
              drive before retrying work on it. File actions require a writable
              root; unsupported filesystem features can prevent a move.
            </p>
            <h2>Reset library data</h2>
            <p>
              In Settings → Database, choose which scores, favorites, tags,
              comparisons, playback or framing to reset. Review the confirmation
              before applying. These resets do not delete source files.
            </p>
            <h2>Keyboard shortcuts</h2>
            <p>Focused fields, menus and dialogs keep their own keys.</p>
            <dl className="guide-shortcut-list">
              {shortcuts.map(([keys, action]) => (
                <div key={keys}>
                  <dt>
                    <kbd>{keys}</kbd>
                  </dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
