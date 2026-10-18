import { issueIdentifier } from "@luke/features/issue-list-model";
import type { Issue } from "@luke/features/issue-wire";
import { useAppCommand } from "@luke/panel/app-commands";
import { usePaneSlide } from "@luke/panel/desktop/pane-motion";
import type { IssueChange } from "@luke/panel/desktop/use-issues";
import { EDGE_SIDE, useResizableEdge } from "@luke/panel/desktop/use-resizable-edge";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { CloseIcon, ExpandIcon, IconButton } from "@luke/ui";
import { Schema } from "effect";
import type React from "react";
import { useState } from "react";
import { DocumentScroll } from "../tasks/document-frame";
import { Tooltip } from "../tooltip";
import { readKept, writeKept } from "./folded-groups";
import { IssueDocument, IssueMenu } from "./issue-detail";

/**
 * issue-peek.tsx -- one issue read beside the Issues board or list rather than in its place: the issue's own document under a head of its identifier, Open as page, its ⋯ menu, and Close.
 *
 * A press or Return on a card or row peeks its issue, and ⌘ held with
 * either opens its page instead (`openingOf`). The peek is a pane of the
 * Issues page's own, docked at its right as an automation's Runs are
 * (`automation-runs-panel.tsx`), not a tab of the window's side panel,
 * whose tabs are a task's: it slides in and out on the window's pane
 * motion (`usePaneSlide`), the board or list narrowing beside it at once,
 * and its left edge resizes it, its width kept on this Mac, a drag past
 * its least width closing it. It draws the issue the list holds, so
 * moving through the cards with the peek following reads nothing, and a
 * change is sent through the list, which holds what was kept the moment
 * it lands. Escape, or Close, puts it away. A window with no room for it
 * beside a column of the board opens the issue's page instead
 * (`peekFits`), and a peek the window narrows past that room is put away.
 */

/** How an issue is opened from its card or row: read beside the board, or on its own page in the board's place. */
export const ISSUE_OPENING = {
  PEEK: "peek",
  PAGE: "page",
} as const;

export type IssueOpening = (typeof ISSUE_OPENING)[keyof typeof ISSUE_OPENING];

/** How wide the peek may stand, in CSS pixels, and where it starts: a document's narrow measure, as wide as the side panel's least at most. */
const PEEK_WIDTH = {
  MIN: 360,
  MAX: 720,
  DEFAULT: 440,
} as const;

/** What the peek leaves the board or list beside it: a column of the board, a card's least width, and the page's insets either side. */
const PEEK_RESERVE = 320;

/** Where the peek's width is kept in the renderer's storage. */
const WIDTH_KEY = "luke.issuePeekWidth";

const storedWidth = Schema.fromJsonString(Schema.Finite);

/** What the peek is called, as a region and as its head's words before the identifier. */
const PEEK_LABEL = "Issue peek";

/** How a press opens an issue: its page where ⌘ is held, its peek otherwise. */
export function openingOf(event: { readonly metaKey: boolean }): IssueOpening {
  return event.metaKey ? ISSUE_OPENING.PAGE : ISSUE_OPENING.PEEK;
}

/**
 * Whether a key on a card or row is ⌘Return, which opens the issue's page.
 * Note that a Return choosing a word the input method composes is the
 * method's, though nothing on a card takes typing.
 */
export function pageKey(event: React.KeyboardEvent): boolean {
  return event.key === "Enter" && event.metaKey && !event.nativeEvent.isComposing;
}

/** Whether the Issues page is wide enough for the peek at its least beside a column of the board. */
export function peekFits(page: HTMLElement): boolean {
  return page.clientWidth >= PEEK_WIDTH.MIN + PEEK_RESERVE;
}

/** A width held within the peek's bounds, in whole pixels. */
function clampWidth(width: number): number {
  return Math.min(PEEK_WIDTH.MAX, Math.max(PEEK_WIDTH.MIN, Math.round(width)));
}

/** How wide the peek stands, and the drag that asks for another width. */
export interface PeekWidth {
  /** Always within {@link PEEK_WIDTH}. */
  width: number;
  onResize: (width: number) => void;
}

