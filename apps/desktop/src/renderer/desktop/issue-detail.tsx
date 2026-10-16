import { issueIdentifier } from "@luke/features/issue-list-model";
import { ISSUE_BOUNDS, type Issue } from "@luke/features/issue-wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { ArchiveIcon, EllipsisIcon, ListTodoIcon } from "lucide-react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { ConfirmDialog, useConfirmDialog } from "../settings/confirm-dialog";
import { Tooltip } from "../tooltip";
import { ActionMenu, type MenuAction, useActionMenu } from "./action-menu";
import { IssueDescription } from "./issue-description";
import { PriorityMenu, StatusMenu } from "./issue-pickers";
import { TaskNameField, useTaskRename } from "./task-name-field";
import type { IssueChange } from "./use-issues";

/**
 * issue-detail.tsx -- one issue's page: its identifier, its title renamed in place, its status and priority changed from their chips, its description written in place, and its archive.
 *
 * Every change is sent at once and the page draws the issue the service
 * answers, so what stands is what was kept; a change the service refused
 * leaves the issue as it stood and says so in a toast the page raises.
 * Archiving asks first, and once it lands the page goes back to the list,
 * which no longer holds the issue.
 */

/** What the ⋯ menu is called. */
const ACTIONS_LABEL = "Issue actions";

/** The toolbar: the way back to the list, the issue's identifier, and its ⋯ menu. */
function DetailToolbar({
  identifier,
  onBack,
  onArchive,
}: {
  identifier: string;
  onBack: () => void;
  onArchive: () => void;
}): React.JSX.Element {
  const menu = useActionMenu(true);
  const archive: MenuAction = {
    label: "Archive",
    icon: <ArchiveIcon />,
    onSelect: onArchive,
    danger: true,
  };
  return (
    <header className="desktop-toolbar">
      <div className="desktop-toolbar-heading">
        <button type="button" className="toolbar-button" onClick={onBack}>
          <ListTodoIcon />
          Issues
        </button>
        <span className="issue-crumb">{identifier}</span>
      </div>
      <div className="desktop-toolbar-actions">
        <Tooltip label={ACTIONS_LABEL}>
          <button
            type="button"
            className="icon-button"
            aria-label={ACTIONS_LABEL}
            {...menu.trigger()}
          >
            <EllipsisIcon />
          </button>
        </Tooltip>
        {menu.drawn === undefined ? null : (
          <ActionMenu
            label={ACTIONS_LABEL}
            menu={menu.drawn}
            groups={[[archive]]}
            onClose={menu.close}
          />
        )}
      </div>
    </header>
  );
}

/** The title, a press away from its field. */
function IssueTitle({
  issue,
  onChange,
}: {
  issue: Issue;
  onChange: (change: IssueChange) => Promise<boolean>;
}): React.JSX.Element {
  const rename = useTaskRename(issue.id, (_, title) => onChange({ title }));
  return rename.editing ? (
    <TaskNameField
      name={issue.title}
      className="issue-title-field"
      label="Issue title"
      maxLength={ISSUE_BOUNDS.MAX_TITLE_CHARS}
      onEnd={rename.end}
    />
  ) : (
    <h1 className="issue-title">
      <button type="button" className="issue-title-button" onClick={rename.begin}>
        {issue.title}
      </button>
    </h1>
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
    onChange({ archived: true }).then((archived): ActionResult => {
      if (!archived) {
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: "Couldn't archive it. Try again." };
      }
      onBack();
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    }),
  );
  const identifier = issueIdentifier(workspaceName, issue.number);
  return (
    <section className="issues-view" aria-label={identifier}>
      <DetailToolbar identifier={identifier} onBack={onBack} onArchive={archiving.ask} />
      <div className="issues-scroll scroll-fade-top">
        <article className="issue-detail">
          <IssueTitle issue={issue} onChange={onChange} />
          <div className="issue-properties">
            <StatusMenu status={issue.status} onPick={(status) => void onChange({ status })} />
            <PriorityMenu
              priority={issue.priority}
              onPick={(priority) => void onChange({ priority })}
            />
          </div>
          <IssueDescription
            description={issue.description}
            onSave={(description) => onChange({ description })}
          />
        </article>
      </div>
      <ConfirmDialog
        confirm={archiving}
        question={{
          title: `Archive ${identifier}?`,
          body: "It leaves the list. Nothing else about it changes.",
          verb: "Archive",
          running: "Archiving",
        }}
      />
    </section>
  );
}
