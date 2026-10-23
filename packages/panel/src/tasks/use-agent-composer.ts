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
 *
 * Edit puts one of the developer's lines back in the box, and its send takes
 * the agent back to just before that line first (`rewind.ts` on the service),
 * so the words go in its place; × lets the edit go, putting back what the box
 * held before it.
 * Revert takes the agent back to just before a line without sending. Either
 * hides the messages the rewind drops at once, until the transcript reads
 * back without them, and one that did not go says why under the box, its
 * Retry rewinding again.
 */

/** How one message is sent: the agent, the words, the key this send is known by, which Retry carries again, and the files attached, answered as the view hears it. */
export type MessageSender = (
  agentId: string,
  text: string,
  clientKey: string,
  attachments: readonly CodingAgentAttachment[],
) => Promise<CodingAgentAgentAnswer>;

/** How the agent is taken back to just before one of the developer's lines, by its message id, answered as the view hears it. */
export type MessageRewinder = (
  agentId: string,
  messageId: string,
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
  /** The developer's line the box's words are written in place of, by its message id; none while the box writes a line after the rest. */
  editing: string | undefined;
  /** What the box held as the edit began, which letting the edit go puts back. */
  beforeEdit: Draft;
  /** The messages a rewind under way or just done drops, by their ids, hidden until the transcript reads back without them. */
  cut: ReadonlySet<string> | undefined;
  /** The Revert that did not go, which the note under the box is of and its Retry asks again. */
  revertFailed: { readonly messageId: string; readonly note: Failure } | undefined;
  closed: string | undefined;
  /** What the box held as it closed, newer than every line sent, which Continue carries after them. */
  behind: Draft;
  sent: readonly SentLine[];
}

function fresh(agentId: string): Held {
  return {
    agentId,
    failed: undefined,
    editing: undefined,
    beforeEdit: EMPTY_DRAFT,
    cut: undefined,
    revertFailed: undefined,
    closed: undefined,
    behind: EMPTY_DRAFT,
    sent: [],
  };
}

/** The ids of the message named and every message after it, which a rewind to just before it drops. */
function cutFrom(
  messages: readonly CodingAgentMessage[],
  messageId: string,
): ReadonlySet<string> | undefined {
  const at = messages.findIndex((message) => message.id === messageId);
  return at === -1 ? undefined : new Set(messages.slice(at).map((message) => message.id));
}

/**
 * What a closed box's draft keeps for Continue, which carries it, and for the
 * tab opened again, whose box draws it: the words and files of every line
 * that did not go, in the order sent, then what the box held as it closed.
 */
