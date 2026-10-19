import { DIALOG_SIZE, Dialog, TEXT_ELEMENT, TEXT_VARIANT, Text } from "@luke/ui";
import { type RefObject, useId, useMemo, useRef, useState } from "react";
import { NewTaskComposer } from "./new-task-composer.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * new-task-dialog.tsx -- New task as a small modal over the window: the title, and the composer card whose words start a coding agent, or a plan with Luke.
 *
 * The window asks the way Linear's and Notion's "New …" ask: it dims over
 * whatever stood open, and a card holds New task's composer
 * (`new-task-composer.tsx`), which takes focus, with the title handed to it
 * for its head row: "New task", the repository chip after it, and the
 * Linear chip at the row's right end. The task starts in the workspace the
 * window lists, and the dialog offers no other; the composer lists that
 * workspace's repositories and its Linear issues.
 *
 * What the composer starts is its own to say: in Agent mode a task with an
 * empty plan and a coding agent on the words, opened on the agent's tab; in
 * Plan mode the plan template and a call with Luke. Tab stays inside the
 * card, and focus goes back to whatever opened it. Escape, with no menu or
 * dictation standing in the card, and a press on the dimmed window put the
 * card away with nothing started, its words with it; a start under way
 * holds the card. A refusal keeps the card with the reason under the
 * composer, and Start can be pressed again; a task started closes the card
 * and opens as the host's open task.
 *
 * Opened from one of the workspace's own issues (its Start task…), the card
 * says so in its title, starts in the issue's workspace and no other, names
 * the task by the issue, and offers no Linear chip; the task it starts is
 * linked to that issue, which the issue's page lists it under. Opened from
 * the issue's Start agent…, the card is a new agent's: its composer stands
 * in Agent mode with no Plan toggle, and starts the task and an agent on it
 * at once.
 */

/** The card's title, before the repository's chip: an agent's where one alone is asked for, and the issue it starts from where there is one. */
function newTaskHeading(issue: string | undefined, agent: boolean): string {
  const what = agent ? "New agent" : "New task";
  return issue === undefined ? what : `${what} from ${issue}`;
}

/** The composer's words field, the editor's own textbox, which the card hands focus to. */
const FIELD_SELECTOR = '[role="textbox"]';

/** The dialog's own card, which holds focus while the field has not landed. */
const CARD_SELECTOR = '[aria-modal="true"]';

/**
 * The card with its own state, mounted afresh on each opening so cancelled
 * words are never offered again, and whether a start is under way, which
 * holds the card.
 */
function NewTaskCard({ newTask }: { newTask: TasksControl["newTask"] }): React.JSX.Element {
  // The workspace's own issue the task starts from, where the card was opened on one: it names the task, and its workspace is the one the task starts in.
  const from = newTask.preset?.issue;
  // The workspace the task starts in: the issue's, else the one listed.
  const startsIn = from?.workspaceId ?? newTask.workspaceId;
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
          workspaceId={startsIn}
          from={from}
          onStarting={setStarting}
          onLeave={close}
          focusedByOwner
          heading={
            <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2} id={titleId}>
              {newTaskHeading(from?.identifier, newTask.preset?.agent === true)}
            </Text>
          }
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
