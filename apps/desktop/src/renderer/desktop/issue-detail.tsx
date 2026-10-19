import { issueIdentifier } from "@luke/features/issue-list-model";
import { ISSUE_BOUNDS, type Issue } from "@luke/features/issue-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import { useAppCommand } from "@luke/panel/app-commands";
import { useCopyLinkItem } from "@luke/panel/copy-link-item";
import { ActionMenu, type MenuAction } from "@luke/panel/desktop/action-menu";
import { PriorityMenu, StatusMenu } from "@luke/panel/desktop/issue-pickers";
import type { IssueChange } from "@luke/panel/desktop/use-issues";
import { ExperimentTag } from "@luke/panel/experiment-marks";
import { usePerson } from "@luke/panel/member-directory";
import { RelativeTime } from "@luke/panel/tasks/relative-time";
import { useMinute } from "@luke/panel/tasks/task-time";
import { Tooltip } from "@luke/panel/tooltip";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  ArrowUpRightIcon,
  BREADCRUMBS_VARIANT,
  Breadcrumbs,
  ConfirmDialog,
  EllipsisIcon,
  IconButton,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { ListTodoIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { DocumentByline, DocumentScroll } from "../tasks/document-frame";
import {
  archiveAnswered,
  archiveItem,
  archiveQuestion,
  ISSUE_ACTIONS_LABEL,
} from "./issue-actions";
import { IssueDescription } from "./issue-description";
import { IssueWorkRow, useStartItems } from "./issue-work";

/**
 * issue-detail.tsx -- one issue's page: its identifier, its title renamed in place, who filed it and when it was filed and last changed, its status and priority changed from their chips, the tasks started from it, its description written in place, a task started from it, its link copied, and its archive.
 *
 * The issue itself (`IssueDocument`) and its ⋯ menu (`IssueMenu`) are
 * drawn by the peek beside the board as well (`issue-peek.tsx`), so the
 * two never differ. Every change is sent at once and the page draws the issue the service
 * answers, so what stands is what was kept; a change the service refused
 * leaves the issue as it stood and says so in a toast the page raises.
 * Archiving asks first, and once it lands the page goes back to the list,
 * which no longer holds the issue. The issue is a document, drawn as a
 * plan is (`../tasks/document-frame.tsx`): it scrolls in the plan's own
 * column, at its measure and inset, its title, byline, and text in the
 * plan's type, so a plan and an issue stand alike.
 */

/** How wide the placeholder title and the line under it stand, as shares of their lines. */
const SKELETON_TITLE = "55%";
const SKELETON_BYLINE = "40%";

/** How wide the placeholder Status and Priority chips stand, as wide as a chip naming one. */
const SKELETON_CHIPS = ["112px", "96px"] as const;

/** How wide each placeholder line of the description stands, as a share of its line. */
const SKELETON_DESCRIPTION = ["92%", "86%", "64%"] as const;

/**
 * The toolbar's path, as the automation editor's: the Issues list a press
 * away, and the issue's identifier where one stands.
 */
export function IssueCrumbs({
  identifier,
  onBack,
}: {
  identifier?: string | undefined;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <Breadcrumbs
      label="Path"
      variant={BREADCRUMBS_VARIANT.TITLE}
      hint={Tooltip}
      crumbs={[
        { label: "Issues", icon: <ListTodoIcon />, onPress: onBack },
        ...(identifier === undefined ? [] : [{ label: identifier, current: true }]),
      ]}
    />
  );
}

/**
 * The issue's ⋯ menu, on its page's toolbar and in its peek's top row: Open
 * as page where it stands in the peek, Start task… and Start agent…, Copy
 * link, and Archive, which asks first and, once kept, hands back to
 * `onArchived`, since the issue no longer stands where it was drawn.
 */
export function IssueMenu({
  issue,
  identifier,
  surfaceOpen = true,
  onChange,
  onArchived,
  onOpenPage,
}: {
  issue: Issue;
  identifier: string;
  /** Whether what it hangs from still stands, which its menu and question do not outlive: a page for as long as it does, a peek until it starts to leave. */
  surfaceOpen?: boolean;
  /** Sends a change, answering whether it was kept. */
  onChange: (change: IssueChange) => Promise<boolean>;
  onArchived: () => void;
  /** Opens the issue on its own page, from the peek; none on the page itself. */
  onOpenPage?: (() => void) | undefined;
}): React.JSX.Element {
  const menu = useMenu(surfaceOpen);
  const openPage: MenuAction | undefined =
    onOpenPage === undefined
      ? undefined
      : { label: "Open as page", icon: <ArrowUpRightIcon />, onSelect: onOpenPage };
  const starts = useStartItems(issue, identifier);
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.ISSUE, issueId: issue.id });
  const archiving = useConfirmDialog({ subject: true, surfaceOpen }, () =>
    onChange({ archived: true }).then((archived) => {
      if (archived) onArchived();
      return archiveAnswered(archived);
    }),
  );
  const archive = archiveItem(archiving.ask);
  return (
    <>
      <Tooltip label={ISSUE_ACTIONS_LABEL}>
        <IconButton icon={<EllipsisIcon />} label={ISSUE_ACTIONS_LABEL} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={ISSUE_ACTIONS_LABEL}
          menu={menu.drawn}
          groups={[
            ...(openPage === undefined ? [] : [[openPage]]),
            ...(starts.length === 0 ? [] : [starts]),
            ...(copyLink === undefined ? [] : [[copyLink]]),
            [archive],
          ]}
          onClose={menu.close}
        />
      )}
      <ConfirmDialog confirm={archiving} question={archiveQuestion(identifier)} />
    </>
  );
}

