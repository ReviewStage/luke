import {
  ISSUE_BOUNDS,
  ISSUE_PRIORITY,
  ISSUE_STATUS,
  type IssuePriority,
  type IssueStatus,
} from "@luke/features/issue-wire";
import { SHORTCUT_KEY, type ShortcutChord, shortcutAria } from "@luke/settings/shortcuts";
import { BUTTON_VARIANT, Button, DIALOG_SIZE, Dialog, ErrorState } from "@luke/ui";
import { useRef, useState } from "react";
import { Shortcut } from "../shortcut";
import { PriorityMenu, StatusMenu } from "./issue-pickers";

/**
 * new-issue-dialog.tsx -- a new issue, asked for over the window as a new task is: its title, and where it stands and how much it matters.
 *
 * It is the New task card's own frame (`tasks/new-task-dialog.tsx`): the
 * window's one modal, its name field taking the keyboard, the issue's two
 * chips under it as its page draws them, and Cancel and Create at its foot. Return in the title files the issue, and
 * Escape, Cancel, or a press outside puts the card away unfiled. A filing
 * the service refused keeps every word and says so under the field; one
 * it kept closes the card.
 */

/** Create issue's chord: Return alone, from the title field. */
const CREATE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER, bare: true };

/** What a filing the service did not take says under the field. */
const UNFILED_LINE = "Couldn't create the issue. Try again.";

/** What a new issue is filed with. */
export interface IssueDraft {
  readonly title: string;
  readonly status: IssueStatus;
  readonly priority: IssuePriority;
}

/** The card with its own state, mounted afresh on each opening so a cancelled title is never offered again. */
function NewIssueCard({
  status: chosen,
  onCreate,
  onClose,
}: {
  status: IssueStatus;
  onCreate: (draft: IssueDraft) => Promise<boolean>;
  onClose: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<IssueStatus>(chosen);
  const [priority, setPriority] = useState<IssuePriority>(ISSUE_PRIORITY.NONE);
  const [creating, setCreating] = useState(false);
  const [refused, setRefused] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const canCreate = !creating && title.trim() !== "";

  const create = () => {
    if (!canCreate) return;
    setCreating(true);
    setRefused(false);
    onCreate({ title: title.trim(), status, priority }).then((created) => {
      setCreating(false);
      if (created) onClose();
      else setRefused(true);
    });
  };
  const close = () => {
    if (!creating) onClose();
  };

  return (
    <Dialog
      size={DIALOG_SIZE.WIDE}
      title="New issue"
      busy={creating}
      initialFocus={field}
      onDismiss={close}
      actions={
        <>
          <Button variant={BUTTON_VARIANT.QUIET} disabled={creating} onClick={close}>
            Cancel
          </Button>
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            aria-keyshortcuts={shortcutAria(CREATE_CHORD)}
            disabled={title.trim() === ""}
            busy={creating}
            busyLabel="Creating"
            onClick={create}
          >
            Create issue
            <Shortcut chord={CREATE_CHORD} />
          </Button>
        </>
      }
    >
      <div className="new-issue ph-no-capture">
        <input
          ref={field}
          type="text"
          className="dialog-name-field"
          aria-label="New issue title"
          aria-keyshortcuts={shortcutAria(CREATE_CHORD)}
          placeholder="Issue title"
          maxLength={ISSUE_BOUNDS.MAX_TITLE_CHARS}
          spellCheck
          value={title}
          disabled={creating}
          onChange={(event) => setTitle(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            create();
          }}
        />
        <div className="issue-properties">
          <StatusMenu status={status} disabled={creating} onPick={setStatus} />
          <PriorityMenu priority={priority} disabled={creating} onPick={setPriority} />
        </div>
        {refused ? <ErrorState>{UNFILED_LINE}</ErrorState> : null}
      </div>
    </Dialog>
  );
}

/** The card over the window while a new issue is asked for, its Status chip on the status asked with or Backlog; nothing otherwise. */
export function NewIssueDialog({
  open,
  status = ISSUE_STATUS.BACKLOG,
  onCreate,
  onClose,
}: {
  open: boolean;
  /** The status the card opens on: the column's whose + opened it. */
  status?: IssueStatus | undefined;
  onCreate: (draft: IssueDraft) => Promise<boolean>;
  onClose: () => void;
}): React.JSX.Element | null {
  if (!open) return null;
  return <NewIssueCard status={status} onCreate={onCreate} onClose={onClose} />;
}