/** The peek's width, the default until first dragged, and kept as it is. */
export function usePeekWidth(): PeekWidth {
  const [width, setWidth] = useState(() =>
    clampWidth(readKept(WIDTH_KEY, storedWidth, PEEK_WIDTH.DEFAULT)),
  );
  return {
    width,
    onResize: (asked) => {
      const next = clampWidth(asked);
      setWidth(next);
      writeKept(WIDTH_KEY, storedWidth, next);
    },
  };
}

/** The peek's head, the window's drag handle wherever no control stands: the issue's identifier, then Open as page, its ⋯ menu, and Close. */
function PeekHead({
  issue,
  identifier,
  standing,
  onChange,
  onClose,
  onOpenPage,
}: {
  issue: Issue;
  identifier: string;
  /** Whether the peek still stands, rather than sliding out, which its menu and Archive's question do not outlive. */
  standing: boolean;
  onChange: (change: IssueChange) => Promise<boolean>;
  onClose: () => void;
  onOpenPage: () => void;
}): React.JSX.Element {
  return (
    <header className="issue-peek-head">
      <h2 className="issue-peek-identifier">{identifier}</h2>
      <div className="issue-peek-actions">
        <Tooltip label="Open as page">
          <IconButton icon={<ExpandIcon />} label="Open as page" onClick={onOpenPage} />
        </Tooltip>
        <IssueMenu
          issue={issue}
          identifier={identifier}
          surfaceOpen={standing}
          onChange={onChange}
          onArchived={onClose}
        />
        <Tooltip label="Close" command={APP_COMMAND.EXIT_ISSUES}>
          <IconButton icon={<CloseIcon />} label="Close" onClick={onClose} />
        </Tooltip>
      </div>
    </header>
  );
}

/**
 * The peek: the issue given, or nothing while none is peeked. It is drawn
 * by whoever outlives it, so a peek put away is held drawn, its last issue
 * still in it, through its slide out, and its edge still hears a drag that
 * closed it coming back.
 */
export function IssuePeek({
  issue,
  workspaceName,
  width,
  onChange,
  onClose,
  onOpenPage,
}: {
  issue: Issue | undefined;
  workspaceName: string;
  width: PeekWidth;
  /** Sends a change to the issue peeked, answering whether it was kept. */
  onChange: (change: IssueChange) => Promise<boolean>;
  onClose: () => void;
  onOpenPage: (issue: Issue) => void;
}): React.JSX.Element | null {
  // Escape puts the peek away before it leaves the Issues page, being offered after the page's own.
  useAppCommand(APP_COMMAND.EXIT_ISSUES, issue === undefined ? undefined : onClose);
  const [last, setLast] = useState(issue);
  if (issue !== undefined && issue !== last) setLast(issue);
  const edge = useResizableEdge({
    side: EDGE_SIDE.LEFT,
    width: width.width,
    bounds: PEEK_WIDTH,
    reserve: () => PEEK_RESERVE,
    label: "Resize issue peek",
    onResize: width.onResize,
    onToggleCollapsed: issue === undefined ? undefined : onClose,
  });
  const slide = usePaneSlide(issue !== undefined);
  const drawn = issue ?? last;
  if (!slide.drawn || drawn === undefined) return null;
  const identifier = issueIdentifier(workspaceName, drawn.number);
  return (
    <div
      ref={(node) => {
        slide.pane.current = node;
      }}
      className="issue-peek-pane"
      data-leaving={slide.leaving ? "" : undefined}
      inert={slide.leaving}
      style={{ width: width.width }}
    >
      <div className="side-panel-resize" {...edge} />
      {/* Keyed by the issue, so a title or description being written in one is never sent as another's. */}
      <aside key={drawn.id} className="issue-peek" aria-label={`${PEEK_LABEL}: ${identifier}`}>
        <PeekHead
          issue={drawn}
          identifier={identifier}
          standing={issue !== undefined}
          onChange={onChange}
          onClose={onClose}
          onOpenPage={() => onOpenPage(drawn)}
        />
        {/* The issue scrolls in the column every document of the window does, at the peek's own width. */}
        <div className="desktop-document">
          <DocumentScroll>
            <IssueDocument issue={drawn} onChange={onChange} />
          </DocumentScroll>
        </div>
      </aside>
    </div>
  );
}