/**
 * The title, drawn and edited where it stands in the task page's own
 * heading (`plan-document-editor.tsx`): Return or a press elsewhere keeps
 * what was typed, Escape the title it opened on, and a title left empty or
 * unchanged renames nothing.
 */
function IssueTitle({
  issue,
  onChange,
}: {
  issue: Issue;
  onChange: (change: IssueChange) => Promise<boolean>;
}): React.JSX.Element {
  const text = useRef<HTMLDivElement>(null);
  // Note that each edit is counted, so a refusal of one a later edit has replaced puts nothing back over it.
  const edits = useRef(0);
  const putBack = () => {
    if (text.current !== null) text.current.textContent = issue.title;
  };
  const keep = () => {
    edits.current += 1;
    const edit = edits.current;
    const typed = (text.current?.textContent ?? "").trim().slice(0, ISSUE_BOUNDS.MAX_TITLE_CHARS);
    if (typed === "" || typed === issue.title) {
      putBack();
      return;
    }
    onChange({ title: typed }).then((kept) => {
      if (!kept && edit === edits.current && document.activeElement !== text.current) putBack();
    });
  };
  return (
    <div className="markdown task-title ph-no-capture">
      {/* biome-ignore lint/a11y/useSemanticElements: the title is edited in the heading's own look, which wraps as a heading does; an input cannot. */}
      <div
        ref={text}
        className="markdown-heading task-title-text"
        data-level="1"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        role="textbox"
        aria-label="Issue title"
        tabIndex={0}
        spellCheck
        onBlur={keep}
        onFocus={() => {
          edits.current += 1;
        }}
        onKeyDown={(event) => {
          // Note that a Return choosing a word the input method composes is the method's, not the title's.
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            text.current?.blur();
          }
          // Note that Escape goes no further than the title, because the window's own Escape would leave the issue as well.
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            putBack();
            text.current?.blur();
          }
        }}
      >
        {issue.title}
      </div>
    </div>
  );
}

/**
 * Who filed the issue and when, and when it last changed, under its title,
 * in the line every document draws there (`DocumentByline`): "Created by
 * [Charles] Charles Pan · 3d ago" and "Last edited · 2h ago", the times
 * moving on with the window's minute. An issue whose creator's account is
 * gone says only when it was created, and one unchanged since it was filed
 * says nothing of an edit.
 */
