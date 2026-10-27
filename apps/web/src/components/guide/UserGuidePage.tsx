import {
  ArrowDownUp,
  ArrowUp,
  FolderSync,
  GalleryHorizontalEnd,
  GitCompareArrows,
  Grid3X3,
  Heart,
  Search,
  ShieldCheck,
  Tag
} from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

const topics = [
  ["start", "Get started"],
  ["browse", "Browsing"],
  ["edit", "Edit media"],
  ["ranking", "Ranking"],
  ["organize", "Organizing"],
  ["keyboard", "Keyboard"]
] as const;

const gettingStartedSteps = [
  {
    icon: FolderSync,
    title: "Scan your folders",
    description:
      "Select the refresh button beside Folders to find new or changed media. Your original files stay where they are."
  },
  {
    icon: Search,
    title: "Find media",
    description:
      "Choose a folder or search by name and path. Open View options to filter by type, score, favorites or tags."
  },
  {
    icon: Heart,
    title: "Organize your picks",
    description:
      "Add favorites, scores and tags from an item's details. Select several Gallery cards to update them together."
  }
] as const;

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
  ["Shift + F10 on a card", "Open card actions"],
  ["Esc", "Close the current panel or viewer"]
] as const;

export function UserGuidePage() {
  return (
    <section className="guide-page" aria-labelledby="guide-title">
      <div className="guide-shell">
        <header className="guide-hero">
          <h1 id="guide-title">User guide</h1>
          <p>Browse and organize the photos and videos in your folders.</p>
        </header>

        <Tabs className="guide-tabs" defaultValue="start">
          <TabsList className="guide-tabs-list" aria-label="Guide topics">
            {topics.map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent className="guide-tab-panel" value="start">
            <GuideSection title="Get started">
              <div className="guide-step-grid">
                {gettingStartedSteps.map((step, index) => (
                  <Card className="guide-step-card" key={step.title}>
                    <CardHeader>
                      <span className="guide-icon" aria-hidden="true">
                        <step.icon />
                      </span>
                      <span className="guide-step-number">{index + 1}</span>
                      <CardTitle>
                        <h3>{step.title}</h3>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p>{step.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <aside className="guide-privacy-note">
                <ShieldCheck aria-hidden="true" />
                <div>
                  <h3>Your originals stay unchanged</h3>
                  <p>
                    Aether saves your edits and organization separately. It does
                    not move, rename or change source files. Downloads always
                    give you the original file. HEIC photos use a
                    full-resolution browser copy with their orientation and
                    color profile; downloads keep the HEIC original.
                  </p>
                </div>
              </aside>
            </GuideSection>
          </TabsContent>

          <TabsContent className="guide-tab-panel" value="browse">
            <GuideSection
              title="Browse your library"
              description="Switch views at the top right. Your folder, search and filters carry across views."
            >
              <div className="guide-view-grid">
                <GuideTool icon={Grid3X3} title="Gallery">
                  Browse a grid and select several items for batch changes.
                  Click an item to open the viewer. Right-click a card or
                  long-press its preview for Info, Edit media and Download.
                </GuideTool>
                <GuideTool icon={GalleryHorizontalEnd} title="Feed">
                  Browse one item at a time in a portrait frame. Swipe up or
                  down on phones, or scroll on desktop. Tap the media to hide or
                  show the buttons, details and playback controls together.
                </GuideTool>
                <GuideTool icon={GitCompareArrows} title="Compare">
                  Check the leaderboard or select Rank media to compare pairs.
                  Choose the item you prefer, skip a pair or undo your last
                  choice.
                </GuideTool>
              </div>
              <div className="guide-text-block">
                <h3>View options</h3>
                <p>
                  Use the sliders button for Filters, Sort and Layout. Compare
                  has Filters and Layout. Gallery and Compare remember their own
                  media layout and card info. Feed always uses Portrait; its
                  card info starts hidden. Clear filters keeps your search, sort
                  and layout.
                </p>
                <h3>The media viewer</h3>
                <p>
                  Click or tap the media to hide or show the controls; they also
                  hide after a short pause. Info opens details without stopping
                  playback. View options contains Play highlights only and Use
                  saved framing. Saved framing starts off and is remembered in
                  this browser when you change it.
                </p>
                <p>
                  A slim bar at the top of the media shows loading or
                  preparation. The preview stays visible until the full photo or
                  first playback frame is ready. Highlights show their selected
                  start while loading. If loading fails in the viewer, the
                  preview stays visible while you retry.
                </p>
                <p>
                  On iPhone, Safari's Share menu → Add to Home Screen opens
                  Aether as a web app. It resumes your place when you return.
                  Native video fullscreen uses the iPhone's playback controls.
                </p>
              </div>
            </GuideSection>
          </TabsContent>

          <TabsContent className="guide-tab-panel" value="edit">
            <GuideSection
              title="Edit media"
              description="Open Edit media from a Gallery card's menu, the viewer toolbar or the pencil below the Feed heart."
            >
              <div className="guide-edit-grid">
                <Card className="guide-topic-card">
                  <CardHeader>
                    <CardTitle>
                      <h3>Playback</h3>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p>
                      For videos and animated images, drag the highlight handles
                      or enter Start and End times. Seek in the preview and use
                      Start here or End here to mark the current frame.
                    </p>
                    <p>
                      Choose a speed and loop mode. Repeat plays forward; Bounce
                      plays forward and then backward, without sound. Supported
                      videos use a lossless copy of a section up to 30 seconds,
                      prepared after Save. Some formats, including HDR video,
                      need Repeat. Large files may exceed processing limits.
                    </p>
                    <p>
                      Turn on Play highlights only in View options to loop the
                      saved section. It is available in Gallery, Feed, Compare
                      and the viewer. Compare always plays forward at 1×.
                    </p>
                  </CardContent>
                </Card>
                <Card className="guide-topic-card">
                  <CardHeader>
                    <CardTitle>
                      <h3>Framing</h3>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p>
                      Choose Original, Square, Portrait or Landscape. Each
                      layout keeps its own position and zoom. Fit shows the
                      whole item. Fill covers the frame; drag to position and
                      pinch or use Zoom to enlarge it.
                    </p>
                    <p>
                      Switch layouts to adjust each one, then Save once to keep
                      all changes. Feed uses your Portrait frame. Gallery and
                      Compare use the layout selected in View options.
                    </p>
                    <p>
                      The viewer shows the complete original by default. Turn on
                      Use saved framing in its View options to use the frame for
                      the view you opened it from.
                    </p>
                  </CardContent>
                </Card>
              </div>
              <div className="guide-text-block">
                <h3>Save and reset</h3>
                <p>
                  The preview keeps playing when you switch between Playback and
                  Framing. Seeking pauses on the chosen frame. Save keeps your
                  changes; Cancel discards them. Reset in the editor also needs
                  Save. To reset many items, use Settings → Database and choose
                  playback or framing.
                </p>
                <p>
                  First playback may take a moment to prepare. If another window
                  saved changes first, reload its saved settings before saving
                  again.
                </p>
              </div>
            </GuideSection>
          </TabsContent>

          <TabsContent className="guide-tab-panel" value="ranking">
            <GuideSection title="Rank media">
              <ol className="guide-ranking-steps">
                <li>
                  <span>1</span>
                  <div>
                    <h3>Open Compare</h3>
                    <p>
                      The leaderboard shows your current order. Select Rank
                      media to start comparing items from the active folder,
                      search and filters.
                    </p>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <h3>Choose your preference</h3>
                    <p>
                      Select the left or right item. Skip when you have no
                      preference. Undo reverses the last choice.
                    </p>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <h3>Return to the leaderboard</h3>
                    <p>
                      Aether updates the order from your choices. Choosing the
                      same pair again replaces your earlier preference.
                    </p>
                  </div>
                </li>
              </ol>
              <div className="guide-text-block">
                <h3>Scores and progress</h3>
                <p>
                  Zero means unranked; a positive score means ranked. You can
                  also adjust scores by hand. Info shows the comparison score,
                  your adjustment and the final score separately.
                </p>
                <p>
                  Compared counts items used in at least one current pair.
                  Active pairs counts distinct pairs with a saved choice.
                  Neither means that every item is ranked.
                </p>
              </div>
            </GuideSection>
          </TabsContent>

          <TabsContent className="guide-tab-panel" value="organize">
            <GuideSection title="Organize media">
              <div className="guide-tool-list">
                <GuideTool icon={ArrowUp} title="Scores">
                  Raise or lower scores from the viewer or Info. Sorting by
                  score places higher scores first. Manual adjustments remain
                  when comparisons change.
                </GuideTool>
                <GuideTool icon={Heart} title="Favorites">
                  Select the heart to mark a favorite. Use the favorites filter
                  to find these items regardless of score.
                </GuideTool>
                <GuideTool icon={Tag} title="Tags">
                  Add labels in Info, such as a place or event. Tags help you
                  find related media across folders. Suggestions are optional;
                  only tags you choose are saved.
                </GuideTool>
                <GuideTool icon={ArrowDownUp} title="Batch changes">
                  Choose Select media in Gallery, select your cards and apply
                  scores, favorites or tags together. Done selecting returns to
                  browsing.
                </GuideTool>
              </div>
            </GuideSection>
          </TabsContent>

          <TabsContent className="guide-tab-panel" value="keyboard">
            <GuideSection
              title="Keyboard shortcuts"
              description="Shortcuts pause while you type or use a menu or panel."
            >
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
            </GuideSection>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}

function GuideSection({
  children,
  description,
  title
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="guide-section">
      <header>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

function GuideTool({
  children,
  icon: Icon,
  title
}: {
  children: ReactNode;
  icon: typeof ArrowUp;
  title: string;
}) {
  return (
    <article className="guide-tool">
      <span className="guide-icon" aria-hidden="true">
        <Icon />
      </span>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </article>
  );
}
