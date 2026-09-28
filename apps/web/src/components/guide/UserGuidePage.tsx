import {
  ArrowDownUp,
  ArrowUp,
  FolderSync,
  GalleryHorizontalEnd,
  GitCompareArrows,
  Grid3X3,
  Heart,
  Keyboard,
  Search,
  ShieldCheck,
  Tag
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../ui/card";
import { Separator } from "../ui/separator";

const gettingStartedSteps = [
  {
    icon: FolderSync,
    title: "Scan your folders",
    description:
      "Use the refresh button beside Folders. Aether indexes your media without moving the original files."
  },
  {
    icon: Search,
    title: "Find what you need",
    description:
      "Choose a folder, search by name or path, and narrow the results with media, score, or tag filters."
  },
  {
    icon: Heart,
    title: "Keep the best close",
    description:
      "Use favorites, scores, and tags to make important media easy to find again."
  }
] as const;

const browsingViews = [
  {
    icon: Grid3X3,
    title: "Gallery",
    description:
      "See many items at once. This is the fastest place to scan a folder, select several items, or edit details."
  },
  {
    icon: GalleryHorizontalEnd,
    title: "Feed",
    description:
      "Move through one item at a time with fewer distractions. Videos play in place and include a seek bar."
  },
  {
    icon: GitCompareArrows,
    title: "Compare",
    description:
      "Review the score leaderboard, then rank more media by choosing between two items at a time."
  }
] as const;

const shortcuts = [
  ["/", "Focus search"],
  ["⌘/Ctrl + B", "Show or hide the sidebar"],
  ["Arrow keys", "Move through media or choose in Compare"],
  ["Enter", "Open the selected media"],
  ["Space", "Play or pause a video"],
  ["M", "Mute or unmute"],
  ["I", "Open details"],
  ["Esc", "Close the topmost panel or viewer"]
] as const;

export function UserGuidePage() {
  return (
    <section className="guide-page" aria-labelledby="guide-title">
      <div className="guide-shell">
        <header className="guide-hero">
          <Badge variant="outline">User guide</Badge>
          <h1 id="guide-title">
            Your private media library, made easier to explore
          </h1>
          <p>
            Aether helps you browse, organize, compare, and rediscover photos
            and videos stored in your own folders.
          </p>
        </header>

        <nav className="guide-nav" aria-label="On this page">
          <a href="#guide-start">Get started</a>
          <a href="#guide-views">Browsing views</a>
          <a href="#guide-ranking">Ranking</a>
          <a href="#guide-organize">Organizing</a>
          <a href="#guide-shortcuts">Keyboard</a>
        </nav>

        <Separator />

        <GuideSection
          description="A simple first pass is enough. You can refine your library over time."
          id="guide-start"
          title="Get started"
        >
          <div className="guide-step-grid">
            {gettingStartedSteps.map((step, index) => (
              <Card className="guide-step-card" key={step.title}>
                <CardHeader>
                  <span className="guide-icon" aria-hidden="true">
                    <step.icon />
                  </span>
                  <span className="guide-step-number">0{index + 1}</span>
                  <CardTitle>{step.title}</CardTitle>
                  <CardDescription>{step.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </GuideSection>

        <GuideSection
          description="Switch views from the top-right of the library. Your folder, search, and filters stay with you."
          id="guide-views"
          title="Choose the right view"
        >
          <div className="guide-view-grid">
            {browsingViews.map((view) => (
              <article className="guide-view-item" key={view.title}>
                <span className="guide-icon" aria-hidden="true">
                  <view.icon />
                </span>
                <div>
                  <h3>{view.title}</h3>
                  <p>{view.description}</p>
                </div>
              </article>
            ))}
          </div>
        </GuideSection>

        <GuideSection
          description="The leaderboard shows the current order. You do not need to rank everything—a few clear choices can already improve it."
          id="guide-ranking"
          title="How ranking works"
        >
          <Card className="guide-ranking-card">
            <CardContent>
              <ol className="guide-ranking-steps">
                <li>
                  <span>1</span>
                  <div>
                    <strong>Start from the leaderboard.</strong>
                    <p>
                      Open any item to inspect it, or choose Rank media to begin
                      a comparison session. The active folder, search, and
                      filters carry across both views.
                    </p>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Choose the item you prefer.</strong>
                    <p>
                      Select either item or use the Left and Right arrow keys.
                      Skip the pair if you have no clear preference.
                    </p>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Aether updates the order.</strong>
                    <p>
                      It considers the full set of choices and refreshes the
                      leaderboard when you return. Later pairs favor useful,
                      close matchups while still mixing in new combinations.
                    </p>
                  </div>
                </li>
              </ol>

              <div className="guide-ranking-notes">
                <h3>Changing your mind is safe</h3>
                <p>
                  Undo restores your previous choice. If the same pair appears
                  again, the new choice replaces the old one instead of being
                  counted twice.
                </p>
                <h3>Scores still work by hand</h3>
                <p>
                  You can raise or lower a score directly at any time. Aether
                  keeps that adjustment when later comparisons update the
                  ranking. Media details shows the comparison score, manual
                  adjustment, and final score separately, with actions to use
                  the comparison score or reset that item's comparisons.
                </p>
              </div>
            </CardContent>
          </Card>
        </GuideSection>

        <GuideSection
          description="These tools work together, but each one has a different purpose."
          id="guide-organize"
          title="Organize without overthinking it"
        >
          <div className="guide-tool-list">
            <GuideTool
              icon={ArrowUp}
              title="Scores"
              description="Zero means unranked. Positive scores establish importance, and higher scores appear first when sorting by score."
            />
            <GuideTool
              icon={Heart}
              title="Favorites"
              description="Mark personal standouts and filter to them quickly, regardless of score."
            />
            <GuideTool
              icon={Tag}
              title="Tags"
              description="Add names, places, events, or any labels that help you search across folders."
            />
            <GuideTool
              icon={ArrowDownUp}
              title="Filters and sorting"
              description="Temporarily narrow or reorder the library without changing your files."
            />
          </div>
        </GuideSection>

        <GuideSection
          description="Shortcuts are optional, but these make regular browsing much faster."
          id="guide-shortcuts"
          title="Keyboard shortcuts"
        >
          <Card className="guide-shortcuts-card">
            <CardHeader>
              <span className="guide-icon" aria-hidden="true">
                <Keyboard />
              </span>
              <CardTitle>Quick controls</CardTitle>
            </CardHeader>
            <CardContent className="guide-shortcut-list">
              {shortcuts.map(([keys, action]) => (
                <div key={keys}>
                  <kbd>{keys}</kbd>
                  <span>{action}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </GuideSection>

        <aside className="guide-privacy-note">
          <ShieldCheck aria-hidden="true" />
          <div>
            <h2>Your originals stay where they are</h2>
            <p>
              Aether reads media from the folders you choose. Browsing, ranking,
              favorites, scores, and tags do not rename, move, or edit the
              original files.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

interface GuideSectionProps {
  children: ReactNode;
  description: string;
  id: string;
  title: string;
}

function GuideSection({ children, description, id, title }: GuideSectionProps) {
  return (
    <section className="guide-section" id={id}>
      <header>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

interface GuideToolProps {
  description: string;
  icon: typeof ArrowUp;
  title: string;
}

function GuideTool({ description, icon: Icon, title }: GuideToolProps) {
  return (
    <article>
      <span className="guide-icon" aria-hidden="true">
        <Icon />
      </span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </article>
  );
}
