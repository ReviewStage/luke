import { DIALOG_SIZE, Dialog } from "@luke/ui";
import { type RefObject, useId, useMemo, useRef, useState } from "react";
import { MENTION_MENU_SIDE } from "./mention-picker.js";
import { NewTaskComposer } from "./new-task-composer.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * new-task-dialog.tsx -- New task as a small modal over the window: the title, and the composer card whose words start a coding agent, or a plan with Luke.
 *
 * The window asks the way Linear's and Notion's "New …" ask: it dims over
 * whatever stood open, and a card holds New task's composer
 * (`new-task-composer.tsx`), which takes focus, the card named by the
 * composer's own head row: "New task", the repository chip after it, and
 * the Issue chip at the row's right end, as Home draws it too. The task starts in the workspace the
 * window lists, and the dialog offers no other; the composer lists that
 * workspace's repositories and its Linear issues.
 *
 * What the composer starts is its own to say: in Agent mode a task with an
 * empty plan and a coding agent on the words, opened on the agent's tab; in
 * Plan mode the plan template and a call with Luke. Tab stays inside the
 * card, and focus goes back to whatever opened it. Escape, with no menu or
 * dictation standing in the card, and a press on the dimmed window put the
 * card away with nothing started, its words and files kept as New task's
 * draft for the next opening (`../composer-drafts.ts`); a start under way
 * holds the card. A refusal keeps the card with the reason under the
 * composer, and Start can be pressed again; a task started closes the card
 * and opens as the host's open task.
 */

/** The composer's words field, the editor's own textbox, which the card hands focus to. */
const FIELD_SELECTOR = '[role="textbox"]';

/** The dialog's own card, which holds focus while the field has not landed. */
const CARD_SELECTOR = '[aria-modal="true"]';

/**
 * The card with its own state, mounted afresh on each opening so its picks
 * start over, and whether a start is under way, which holds the card. Its
 * words are the draft's, which the opening brings back.
 */
function NewTaskCard({ newTask }: { newTask: TasksControl["newTask"] }): React.JSX.Element {
  const [starting, setStarting] = useState(false);
  const titleId = useId();
  const body = useRef<HTMLDivElement>(null);
  // Note that the field is the editor the composer mounts once its bundle
  // has landed, so the card hands focus to it by where it stands rather than
  // by a ref of its own; before it lands the card holds focus, and the field
  // takes the caret itself as it lands.
  const field = useMemo(
    (): RefObject<HTMLElement | null> => ({
      get current() {
        const card = body.current?.closest<HTMLElement>(CARD_SELECTOR) ?? null;
        return body.current?.querySelector<HTMLElement>(FIELD_SELECTOR) ?? card;
      },
    }),
    [],
  );
  const close = () => {
    if (!starting) newTask.onClose();
  };

  return (
    <Dialog
      size={DIALOG_SIZE.COMPOSER}
      labelledBy={titleId}
      busy={starting}
      initialFocus={field}
      onDismiss={close}
    >
      <div className="new-task ph-no-capture" ref={body}>
        <NewTaskComposer
          newTask={newTask}
          workspaceId={newTask.workspaceId}
          onStarting={setStarting}
          onLeave={close}
          focusedByOwner
          titleId={titleId}
          // Note that the dialog's card is not at a page's top, so a list rises over the line as an agent's box's does.
          listSide={MENTION_MENU_SIDE.ABOVE}
        />
      </div>
    </Dialog>
  );
}

/** The card over the window while New task is asked, in `@luke/ui`'s shared `Dialog`; nothing otherwise. */
export function NewTaskDialog({
  newTask,
}: {
  newTask: TasksControl["newTask"];
}): React.JSX.Element | null {
  if (!newTask.open) return null;
  return <NewTaskCard newTask={newTask} />;
}
