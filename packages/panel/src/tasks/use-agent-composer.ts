import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@luke/features/coding-agent-view";
import {
  type CodingAgentAttachment,
  type CodingAgentMessage,
  type CodingAgentPayer,
  hasWordsOrFiles,
} from "@luke/features/coding-agent-wire";
import type { Failure } from "@luke/features/failure-remedy";
import { sentLineId } from "@luke/wire/host-ids";
import { useEffect, useRef, useState } from "react";
import { DRAFT_PLACE, type Draft, EMPTY_DRAFT, useDraft } from "../composer-drafts.js";
import {
  type AgentRun,
  closesComposer,
  messageFailureNote,
  SENT_LINE_STATE,
  type SentLine,
  unreadSentLines,
} from "./coding-agent-model.js";

/**
 * use-agent-composer.ts -- the message box under an agent's transcript as one control: the words being written, the messages on their way, why the last one did not go, and the lines sent that the transcript has not read back.
 *
 * A send takes the words out of the box and shows them in the transcript
 * at once as the developer's own line, and the box takes the next message
 * straight away: nothing holds it while the service answers. Every send goes
 * under a key of its own, minted here, and the line is drawn under the id
 * the service writes its row under, which the key names (`sentLineId`), so
 * the row lands in the line's place, whichever of the row and the answer
 * comes first (`unreadSentLines`). The service's answer is the agent as it
 * then stands, which is running, and the tab's status takes it, so a
 * message to an agent that had finished turns its status back and starts
 * the transcript reading again.
 *
 * Messages go one at a time, in the order they were sent: the service writes
 * a line and hands it to eve under the conversation's lock, so two sends out
 * at once would take it in either order, and a line sent while one is out
 * waits for its answer here.
 *
 * A message that did not go says why under the box, with Retry, which sends
 * it again under the same key, so a send whose answer was lost reaches the
 * agent once. Its words and files come back into the box where the box
 * holds nothing newer, the line leaving the transcript, and an edit there
 * is a new message under a new key, so Retry goes with the edit, as it does
 * with a file put on or taken off; where the developer has written on
 * meanwhile, the box keeps their words and the line stays where it went,
 * marked as not sent, with a Retry of its own. A refusal that is for good
 * holds the box, disabled, with its reason under it, and keeps the line
 * where it went, marked as not delivered, as it does every line still
 * waiting to go behind it, the box drawing none of the words its draft keeps
 * for Continue, so they show once. The marks are this tab's alone: a tab
 * opened again draws the words in its box. Another agent's tab starts from
 * nothing of this one's, though a line sent from it still goes.
 *
 * The words and the files not yet sent are the agent's draft, kept apart from
 * the tab (`../composer-drafts.ts`), so they wait while another tab or task is
 * open and come back as the tab does; a message that did not go comes back
 * into the agent's draft even once its tab is closed.
 */

/** How one message is sent: the agent, the words, the key this send is known by, which Retry carries again, and the files attached, answered as the view hears it. */
export type MessageSender = (
  agentId: string,
  text: string,
  clientKey: string,
  attachments: readonly CodingAgentAttachment[],
) => Promise<CodingAgentAgentAnswer>;

/** Everything the composer draws and presses. */
export interface AgentComposerControl {
  /** The words in the box. */
  draft: string;
  setDraft: (text: string) => void;
  /** The files that go with the words, in the order attached. */
  attachments: readonly CodingAgentAttachment[];
  /** Changes the files from those the box holds as the change lands, which a read that lands late needs. */
  setAttachments: (
    next: (held: readonly CodingAgentAttachment[]) => readonly CodingAgentAttachment[],
  ) => void;
  /** Whether a send holds the box until it answers, during which the box takes nothing: New task's, whose send opens the task; an agent's box never holds. */
  sending: boolean;
  /** Why the last message did not go, said under the box beside what mends it; nothing while none failed. */
  note: Failure | undefined;
  /** Why the agent takes no message any more, in the host's words; nothing while it does. */
  closed: string | undefined;
  /** Sends the words in the box, trimmed, and its files under a fresh key; nothing on an empty box or a closed agent. */
  send: () => void;
  /** Sends the message that did not go again under its key, so a send whose answer was lost reaches the agent once. */
  retry: () => void;
  /** The lines sent that the transcript has not read back yet, in order. */
  sent: readonly SentLine[];
}

