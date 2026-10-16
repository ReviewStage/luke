import { pageFrameUrl } from "@luke/features/page-frame";
import type { PageLine } from "@luke/features/page-wire";
import { AppWindowIcon } from "lucide-react";
import { useState } from "react";
import { CardHead, HoverCard } from "../hover-card";
import { PAGE_SANDBOX } from "./page-pane";
import { RelativeTime } from "./relative-time";
import { useMinute } from "./task-time";

/**
 * page-card.tsx -- the card a page of the plan hangs wherever it is named: its tab's, its row's in the plan's summary, and its chip's.
 *
 * The head is the page as its tab names it: the tab's glyph, its title
 * wrapped to two lines, the version it stands at where it has more than
 * one, and how long ago that version was written. Under it the page
 * itself, small: its newest version drawn in a frame as its tab draws it
 * (`page-pane.tsx`), under the same sandbox and from the same `luke-page:`
 * address, laid out four times the card's width, a desktop window's, and
 * scaled down to the card's (tasks.css), so the developer sees what a page is before opening it. The frame
 * is the pointer's preview and nothing more: it takes no pointer, so the
 * card stays standing while the pointer crosses it, no focus, and no part
 * in what is read aloud, and it is left out of the screen recording as the
 * tab's is. Until the page has loaded the frame's place is held, at the
 * page's shape, in a quiet ground, so the card is placed once at its size.
 */

/** A page with an id and a version, on the plan it is of. */
interface CardPage {
  readonly taskId: string;
  readonly page: PageLine;
}

/** The page's newest version, drawn small and inert. */
function PagePreview({ taskId, page }: CardPage): React.JSX.Element {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="page-card-preview ph-no-capture" data-loaded={String(loaded)}>
      <iframe
        className="page-card-frame"
        title={`${page.title} preview`}
        src={pageFrameUrl({ taskId, pageId: page.id, version: page.version })}
        sandbox={PAGE_SANDBOX}
        allow=""
        referrerPolicy="no-referrer"
        tabIndex={-1}
        aria-hidden="true"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

/** A page's card: its glyph, title, version, and age, over a preview of its newest version. */
export function PageCard({ taskId, page }: CardPage): React.JSX.Element {
  const now = useMinute();
  return (
    <HoverCard data-page-card="" data-tab-card="">
      <CardHead
        glyph={<AppWindowIcon aria-hidden="true" />}
        name={page.title}
        sub={page.version > 1 ? `Version ${page.version}` : undefined}
        corner={<RelativeTime at={page.at} now={now} hint={false} />}
      />
      {/* A new version is a new preview, held hidden until it has loaded rather than over the last one's frame. */}
      <PagePreview key={`${page.id}/${page.version}`} taskId={taskId} page={page} />
    </HoverCard>
  );
}
