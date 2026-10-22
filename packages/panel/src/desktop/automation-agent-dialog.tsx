import { CODING_AGENT_BOUNDS } from "@luke/features/coding-agent-wire";
import {
  CHIP_WIDTH,
  ConfirmDialog,
  DIALOG_TONE,
  type DialogConfirm,
  FormField,
  Stack,
  TextArea,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useRef, useState } from "react";
import { CHIP_PLACE, RepositoryChip, type RepositoryChooser } from "../tasks/repository-chip.js";
import type { NewTaskStart } from "../tasks/use-tasks-tab.js";
import { automationAgentBrief } from "./automation-agent-brief.js";

/**
 * automation-agent-dialog.tsx -- the Automations page's Create with an agent: what to automate in the member's own words, the repository, and Start agent.
 *
 * Start agent starts a task in the listed workspace on the repository
 * chosen, its agent handed the fixed brief and the words fenced after it
 * (`automation-agent-brief.ts`), the one start New task makes, so the
 * window opens the task on the agent's tab and the member follows it and
 * answers it there. The repository starts at the one the account's tasks
 * were about lately, as a new automation's does. Each opening starts from
 * no words under a key of its own, which a retry of a refused start carries
 * again so a start that landed unheard is answered rather than made twice;
 * a change of the words or the repository mints a new key, since the start
 * it asks is another. A request whose message would pass the agent's bound,
 * its fence included, is refused before it is sent. A refusal stands in the
 * card until the words or the repository change, and the question goes
 * with the workspace it was asked in.
 */

/** Why nothing was started with no words. */
const WORDS_ASKED = "Say what to automate.";

/** Why nothing was started with no repository, as a new automation says it. */
const REPOSITORY_ASKED = "Choose the repository it works in.";

/** Why nothing was started where the brief and the words pass the agent's bound. */
const TOO_LONG = "That request is too long.";

/** The most the field takes, the brief and its shortest fence beside it; a longer fence is held to the bound as the start is asked. */
const REQUEST_MAX_CHARS = CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS - automationAgentBrief("").length;

/** Create with an agent's ask: the press that opens the card, and the card. */
export interface AutomationAgentAsk {
  ask: () => void;
  dialog: React.JSX.Element;
}

/** What a start's answer is as the card reads it: taken, or refused with why. */
function answered(refused: string | undefined): ActionResult {
  return refused === undefined
    ? { status: ACTION_RESULT_STATUS.ACCEPTED }
    : { status: ACTION_RESULT_STATUS.REJECTED, reason: refused };
}

/** Create with an agent in `workspaceId`, its repository picked from `chooser`, started through New task's `start`. */
export function useAutomationAgentDialog(
  workspaceId: string | undefined,
  chooser: RepositoryChooser,
  start: (
    name: string,
    repository: string | null,
    workspaceId: string | undefined,
    from?: NewTaskStart,
  ) => Promise<string | undefined>,
): AutomationAgentAsk {
  const [words, setWords] = useState("");
  const [repository, setRepository] = useState<string | null>(null);
  const [key, setKey] = useState("");
  // The workspace the question was asked in, which it goes with.
  const [askedIn, setAskedIn] = useState<string | undefined>(undefined);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const confirm: DialogConfirm = useConfirmDialog(
    { subject: askedIn !== undefined && askedIn === workspaceId, surfaceOpen: true },
    (): Promise<ActionResult> => {
      const request = words.trim();
      if (request === "") return Promise.resolve(answered(WORDS_ASKED));
      if (repository === null) return Promise.resolve(answered(REPOSITORY_ASKED));
      const prompt = automationAgentBrief(request);
      if (prompt.length > CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS) {
        return Promise.resolve(answered(TOO_LONG));
      }
      const handed = {
        idempotencyKey: key,
        prompt,
        attachments: [],
        choice: undefined,
      };
      return start("", repository, askedIn, { handed }).then(answered);
    },
  );
  // Note that what was asked changing is another start, under a key of its own, and
  // a refused answer stands in the card until then, which asks again.
  const changed =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setKey(crypto.randomUUID());
      if (confirm.rejection !== undefined) confirm.ask();
    };
  const dialog = (
    <ConfirmDialog
      confirm={confirm}
      field={field}
      question={{
        title: "Create with an agent",
        body: "An agent starts on a new task, asks you what it can't decide, and creates the automation.",
        verb: "Start agent",
        running: "Starting agent",
        tone: DIALOG_TONE.PRIMARY,
      }}
    >
      <Stack>
        <FormField label="What to automate">
          {(control) => (
            <TextArea
              ref={field}
              field={control}
              rows={4}
              placeholder="Every Monday, audit our agents' tool sets and post a report"
              maxLength={REQUEST_MAX_CHARS}
              value={words}
              disabled={confirm.busy}
              onChange={changed(setWords)}
              onSubmit={() => confirm.run()}
            />
          )}
        </FormField>
        <FormField label="Repository">
          {(control) => (
            <RepositoryChip
              key={chooser.scope}
              place={CHIP_PLACE.FIELD}
              width={CHIP_WIDTH.MIN_FIELD}
              describedBy={control["aria-describedby"]}
              value={repository}
              chooser={chooser}
              onChoose={changed(setRepository)}
            />
          )}
        </FormField>
      </Stack>
    </ConfirmDialog>
  );
  return {
    ask: () => {
      setAskedIn(workspaceId);
      setWords("");
      setRepository(chooser.recent[0] ?? null);
      setKey(crypto.randomUUID());
      confirm.ask();
    },
    dialog,
  };
}
