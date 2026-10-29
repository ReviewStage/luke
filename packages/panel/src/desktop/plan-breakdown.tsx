import type { MentionPlace } from "@luke/features/mention-link";
import { TASK_STATUS, type Task, type TaskSummary } from "@luke/features/task-wire";
import {
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  FormField,
  LIST_VARIANT,
  List,
  ListRow,
  STATUS_TONE,
  TaskStatusMark,
  TextArea,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { useRef, useState } from "react";
import { enterKeyHint, enterSubmitKey } from "../enter-sends.js";
import { agentStillWriting } from "../tasks/agent-model.js";
import {
  answerStands,
  approvalWords,
  type BreakdownAnswer,
  changesWords,
  taskPilot,
  waitingChildTasks,
} from "../tasks/pilot-breakdown.js";
import { TaskKey } from "../tasks/task-standing.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { TOAST_HOLD, useToast } from "../toast.js";

/**
 * plan-breakdown.tsx -- a pilot task's breakdown waiting for the developer's go, at the head of its plan: the child tasks the pilot proposed, with Approve and Request changes above them.
 *
 * It stands only on a task a pilot works, while any of its child tasks waits
 * (`pilot-breakdown.ts`), and goes once none does. Each child is a row of
 * its status, its name, and its key, which opens that task. Approve tells
 * the pilot at once, as submitting a review does; Request changes asks for
 * a note first, in a dialog, and sends it with the children it is about.
 * Either is the developer's message to the pilot, so whoever may message
 * the pilot may answer, and a refusal is said in a toast. Once an answer is
 * sent, a line saying so stands in the buttons' place while the pilot works
 * on it, so one approval is not sent twice; a child the pilot adds after it
 * brings the buttons back. The answer goes to the task's pilot, the agent
 * whose summary says it is one, so another agent on the task never takes it.
 */

/** What the waiting children's list is named for a reader moving between lists. */
const WAITING_LIST = "Child tasks waiting for approval";

const APPROVE = "Approve";
const REQUEST_CHANGES = "Request changes";
const NOTE_LABEL = "What should the pilot change?";
const SENT_WORDS = "Sent to the pilot. These child tasks wait until it acts on your answer.";
const NO_PILOT_WORDS = "No pilot stands on this task to hear your answer.";
const REFUSED_WORDS = "The pilot could not be told. Try again.";

/** Which answer is on its way. */
const SENDING = {
  APPROVAL: "approval",
  CHANGES: "changes",
} as const;

type Sending = (typeof SENDING)[keyof typeof SENDING];

/** What the banner says of the breakdown waiting. */
function waitingWords(count: number): string {
  return count === 1
    ? "The pilot proposed a child task. Approve it to start its agent, or request changes."
    : `The pilot proposed ${String(count)} child tasks. Approve them to start their agents, or request changes.`;
}

/** The dialog Request changes opens: the developer's note, and Send. */
function ChangesDialog({
  open,
  sending,
  onSend,
  onDismiss,
}: {
  open: boolean;
  sending: boolean;
  /** Sends the note, answering whether the pilot took it. */
  onSend: (note: string) => Promise<boolean>;
  onDismiss: () => void;
}): React.JSX.Element {
  const [note, setNote] = useState("");
  const field = useRef<HTMLTextAreaElement | null>(null);
  const said = note.trim() !== "";
  const send = () => {
    if (!said || sending) return;
    onSend(note).then((took) => {
      if (took) setNote("");
    });
  };
  return (
    <Dialog
      open={open}
      title={REQUEST_CHANGES}
      busy={sending}
      holding={said}
      initialFocus={field}
      onDismiss={onDismiss}
      actions={
        <DialogActions
          onCancel={onDismiss}
          act={{
            verb: "Send",
            tone: DIALOG_TONE.PRIMARY,
            onPress: send,
            running: "Sending",
            busy: sending,
            disabled: !said,
          }}
        />
      }
    >
      <FormField label={NOTE_LABEL}>
        {(control) => (
          <TextArea
            ref={field}
            field={control}
            value={note}
            disabled={sending}
            grow
            enterKeyHint={enterKeyHint()}
            submitKey={enterSubmitKey()}
            onSubmit={send}
            onChange={setNote}
          />
        )}
      </FormField>
    </Dialog>
  );
}

/**
 * The child tasks of `task` waiting for the developer's go, with Approve and
 * Request changes above them; nothing on a task no pilot works, or while
 * none waits. `onOpenTask` opens a child as its row is pressed.
 */
export function PlanBreakdown({
  task,
  tasks,
  agents,
  place,
  workspaceName,
  onOpenTask,
}: {
  task: Pick<Task, "id" | "mode">;
  /** Every task the window lists, among which the children are found. */
  tasks: readonly TaskSummary[];
  agents: Pick<AgentsControl, "agents" | "onMessage">;
  /** Where the children's links are written, as their chips in the message name them. */
  place: MentionPlace;
  workspaceName: string;
  onOpenTask: (taskId: string) => void;
}): React.JSX.Element | null {
  const toast = useToast();
  const [sending, setSending] = useState<Sending | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  // The answer sent last, held by the task it was about, so another task opened here never wears it.
  const [answered, setAnswered] = useState<{ taskId: string; answer: BreakdownAnswer } | undefined>(
    undefined,
  );
  // The answer last sent that the pilot has not been heard to take, and the key it went under.
  const unsent = useRef<{ agentId: string; text: string; clientKey: string } | undefined>(
    undefined,
  );
  const waiting = waitingChildTasks(task, tasks);
  const pilot = taskPilot(agents.agents);
  if (waiting.length === 0) return null;
  const answer = answered?.taskId === task.id ? answered.answer : undefined;
  const stands = answerStands(answer, pilot, waiting);
  const send = async (kind: Sending, text: string): Promise<boolean> => {
    if (pilot === undefined) return false;
    // Note that the same answer sent again to the same pilot keeps its key, because one whose reply was lost may have landed, and the service takes a key once.
    const held = unsent.current;
    const clientKey =
      held !== undefined && held.agentId === pilot.id && held.text === text
        ? held.clientKey
        : crypto.randomUUID();
    unsent.current = { agentId: pilot.id, text, clientKey };
    setSending(kind);
    const reply = await agents
      .onMessage(pilot.id, text, clientKey, [])
      .finally(() => setSending(undefined));
    if ("failure" in reply) {
      toast({ words: REFUSED_WORDS, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED });
      return false;
    }
    unsent.current = undefined;
    setAnswered({
      taskId: task.id,
      answer: {
        agentId: pilot.id,
        turnId: pilot.turnId,
        steered: agentStillWriting(pilot.status),
        children: waiting.map((child) => child.id),
      },
    });
    return true;
  };
  const words = stands
    ? SENT_WORDS
    : pilot === undefined
      ? NO_PILOT_WORDS
      : waitingWords(waiting.length);
  return (
    <div className="plan-breakdown mb-block-gap flex flex-col gap-block-gap">
      <Banner
        look={BANNER_LOOK.CARD}
        tone={STATUS_TONE.ATTENTION}
        glyph={<GLYPH.TODOS />}
        actions={
          stands || pilot === undefined ? undefined : (
            <>
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                disabled={sending !== undefined}
                onClick={() => setAsking(true)}
              >
                {REQUEST_CHANGES}
              </Button>
              <Button
                variant={BUTTON_VARIANT.PRIMARY}
                disabled={sending === SENDING.CHANGES}
                busy={sending === SENDING.APPROVAL}
                busyLabel="Approving"
                onClick={() => void send(SENDING.APPROVAL, approvalWords(waiting, place))}
              >
                {APPROVE}
              </Button>
            </>
          )
        }
      >
        {words}
      </Banner>
      <List label={WAITING_LIST} variant={LIST_VARIANT.CARD} moves>
        {waiting.map((child) => (
          <ListRow
            key={child.id}
            motionKey={child.id}
            leading={<TaskStatusMark status={TASK_STATUS.TODO} />}
            title={child.name}
            meta={<TaskKey workspaceName={workspaceName} number={child.number} />}
            onPress={() => onOpenTask(child.id)}
          />
        ))}
      </List>
      <ChangesDialog
        open={asking}
        sending={sending === SENDING.CHANGES}
        onDismiss={() => setAsking(false)}
        onSend={async (note) => {
          const took = await send(SENDING.CHANGES, changesWords(waiting, note, place));
          if (took) setAsking(false);
          return took;
        }}
      />
    </div>
  );
}
