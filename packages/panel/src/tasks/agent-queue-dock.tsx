import { QUEUE_PAUSE, type QueuedMessage, type QueuePaused } from "@repo/features/agent-queue-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
import {
  BANNER_LOOK,
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
  OneLine,
  PauseIcon,
  PlayIcon,
  STATUS_TONE,
  useConfirmDialog,
} from "@repo/ui";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { GLYPH } from "@repo/ui/icons";
import type { ActionResult } from "@repo/wire";
import { useState } from "react";
import { useRowDrag } from "../desktop/use-row-drag.js";
import { confirmFailure } from "../failure-report.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { KeptFileChips } from "./agent-pictures.js";
import { SentWords } from "./skill-chip.js";

const WORDS = {
  LIST: "Queued messages",
  STEER: "Steer",
  EDIT: "Edit",
  DELETE: "Delete",
  CANCEL: "Cancel",
  RESUME: "Resume",
  STOPPED: "Queue paused because you interrupted",
  TURN_FAILED: "Queue paused because the turn failed",
  REFUSED: "Queue paused: the next message could not be sent",
  PAUSED: "Queue paused",
} as const;

function queuedFileChips(message: QueuedMessage) {
  return (message.files ?? []).map((file) => ({
    name: file.name,
    mediaType: file.mediaType,
    url: "",
    ...(file.id === undefined ? undefined : { pictureId: file.id }),
  }));
}

const DELETE_QUESTION: DialogQuestion = {
  title: "Delete queued message?",
  body: `It will not be sent, and any files it carries go with it. ${IRREVERSIBLE_WORDS}`,
  verb: "Delete message",
  running: "Deleting",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

const REFUSAL_WORDS: Readonly<Record<string, string>> = {
  "agent-plan-limit-reached": "your plan's usage limit was reached",
  "agent-credential-missing": "the agent's credential is missing",
  "agent-retired": "the agent's session has ended",
  "not-permitted": "only the agent's starter can message it",
  unavailable: "Could not reach the agent",
};

function pausedWords(paused: QueuePaused): string {
  if (paused.because === QUEUE_PAUSE.STOPPED) return WORDS.STOPPED;
  if (paused.because === QUEUE_PAUSE.TURN_FAILED) return WORDS.TURN_FAILED;
  const why = paused.refusal === undefined ? undefined : REFUSAL_WORDS[paused.refusal];
  return why === undefined ? WORDS.REFUSED : `${WORDS.PAUSED}: ${why}`;
}

export function AgentQueueDock({
  messages,
  controls,
  paused,
  editing,
  onMove,
  onSteer,
  onEdit,
  onCancelEdit,
  onDelete,
  onResume,
}: {
  messages: readonly QueuedMessage[];
  controls: boolean;
  paused: QueuePaused | undefined;
  editing: string | undefined;
  onCancelEdit: (message: QueuedMessage) => void;
  onMove: (from: number, to: number) => void;
  onSteer: (message: QueuedMessage) => void;
  onEdit: (message: QueuedMessage) => void;
  onDelete: (message: QueuedMessage) => Promise<ActionResult>;
  onResume: () => void;
}): React.JSX.Element | null {
  const drag = useRowDrag(onMove, { handle: "[data-queue-handle]" });
  const [doomed, setDoomed] = useState<QueuedMessage>();
  const asked = doomed !== undefined && messages.some((message) => message.id === doomed.id);
  const confirm = useConfirmDialog(
    { subject: asked, surfaceOpen: true },
    neverBusyAct(() => {
      if (doomed !== undefined) void onDelete(doomed);
    }),
    confirmFailure(FAILURE_SURFACE.AGENT_QUEUE_DELETE),
  );
  if (messages.length === 0) return null;
  const movable = controls && messages.length > 1;
  return (
    <div className={`agent-queue-dock ${COMPOSER_DOCK_CLASS}`}>
      {paused === undefined ? null : (
        <Banner
          look={BANNER_LOOK.INSET}
          tone={paused.because === QUEUE_PAUSE.REFUSED ? STATUS_TONE.DANGER : STATUS_TONE.NEUTRAL}
          glyph={<PauseIcon />}
          actions={
            controls ? (
              <Button
                size={BUTTON_SIZE.COMPACT}
                variant={BUTTON_VARIANT.QUIET}
                icon={<PlayIcon />}
                onClick={onResume}
              >
                {WORDS.RESUME}
              </Button>
            ) : undefined
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
                  <span
                    className="agent-queue-lead"
                    {...(movable && !edited ? { "data-queue-handle": "" } : undefined)}
                  >
                    <GLYPH.QUEUED />
                    <GLYPH.DRAG_HANDLE />
                  </span>
                }
                title={
                  <OneLine words={message.text}>
                    <SentWords text={message.text} line />
                  </OneLine>
                }
                attachments={
                  message.files === undefined ? undefined : (
                    <KeptFileChips files={queuedFileChips(message)} />
                  )
                }
                attachmentsOpen
                muted={edited}
                actionsAt={edited ? LIST_ROW_ACTIONS.ALWAYS : LIST_ROW_ACTIONS.HOVER}
                actions={
                  !controls ? undefined : edited ? (
                    <Button
                      size={BUTTON_SIZE.COMPACT}
                      variant={BUTTON_VARIANT.QUIET}
                      onClick={() => onCancelEdit(message)}
                    >
                      {WORDS.CANCEL}
                    </Button>
                  ) : (
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
