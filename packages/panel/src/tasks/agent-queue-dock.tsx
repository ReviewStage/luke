import { QUEUE_PAUSE, type QueuedMessage, type QueuePaused } from "@luke/features/agent-queue-wire";
import { IRREVERSIBLE_WORDS } from "@luke/features/words";
import {
  BANNER_LOOK,
  Badge,
  Banner,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  IconButton,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_VARIANT,
  List,
  ListRow,
  PauseIcon,
  PlayIcon,
  STATUS_TONE,
  Text,
  useConfirmDialog,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useState } from "react";
import { useRowDrag } from "../desktop/use-row-drag.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";

/**
 * agent-queue-dock.tsx -- the messages queued behind an agent's running turn, docked over its message box, under its to-do list and its pull request.
 *
 * One row a message, its words on one line, leading with the queue's glyph,
 * which gives way to the handle it is dragged by as the row is hovered
 * (`tasks.css`); on hover, Steer sends it into the turn now, the pencil
 * takes its words into the message box to edit (`agent-composer.tsx`), and
 * the trash deletes it, asking first, since nothing brings its words and
 * files back. The message being edited stays in its place, marked
 * so, and the turn's end passes over it. A queue standing paused says why
 * over its rows, after a Stop in the quiet tone and after a refusal in the
 * danger one, with Resume. Nothing is drawn while none is queued.
 */

/** What the dock says. */
const WORDS = {
  LIST: "Queued messages",
  STEER: "Steer",
  EDIT: "Edit",
  DELETE: "Delete",
  EDITING: "Editing",
  RESUME: "Resume",
  STOPPED: "Queue paused because you interrupted",
  TURN_FAILED: "Queue paused because the turn failed",
  REFUSED: "Queue paused: the next message could not be sent",
  PAUSED: "Queue paused",
} as const;

/** What asking to delete a queued message says. */
const DELETE_QUESTION: DialogQuestion = {
  title: "Delete queued message?",
  body: `It will not be sent, and any files it carries go with it. ${IRREVERSIBLE_WORDS}`,
  verb: WORDS.DELETE,
  running: "Deleting",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
};

/** Why a refused hand-off did not go, by the service's word for it, where the dock has words for it. */
const REFUSAL_WORDS: Readonly<Record<string, string>> = {
  "agent-plan-limit-reached": "your plan's usage limit was reached",
  "agent-credential-missing": "the agent's credential is missing",
  "agent-retired": "the agent's session has ended",
  "not-permitted": "only the agent's starter can message it",
  unavailable: "Luke could not reach the agent",
};

/** What the paused header says. */
function pausedWords(paused: QueuePaused): string {
  if (paused.because === QUEUE_PAUSE.STOPPED) return WORDS.STOPPED;
  if (paused.because === QUEUE_PAUSE.TURN_FAILED) return WORDS.TURN_FAILED;
  const why = paused.refusal === undefined ? undefined : REFUSAL_WORDS[paused.refusal];
  return why === undefined ? WORDS.REFUSED : `${WORDS.PAUSED}: ${why}`;
}

/** The dock: the paused header where the queue stands paused, then a row per queued message. */
export function AgentQueueDock({
  messages,
  paused,
  editing,
  onMove,
  onSteer,
  onEdit,
  onDelete,
  onResume,
}: {
  messages: readonly QueuedMessage[];
  paused: QueuePaused | undefined;
  /** The message the box is editing, by its id; none while none is. */
  editing: string | undefined;
  onMove: (from: number, to: number) => void;
  onSteer: (message: QueuedMessage) => void;
  onEdit: (message: QueuedMessage) => void;
  /** Deletes the message once the dialog's Delete is pressed, answering how that went. */
  onDelete: (message: QueuedMessage) => Promise<ActionResult>;
  onResume: () => void;
}): React.JSX.Element | null {
  const drag = useRowDrag(onMove, { handle: "[data-queue-handle]" });
  const [doomed, setDoomed] = useState<QueuedMessage>();
  // The question goes with its message, which a hand-off may send while it is asked.
  const asked = doomed !== undefined && messages.some((message) => message.id === doomed.id);
  const confirm = useConfirmDialog({ subject: asked, surfaceOpen: true }, () =>
    doomed === undefined
      ? Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED })
      : onDelete(doomed),
  );
  if (messages.length === 0) return null;
  return (
    <div className={`agent-queue-dock ${COMPOSER_DOCK_CLASS}`}>
      {paused === undefined ? null : (
        <Banner
          look={BANNER_LOOK.INSET}
          tone={paused.because === QUEUE_PAUSE.REFUSED ? STATUS_TONE.DANGER : STATUS_TONE.NEUTRAL}
          glyph={<PauseIcon />}
          actions={
            <Button
              size={BUTTON_SIZE.COMPACT}
              variant={BUTTON_VARIANT.QUIET}
              icon={<PlayIcon />}
              onClick={onResume}
            >
              {WORDS.RESUME}
            </Button>
          }
        >
          {pausedWords(paused)}
        </Banner>
      )}
      <div className="agent-queue-rows">
        <List
          label={WORDS.LIST}
          variant={LIST_VARIANT.CARD}
          density={LIST_DENSITY.DENSE}
          moves
          onPointerDown={drag}
        >
          {messages.map((message) => {
            const edited = message.id === editing || message.editing === true;
            return (
              <ListRow
                key={message.id}
                leading={
                  <span className="agent-queue-lead" data-queue-handle="">
                    <GLYPH.QUEUED />
                    <GLYPH.DRAG_HANDLE />
                  </span>
                }
                title={<Text truncate>{message.text}</Text>}
                muted={edited}
                meta={
                  edited ? (
                    <Badge tone={STATUS_TONE.WORKING} icon={<GLYPH.RENAME />}>
                      {WORDS.EDITING}
                    </Badge>
                  ) : undefined
                }
                actionsAt={LIST_ROW_ACTIONS.HOVER}
                actions={
                  edited ? undefined : (
                    <>
                      <Button
                        size={BUTTON_SIZE.COMPACT}
                        variant={BUTTON_VARIANT.QUIET}
                        icon={<GLYPH.STEER />}
                        onClick={() => onSteer(message)}
                      >
                        {WORDS.STEER}
                      </Button>
                      <IconButton
                        size={BUTTON_SIZE.COMPACT}
                        label={WORDS.EDIT}
                        icon={<GLYPH.RENAME />}
                        onClick={() => onEdit(message)}
                      />
                      <IconButton
                        size={BUTTON_SIZE.COMPACT}
                        label={WORDS.DELETE}
                        icon={<GLYPH.DELETE />}
                        onClick={() => {
                          setDoomed(message);
                          confirm.ask();
                        }}
                      />
                    </>
                  )
                }
              />
            );
          })}
        </List>
      </div>
      <ConfirmDialog open confirm={confirm} question={DELETE_QUESTION} />
    </div>
  );
}