/** The last message that did not go, which the note under the box is of and its Retry sends again. */
interface Failed {
  /** The line it went as, by its id. */
  readonly lineId: string;
  readonly clientKey: string;
  /** Whether its words came back into the box, which Retry sends; else the line keeps them, marked as not sent. */
  readonly inBox: boolean;
  readonly note: Failure;
}

interface Held {
  agentId: string;
  failed: Failed | undefined;
  closed: string | undefined;
  sent: readonly SentLine[];
}

function fresh(agentId: string): Held {
  return { agentId, failed: undefined, closed: undefined, sent: [] };
}

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** Whether a draft holds neither words nor files. */
function holdsNothing(draft: Draft): boolean {
  return draft.text === "" && draft.attachments.length === 0;
}

/** The lines with the one by `id` in another state. */
function marked(
  sent: readonly SentLine[],
  id: string,
  state: SentLine["state"],
): readonly SentLine[] {
  return sent.map((each) => (each.id === id ? { ...each, state } : each));
}

/** The composer as an agent's tab holds it: what it draws, the words and files its draft keeps, which a closed box draws none of and Continue carries, and the Retry a line marked as not sent offers. */
export interface HeldComposer extends AgentComposerControl {
  readonly unsent: {
    readonly words: string;
    readonly attachments: readonly CodingAgentAttachment[];
  };
  /** Sends a line marked as not sent again under its key, from the line itself. */
  readonly retryLine: (id: string) => void;
}

