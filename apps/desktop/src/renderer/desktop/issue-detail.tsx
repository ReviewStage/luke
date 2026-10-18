import { issueIdentifier } from "@luke/features/issue-list-model";
import { ISSUE_BOUNDS, type Issue } from "@luke/features/issue-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BREADCRUMBS_VARIANT,
  Breadcrumbs,
  ConfirmDialog,
  DetailPage,
  EllipsisIcon,
  IconButton,
  PAGE_FRAME,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { ListTodoIcon } from "lucide-react";
import { useRef } from "react";
import { ActorRef } from "../actor-ref";
import { useAppCommand } from "../app-commands";
import { useCopyLinkItem } from "../copy-link-item";
import { ExperimentTag } from "../experiment-marks";
import { usePerson } from "../member-directory";
import { RelativeTime } from "../tasks/relative-time";
import { useMinute } from "../tasks/task-time";
import { Tooltip } from "../tooltip";
import { ActionMenu } from "./action-menu";
import {
  archiveAnswered,
  archiveItem,
  archiveQuestion,
  ISSUE_ACTIONS_LABEL,
} from "./issue-actions";
import { IssueDescription } from "./issue-description";
import { PriorityMenu, StatusMenu } from "./issue-pickers";
import { IssueWorkRow, useStartTaskItem } from "./issue-work";
import type { IssueChange } from "./use-issues";

/**
 * issue-detail.tsx -- one issue's page: its identifier, its title renamed in place, who filed it and when it was filed and last changed, its status and priority changed from their chips, the tasks started from it, its description written in place, a task started from it, its link copied, and its archive.
 *
 * Every change is sent at once and the page draws the issue the service
 * answers, so what stands is what was kept; a change the service refused
 * leaves the issue as it stood and says so in a toast the page raises.
 * Archiving asks first, and once it lands the page goes back to the list,
 * which no longer holds the issue.
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

/** The toolbar: the path back to the list, and the issue's ⋯ menu: Start task…, Copy link, and Archive. */
function DetailToolbar({
  issue,
  identifier,
  onBack,
  onArchive,
}: {
  issue: Issue;
  identifier: string;
  onBack: () => void;
  onArchive: () => void;
}): React.JSX.Element {
  const menu = useMenu(true);
  const startTask = useStartTaskItem(issue, identifier);
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.ISSUE, issueId: issue.id });
  const archive = archiveItem(onArchive);
  const groups = [
    ...(startTask === undefined ? [] : [[startTask]]),
    ...(copyLink === undefined ? [] : [[copyLink]]),
    [archive],
  ];
  return (
    <header className="desktop-toolbar">
      <div className="desktop-toolbar-heading">
        <IssueCrumbs identifier={identifier} onBack={onBack} />
        <ExperimentTag />
      </div>
      <div className="desktop-toolbar-actions">
        <Tooltip label={ISSUE_ACTIONS_LABEL}>
          <IconButton icon={<EllipsisIcon />} label={ISSUE_ACTIONS_LABEL} {...menu.trigger()} />
        </Tooltip>
        {menu.drawn === undefined ? null : (
          <ActionMenu
            label={ISSUE_ACTIONS_LABEL}
            menu={menu.drawn}
            groups={groups}
            onClose={menu.close}
          />
        )}
      </div>
    </header>
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
 * in a task's own words (`task-actions.tsx`'s menu foot): "Created by
 * [Charles] Charles Pan · 3d ago" and "Last edited · 2h ago", the times
 * moving on with the window's minute. An issue whose creator's account is
 * gone says only when it was created, and one unchanged since it was filed
 * says nothing of an edit.
 */
function IssueByline({ issue }: { issue: Issue }): React.JSX.Element {
  const now = useMinute();
  const creator = usePerson(issue.creator ?? undefined);
  return (
    <p className="issue-byline">
      <span className="actor-line">
        {issue.creator === null ? "Created" : "Created by "}
        {issue.creator === null ? null : <ActorRef actor={creator} sentence />}
        {" · "}
        <RelativeTime at={issue.createdAt} now={now} ago />
      </span>
      {/* Note that the space between the phrases is read, not drawn: the line's gap draws it. */}
      {issue.updatedAt <= issue.createdAt ? null : (
        <>
          {" "}
          <span className="actor-line">
            {"Last edited · "}
            <RelativeTime at={issue.updatedAt} now={now} ago />
          </span>
        </>
      )}
    </p>
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
  const archiving = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    onChange({ archived: true }).then((archived) => {
      if (archived) onBack();
      return archiveAnswered(archived);
    }),
  );
  const identifier = issueIdentifier(workspaceName, issue.number);
  return (
    <>
      <DetailPage
        frame={PAGE_FRAME.TOOLBAR}
        label={identifier}
        toolbar={
          <DetailToolbar
            issue={issue}
            identifier={identifier}
            onBack={onBack}
            onArchive={archiving.ask}
          />
        }
      >
        {/* The issue is drawn as a task's document is (`version-view.tsx`): its title, then its body, at the document's measure. */}
        <div className="desktop-document issue-document">
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
        </div>
      </DetailPage>
      <ConfirmDialog confirm={archiving} question={archiveQuestion(identifier)} />
    </>
  );
}

/**
 * One issue's page while its issue is first read, opened from a link or a
 * notification before the list holds it: the page's own document, a block
 * where the title will stand in its heading's type, one for the line under
 * it, the two chips' boxes, and a few lines of description, so the issue
 * lands where the blocks stood. The region says what is being read.
 */
export function IssueDetailSkeleton({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="desktop-document issue-document">
      <SkeletonRegion label={label}>
        <div className="plan-body">
          <div className="markdown task-title">
            <div className="markdown-heading task-title-text" data-level="1">
              <Skeleton width={SKELETON_TITLE} />
            </div>
          </div>
          <div className="issue-byline">
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
    </div>
  );
}
