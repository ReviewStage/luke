import { issueIdentifier } from "@luke/features/issue-list-model";
import type { Issue } from "@luke/features/issue-wire";
import { useAppCommand } from "@luke/panel/app-commands";
import { IssueDocument, IssueMenu } from "@luke/panel/desktop/issue-detail";
import { StatusGlyph } from "@luke/panel/desktop/issue-pickers";
import { Tab, TabStrip } from "@luke/panel/desktop/tab-strip";
import type { IssueChange } from "@luke/panel/desktop/use-issues";
import { DocumentScroll } from "@luke/panel/tasks/document-frame";
import { SIDE_PANEL_WIDTH, type SidePanelControl } from "@luke/panel/tasks/use-side-panel";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import type React from "react";
import { useState } from "react";
import { PANEL_LEAVING, PanelFrame, useSidePanelDrawing } from "./side-panel";

/**
 * issue-peek.tsx -- one issue read beside the Issues board or list rather than in its place: the issue's own document under a head of its identifier, Open as page, its ⋯ menu, and Close.
 *
 * A press or Return on a card or row peeks its issue, and ⌘ held with
 * either opens its page instead (`openingOf`). The peek is the window's
 * side panel standing beside the Issues page, as it stands beside the
 * Inbox for the chosen item's task: its frame, its top row, its
 * full-screen button, its resize edge, and its motion are the panel's own
 * (`PanelFrame`), and so are whether it is open, how wide it stands, and
 * whether it fills the page, so the title bar's toggle and ⌥⌘B show and
 * hide it as they do the panel anywhere. Its one tab is the issue, whose ×
 * closes the panel as closing a panel's last tab does, and the chosen
 * tab's ⋯ is the issue's own menu, Open as page among it. It draws the
 * issue the list holds, so moving through the cards with the peek
 * following reads nothing, and a change is sent through the list, which
 * holds what was kept the moment it lands. Escape steps out of full
 * screen, then puts the peek away. A window with no room for the panel
 * beside a column of the board opens the issue's page instead
 * (`peekFits`), and a peek the window narrows past that room is put away.
 */

/** How an issue is opened from its card or row: read beside the board, or on its own page in the board's place. */
export const ISSUE_OPENING = {
  PEEK: "peek",
  PAGE: "page",
} as const;

export type IssueOpening = (typeof ISSUE_OPENING)[keyof typeof ISSUE_OPENING];

/**
 * What the peek leaves the board or list beside it: a column of the board, a
 * card's least width, and the page's insets either side. It is the Issues
 * page's `--document-reserve` (issues.css), which the panel's edge and its
 * width read as the plan's.
 */
const PEEK_RESERVE = 320;

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
  return page.clientWidth >= SIDE_PANEL_WIDTH.MIN + PEEK_RESERVE;
}

/**
 * The peek: the window's side panel beside the Issues page, drawing the issue
 * given, while the panel is open and one is peeked. A panel shut is held
 * drawn through its exit with the issue it last drew, and an issue put away
 * with the panel open draws nothing.
 */
export function IssuePeek({
  panel,
  issue,
  workspaceName,
  onChange,
  onClose,
  onOpenPage,
}: {
  /** The window's side panel: whether the peek stands, how wide, and whether it fills the page. */
  panel: SidePanelControl;
  issue: Issue | undefined;
  workspaceName: string;
  /** Sends a change to the issue peeked, answering whether it was kept. */
  onChange: (change: IssueChange) => Promise<boolean>;
  /** Shuts the panel, handing the keyboard back to the issue's card. */
  onClose: () => void;
  onOpenPage: (issue: Issue) => void;
}): React.JSX.Element | null {
  const drawing = useSidePanelDrawing(panel);
  const standing = drawing.panel !== undefined && issue !== undefined;
  // Escape steps out of full screen first, then puts the peek away, before it leaves the Issues page.
  useAppCommand(
    APP_COMMAND.EXIT_ISSUES,
    !standing || drawing.leaving !== PANEL_LEAVING.NONE
      ? undefined
      : panel.fullScreen
        ? panel.onToggleFullScreen
        : onClose,
  );
  const [last, setLast] = useState(issue);
  if (issue !== undefined && issue !== last) setLast(issue);
  const leaving = drawing.leaving !== PANEL_LEAVING.NONE;
  // Note that a panel shut is held drawn through its exit with the issue it last drew.
  const drawn = issue ?? (leaving ? last : undefined);
  if (drawing.panel === undefined || drawn === undefined) return null;
  const identifier = issueIdentifier(workspaceName, drawn.number);
  return (
    <PanelFrame
      panel={drawing.panel}
      leaving={drawing.leaving}
      onLeft={drawing.onLeft}
      edge={drawing.edge}
      label="Panel"
      tabs={
        <div className="side-panel-tabs">
          <TabStrip label="Panel">
            <Tab
              icon={<StatusGlyph status={drawn.status} />}
              label={identifier}
              detail={drawn.title}
              selected
              quiet
              onSelect={() => undefined}
              onClose={onClose}
            />
          </TabStrip>
        </div>
      }
      actions={
        <span className="toolbar-tab-actions">
          {/* Keyed by the issue, so Archive's question asked of one is never answered for another. */}
          <IssueMenu
            key={drawn.id}
            issue={drawn}
            identifier={identifier}
            surfaceOpen={!leaving}
            onChange={onChange}
            onArchived={onClose}
            onOpenPage={() => onOpenPage(drawn)}
          />
        </span>
      }
    >
      {/* Keyed by the issue, so a title or description being written in one is never sent as another's. */}
      <div key={drawn.id} className="side-panel-content" role="tabpanel" aria-label={identifier}>
        {/* The issue scrolls in the column every document of the window does, at the panel's width. */}
        <div className="desktop-document">
          <DocumentScroll>
            <IssueDocument issue={drawn} onChange={onChange} />
          </DocumentScroll>
        </div>
      </div>
    </PanelFrame>
  );
}