export function useAgentComposer(input: {
  agentId: string;
  /** The agent's task, whose repository a refusal's remedy mends; null for an agent with no task, whose refusal says its words alone. */
  taskId: string | null;
  /** The transcript as the tab holds it, which a sent line is read back from. */
  messages: readonly CodingAgentMessage[];
  /** Whether a turn runs now, which a line sent now steers rather than opening one; none where none does. */
  running?: boolean | undefined;
  send: MessageSender;
  /** Who pays for the agent, which a plan's refusal names; none for an agent from before payers. */
  payer?: CodingAgentPayer | undefined;
  /** The service said where the agent stands now, which is newer than the list. */
  onStatus: (agentId: string, run: AgentRun) => void;
}): HeldComposer {
  const { agentId, messages } = input;
  const kept = useDraft({ kind: DRAFT_PLACE.AGENT, planId: input.taskId, agentId });
  const [held, setHeld] = useState<Held>(() => fresh(agentId));
  if (held.agentId !== agentId) setHeld(fresh(agentId));
  // The lines as last drawn, which an answer landing later reads.
  const heldNow = useRef(held);
  heldNow.current = held;
  // Note that the sender and the status are read through a ref, because the
  // tab hands new closures on every render and an answer lands on whichever
  // render is current.
  const latest = useRef(input);
  latest.current = input;
  // Each agent's sends as one queue, the next going once the one before it answered.
  const queues = useRef(new Map<string, Promise<void>>());

  // A line the transcript has read back is let go in the service's favour.
  const sent = unreadSentLines(held.sent, messages);
  useEffect(() => {
    if (sent.length === held.sent.length) return;
    setHeld((was) => ({ ...was, sent: unreadSentLines(was.sent, latest.current.messages) }));
  }, [sent.length, held.sent.length]);

  // Note that the state is changed only while the tab still shows the agent the line went to.
  const ours = (change: (was: Held) => Held) =>
    setHeld((was) => (was.agentId === agentId ? change(was) : was));

  const { update } = kept;
  /** Sends one line once every line before it has answered, and takes its answer. */
  const deliver = (line: SentLine) => {
    const before = queues.current.get(agentId) ?? Promise.resolve();
    const going = before.then(async () => {
      const now = heldNow.current;
      // A line behind one refused for good is refused with it, as the service would refuse it.
      if (now.agentId === agentId && now.closed !== undefined) {
        ours((was) => ({ ...was, sent: marked(was.sent, line.id, SENT_LINE_STATE.UNDELIVERED) }));
        return;
      }
      const answer = await latest.current
        .send(agentId, line.text, line.clientKey, line.attachments)
        .catch((): CodingAgentAgentAnswer => UNANSWERED);
      // An answer to another agent's tab, or to a tab since remounted, is nobody's.
      if (latest.current.agentId !== agentId) return;
      if (!("failure" in answer)) {
        latest.current.onStatus(agentId, answer.agent);
        return;
      }
      // A line a row has already read back reached the agent whatever the answer said: the
      // row stands, so there is nothing to send again and nothing to put back in the box.
      if (!heldNow.current.sent.some((each) => each.id === line.id)) return;
      const note = messageFailureNote(answer, latest.current.taskId, latest.current.payer);
      // A refusal for good closes the box, and the line stays where it went, marked as not
      // delivered, its words kept in the agent's draft for Continue where it holds nothing newer.
      if (closesComposer(answer.failure)) {
        update((draft) =>
          holdsNothing(draft)
            ? { ...EMPTY_DRAFT, text: line.text, attachments: line.attachments }
            : draft,
        );
        ours((was) => ({
          ...was,
          failed: { lineId: line.id, clientKey: line.clientKey, inBox: true, note },
          closed: note.text,
          sent: marked(was.sent, line.id, SENT_LINE_STATE.UNDELIVERED),
        }));
        return;
      }
      // The words come back into the box only where it holds nothing newer; else the line keeps them.
      // Note that the draft store takes a change at once, so the box as the change lands decides.
      let inBox = false;
      update((draft) => {
        inBox = holdsNothing(draft);
        return inBox ? { ...EMPTY_DRAFT, text: line.text, attachments: line.attachments } : draft;
      });
      ours((was) => ({
        ...was,
        failed: { lineId: line.id, clientKey: line.clientKey, inBox, note },
        sent: inBox
          ? was.sent.filter((each) => each.id !== line.id)
          : marked(was.sent, line.id, SENT_LINE_STATE.FAILED),
      }));
    });
    queues.current.set(agentId, going);
  };

  const sendDraft = (clientKey: string = crypto.randomUUID()) => {
    const text = kept.draft.text.trim();
    const { attachments } = kept.draft;
    if (!hasWordsOrFiles(text, attachments) || held.closed !== undefined) return;
    const line: SentLine = {
      id: sentLineId(clientKey),
      clientKey,
      text,
      attachments,
      steers: input.running === true,
      state: SENT_LINE_STATE.PENDING,
    };
    update(() => EMPTY_DRAFT);
    setHeld((was) => ({ ...was, failed: undefined, sent: [...was.sent, line] }));
    deliver(line);
  };

  /** Sends a line marked as not sent again, under its key, where it stands. */
  const resend = (id: string) => {
    const line = held.sent.find((each) => each.id === id);
    if (line?.state !== SENT_LINE_STATE.FAILED || held.closed !== undefined) return;
    setHeld((was) => ({
      ...was,
      failed: was.failed?.lineId === id ? undefined : was.failed,
      sent: marked(was.sent, id, SENT_LINE_STATE.PENDING),
    }));
    deliver({ ...line, state: SENT_LINE_STATE.PENDING });
  };

  // Note that a closed box draws none of its words, because they stand in the transcript as the
  // line not delivered, and the draft keeps them for Continue, which carries them (`unsent`).
  const shown = held.closed === undefined ? kept.draft : EMPTY_DRAFT;
  // Note that an edit lets Retry go where Retry would send the box's words, because they are
  // no longer the message that failed; a line that keeps its own words keeps its Retry.
  const editLetsGo = (was: Held): Held =>
    was.failed?.inBox === true ? { ...was, failed: undefined } : was;
  return {
    draft: shown.text,
    setDraft: (text) => {
      if (text !== kept.draft.text) setHeld(editLetsGo);
      kept.update((was) => ({ ...was, text }));
    },
    attachments: shown.attachments,
    // Note that a file put on or taken off lets Retry go too, since the message is another.
    setAttachments: (next) => {
      setHeld(editLetsGo);
      kept.update((was) => ({ ...was, attachments: next(was.attachments) }));
    },
    sending: false,
    note: held.closed === undefined ? held.failed?.note : undefined,
    closed: held.closed,
    send: () => sendDraft(),
    retry: () => {
      const { failed } = held;
      if (failed === undefined) return;
      if (failed.inBox) sendDraft(failed.clientKey);
      else resend(failed.lineId);
    },
    retryLine: resend,
    sent,
    unsent: { words: kept.draft.text, attachments: kept.draft.attachments },
  };
}