function carried(sent: readonly SentLine[], behind: Draft): Draft {
  const lines = sent.filter((line) => line.state !== SENT_LINE_STATE.PENDING);
  return {
    ...EMPTY_DRAFT,
    text: [...lines.map((line) => line.text), behind.text]
      .filter((text) => text !== "")
      .join("\n\n"),
    attachments: [...lines.flatMap((line) => line.attachments), ...behind.attachments],
  };
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
  /** The developer's line the box's words go in place of, by its message id; none while it writes a line after the rest. */
  readonly editing: string | undefined;
  /** Puts one of the developer's lines in the box, to go in its place. */
  readonly edit: (messageId: string, words: string) => void;
  /** Lets the edit go, and the words with it. */
  readonly dropEdit: () => void;
  /** Takes the agent back to just before one of the developer's lines, sending nothing. */
  readonly revert: (messageId: string) => void;
  /** The messages a rewind drops, hidden from the transcript until it reads back without them; none while none does. */
  readonly cut: ReadonlySet<string> | undefined;
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
  /** Takes the agent back to just before one of the developer's lines; none where the box offers no edit and no revert. */
  rewind?: MessageRewinder | undefined;
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

  // A rewind's cut is let go once the transcript reads back without the messages it dropped.
  const cutStands = held.cut !== undefined && messages.some((message) => held.cut?.has(message.id));
  useEffect(() => {
    if (held.cut === undefined || cutStands) return;
    setHeld((was) => ({ ...was, cut: undefined }));
  }, [held.cut, cutStands]);

  // Note that the state is changed only while the tab still shows the agent the line went to.
  const ours = (change: (was: Held) => Held) =>
    setHeld((was) => (was.agentId === agentId ? change(was) : was));

  const { update } = kept;
  /** The agent taken back to just before the line named, answered as unanswered where the box was handed no rewind. */
  const rewindTo = (agentId: string, messageId: string): Promise<CodingAgentAgentAnswer> =>
    (latest.current.rewind?.(agentId, messageId) ?? Promise.resolve(UNANSWERED)).catch(
      (): CodingAgentAgentAnswer => UNANSWERED,
    );
  /** Sends one line once every line before it has answered, and takes its answer. */
  const deliver = (line: SentLine) => {
    const before = queues.current.get(agentId) ?? Promise.resolve();
    const going = before.then(async () => {
      const now = heldNow.current;
      // A line behind one refused for good is refused with it, as the service would refuse it.
      if (now.agentId === agentId && now.closed !== undefined) {
        const sent = marked(now.sent, line.id, SENT_LINE_STATE.UNDELIVERED);
        update(() => carried(sent, now.behind));
        ours((was) => ({ ...was, sent: marked(was.sent, line.id, SENT_LINE_STATE.UNDELIVERED) }));
        return;
      }
      // A line written in place of another takes the agent back to just before that one first.
      const rewound =
        line.rewinds === undefined ? undefined : await rewindTo(agentId, line.rewinds);
      const answer =
        rewound !== undefined && "failure" in rewound
          ? rewound
          : await latest.current
              .send(agentId, line.text, line.clientKey, line.attachments)
              .catch((): CodingAgentAgentAnswer => UNANSWERED);
      // An answer to another agent's tab, or to a tab since remounted, is nobody's.
      if (latest.current.agentId !== agentId) return;
      // A rewind that did not go drops nothing, and its line goes back to being an edit, so Retry rewinds again.
      if (rewound !== undefined && "failure" in rewound) {
        ours((was) => ({ ...was, cut: undefined, editing: line.rewinds }));
      }
      if (!("failure" in answer)) {
        latest.current.onStatus(agentId, answer.agent);
        return;
      }
      // A line a row has already read back reached the agent whatever the answer said: the
      // row stands, so there is nothing to send again and nothing to put back in the box.
      if (!heldNow.current.sent.some((each) => each.id === line.id)) return;
      const note = messageFailureNote(answer, latest.current.taskId, latest.current.payer);
      // A refusal for good closes the box, and the line stays where it went, marked as not
      // delivered, its words kept in the agent's draft for Continue with every other line that
      // did not go, ahead of what the box holds, which is newer.
      if (closesComposer(answer.failure)) {
        const sent = marked(heldNow.current.sent, line.id, SENT_LINE_STATE.UNDELIVERED);
        // Note that the draft store takes a change at once, so the box as the refusal lands is what stands behind.
        let behind: Draft = EMPTY_DRAFT;
        update((draft) => {
          behind = draft;
          return carried(sent, draft);
        });
        ours((was) => ({
          ...was,
          failed: { lineId: line.id, clientKey: line.clientKey, inBox: true, note },
          closed: note.text,
          behind,
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
    const rewinds = held.editing;
    const line: SentLine = {
      id: sentLineId(clientKey),
      clientKey,
      text,
      attachments,
      // Note that a line in place of another stops the turn under way rather than steering it.
      steers: rewinds === undefined && input.running === true,
      state: SENT_LINE_STATE.PENDING,
      ...(rewinds === undefined ? undefined : { rewinds }),
    };
    update(() => EMPTY_DRAFT);
    setHeld((was) => ({
      ...was,
      failed: undefined,
      revertFailed: undefined,
      editing: undefined,
      cut: rewinds === undefined ? was.cut : cutFrom(messages, rewinds),
      sent: [...was.sent, line],
    }));
    deliver(line);
  };

  /** Takes the agent back to just before the line named once every send before it has answered. */
  const revert = (messageId: string) => {
    setHeld((was) => ({
      ...was,
      revertFailed: undefined,
      editing: undefined,
      cut: cutFrom(messages, messageId),
    }));
    const before = queues.current.get(agentId) ?? Promise.resolve();
    const going = before.then(async () => {
      const answer = await rewindTo(agentId, messageId);
      if (latest.current.agentId !== agentId) return;
      if (!("failure" in answer)) {
        latest.current.onStatus(agentId, answer.agent);
        return;
      }
      const note = messageFailureNote(answer, latest.current.taskId, latest.current.payer);
      ours((was) => ({ ...was, cut: undefined, revertFailed: { messageId, note } }));
    });
    queues.current.set(agentId, going);
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
    note: held.closed === undefined ? (held.failed?.note ?? held.revertFailed?.note) : undefined,
    closed: held.closed,
    send: () => sendDraft(),
    retry: () => {
      const { failed, revertFailed } = held;
      if (revertFailed !== undefined) return revert(revertFailed.messageId);
      if (failed === undefined) return;
      if (failed.inBox) sendDraft(failed.clientKey);
      else resend(failed.lineId);
    },
    retryLine: resend,
    sent,
    unsent: { words: kept.draft.text, attachments: kept.draft.attachments },
    editing: held.editing,
    edit: (messageId, words) => {
      // Note that the box's own words wait behind an edit begun over them, unless one already was.
      const beforeEdit = held.editing === undefined ? kept.draft : held.beforeEdit;
      setHeld((was) => ({
        ...editLetsGo(was),
        editing: messageId,
        beforeEdit,
        revertFailed: undefined,
      }));
      kept.update(() => ({ ...EMPTY_DRAFT, text: words }));
    },
    dropEdit: () => {
      const { beforeEdit } = held;
      setHeld((was) => ({ ...editLetsGo(was), editing: undefined, beforeEdit: EMPTY_DRAFT }));
      kept.update(() => beforeEdit);
    },
    revert,
    cut: held.cut,
  };
}