function IssueByline({ issue }: { issue: Issue }): React.JSX.Element {
  const now = useMinute();
  const creator = usePerson(issue.creator ?? undefined);
  return (
    <DocumentByline
      creator={issue.creator === null ? undefined : creator}
      createdAt={issue.createdAt}
      now={now}
      edited={
        issue.updatedAt <= issue.createdAt ? undefined : (
          <>
            {"Last edited · "}
            <RelativeTime at={issue.updatedAt} now={now} ago />
          </>
        )
      }
    />
  );
}

/**
 * An issue's page: its toolbar over its document, which scrolls in the
 * column every document of the window does (`DocumentScroll`), so the
 * issue, and its blocks while it is read, stand at a plan's measure and
 * inset rather than in a page frame of their own.
 */
export function IssueDocumentPage({
  label,
  toolbar,
  children,
}: {
  label: string;
  toolbar: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="issue-page" aria-label={label}>
      {toolbar}
      <div className="desktop-document">
        <DocumentScroll>{children}</DocumentScroll>
      </div>
    </section>
  );
}

/**
 * The issue itself, wherever it is drawn, its page or its peek beside the
 * board: its title, who filed it and when, its Status and Priority chips,
 * the tasks started from it, and its description, in a plan's own type; its
 * page and its peek each scroll it in the column every document of the
 * window does (`DocumentScroll`).
 */
export function IssueDocument({
  issue,
  onChange,
}: {
  issue: Issue;
  /** Sends a change, answering whether it was kept. */
  onChange: (change: IssueChange) => Promise<boolean>;
}): React.JSX.Element {
  return (
    <article className="plan-body">
      <IssueTitle issue={issue} onChange={onChange} />
      <IssueByline issue={issue} />
      <div className="issue-properties">
        <StatusMenu status={issue.status} onPick={(status) => void onChange({ status })} />
        <PriorityMenu
          priority={issue.priority}
          onPick={(priority) => void onChange({ priority })}
        />
      </div>
      <IssueWorkRow issue={issue} />
      <IssueDescription
        description={issue.description}
        onSave={(description) => onChange({ description })}
      />
    </article>
  );
}

/** One issue's page, drawn from the issue as the service last answered it. */
export function IssueDetail({
  issue,
  workspaceName,
  onChange,
  onBack,
}: {
  issue: Issue;
  workspaceName: string;
  /** Sends a change, answering whether it was kept. */
  onChange: (change: IssueChange) => Promise<boolean>;
  onBack: () => void;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_ISSUES, onBack);
  const identifier = issueIdentifier(workspaceName, issue.number);
  return (
    <IssueDocumentPage
      label={identifier}
      toolbar={
        <header className="desktop-toolbar">
          <div className="desktop-toolbar-heading">
            <IssueCrumbs identifier={identifier} onBack={onBack} />
            <ExperimentTag />
          </div>
          <div className="desktop-toolbar-actions">
            <IssueMenu
              issue={issue}
              identifier={identifier}
              onChange={onChange}
              onArchived={onBack}
            />
          </div>
        </header>
      }
    >
      <IssueDocument issue={issue} onChange={onChange} />
    </IssueDocumentPage>
  );
}

/**
 * One issue's document while its issue is first read, opened from a link or a
 * notification before the list holds it, for `IssueDocumentPage`: a block
 * where the title will stand in its heading's type, one for the line under
 * it, the two chips' boxes, and a few lines of description, so the issue
 * lands where the blocks stood. The region says what is being read.
 */
export function IssueDetailSkeleton({ label }: { label: string }): React.JSX.Element {
  return (
    <SkeletonRegion label={label}>
      <div className="plan-body">
        <div className="markdown task-title">
          <div className="markdown-heading task-title-text" data-level="1">
            <Skeleton width={SKELETON_TITLE} />
          </div>
        </div>
        <div className="plan-byline">
          <Skeleton width={SKELETON_BYLINE} />
        </div>
        <div className="issue-properties">
          {SKELETON_CHIPS.map((width) => (
            <Skeleton key={width} shape={SKELETON_SHAPE.CONTROL} width={width} />
          ))}
        </div>
        <div>
          {SKELETON_DESCRIPTION.map((width) => (
            <Skeleton key={width} width={width} />
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}
