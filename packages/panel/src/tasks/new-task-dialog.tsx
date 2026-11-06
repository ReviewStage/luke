import { DIALOG_SIZE, Dialog, type DialogHandle } from "@repo/ui";
import { type RefObject, useId, useMemo, useRef, useState } from "react";
import { EDITOR_ROOT_SELECTOR } from "../description-editor/contract.js";
import { useDrawnThroughExit } from "../use-held-through-exit.js";
import { MENTION_MENU_SIDE } from "./mention-picker.js";
import { NewTaskComposer } from "./new-task-composer.js";
import { NEW_TASK_PURPOSE } from "./new-task-purpose.js";
import type { TasksControl } from "./use-tasks-tab.js";

const FIELD_SELECTOR = EDITOR_ROOT_SELECTOR;

const CARD_SELECTOR = '[aria-modal="true"]';

function NewTaskCard({
  open,
  newTask,
  onExited,
}: {
  open: boolean;
  newTask: TasksControl["newTask"];
  onExited: () => void;
}): React.JSX.Element {
  const [starting, setStarting] = useState(false);
  const purpose = newTask.preset?.purpose ?? NEW_TASK_PURPOSE.TASK;
  const related = newTask.preset?.relation ?? newTask.preset?.refused?.card.relations[0];
  const workspaceId = related?.task.workspaceId ?? newTask.workspaceId;
  const dialog = useRef<DialogHandle>(null);
  const titleId = useId();
  const body = useRef<HTMLDivElement>(null);
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
      open={open}
      size={DIALOG_SIZE.COMPOSER}
      labelledBy={titleId}
      ref={dialog}
      busy={starting}
      initialFocus={field}
      onDismiss={close}
      onExited={onExited}
    >
      <div className="new-task ph-no-capture flex min-h-0 flex-col gap-block-gap" ref={body}>
        <NewTaskComposer
          newTask={newTask}
          workspaceId={workspaceId}
          onStarting={setStarting}
          onLeave={() => dialog.current?.dismiss()}
          focusedByOwner
          titleId={titleId}
          purpose={purpose}
          listSide={MENTION_MENU_SIDE.ABOVE}
        />
      </div>
    </Dialog>
  );
}

export function NewTaskDialog({
  newTask,
}: {
  newTask: TasksControl["newTask"];
}): React.JSX.Element | null {
  const { drawn, onExited } = useDrawnThroughExit(newTask.open);
  const [openings, setOpenings] = useState(0);
  const [wasOpen, setWasOpen] = useState(newTask.open);
  const [wasPreset, setWasPreset] = useState(newTask.preset);
  if (wasOpen !== newTask.open || wasPreset !== newTask.preset) {
    if (newTask.open && (!wasOpen || wasPreset !== newTask.preset)) {
      setOpenings((count) => count + 1);
    }
    setWasOpen(newTask.open);
    setWasPreset(newTask.preset);
  }
  if (!drawn) return null;
  return <NewTaskCard key={openings} open={newTask.open} newTask={newTask} onExited={onExited} />;
}
