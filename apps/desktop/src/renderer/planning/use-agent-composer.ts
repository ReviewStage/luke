import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@luke/features/coding-agent-view";
import {
  type CodingAgentAttachment,
  type CodingAgentMessage,
  hasWordsOrFiles,
} from "@luke/features/coding-agent-wire";
import type { Failure } from "@luke/features/failure-remedy";
import { wordsBesideQuotes } from "@luke/ui/reply-quote";
import { useEffect, useRef, useState } from "react";
import { DRAFT_PLACE, type Draft, EMPTY_DRAFT, useDraft } from "../composer-drafts";
import {
  type AgentRun,
  closesComposer,
  knownDeveloperRows,
  messageFailureNote,
  type SentLine,
  unreadSentLines,
} from "./coding-agent-model";

/**
 * use-agent-composer.ts -- the message box under an agent's transcript as one control: the words being written, a message on its way, why the last one did not go, and the lines sent that the transcript has not read back.
 *
 * A send takes the words out of the box and shows them in the transcript
 * at once as the developer's own line, before the service answers, and
 * holds the box while the answer is out. The service's answer is the
 * agent as it then stands, which is running, and the tab's status takes
 * it, so a message to an agent that had finished turns its status back
 * and starts the transcript reading again; the row the service wrote for
 * the line arrives on that read, and the line is let go in its favour
 * (`unreadSentLines`). Every send goes under a key of its own, minted
 * here, and a message that did not go comes back into the box with why
 * under it and Retry, which sends the words again under the same key, so
 * a send whose answer was lost reaches the agent once; editing the words
 * is a new message under a new key, so Retry goes with the edit, as it
 * does with a file put on or taken off. The files go with the words and
 * come back into the box with them. The agent's words a message quotes are
 * part of its words, as blockquotes (`@luke/ui/reply-quote`), but a quote
 * is no message of its own: words with nothing but quotes send nothing
 * without files beside them. A refusal
 * that is for good holds the box, disabled, with its reason under it.
 * Another agent's tab starts from nothing of this one's.
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
  /** Whether a message is on its way, during which the box takes nothing. */
  sending: boolean;
  /** Why the last message did not go, said under the box beside what mends it; nothing while none failed. */
  note: Failure | undefined;
  /** Why the agent takes no message any more, in the host's words; nothing while it does. */
  closed: string | undefined;
  /** Sends the words in the box, trimmed, and its files under a fresh key; nothing on an empty box, a send out, or a closed agent. */
  send: () => void;
  /** Sends the words in the box again under the failed message's key, so a send whose answer was lost reaches the agent once. */
  retry: () => void;
  /** The lines sent that the transcript has not read back yet, in order. */
  sent: readonly SentLine[];
}

interface Held {
  agentId: string;
  sending: boolean;
  /**
   * The last message that did not go: the key it went under, which Retry
   * sends again, the developer's rows the transcript held as it first went,
   * so the retry's line is read back by the row the first send may already
   * have written, and why not.
   */
  failed: { clientKey: string; known: ReadonlySet<string>; note: Failure } | undefined;
  closed: string | undefined;
  sent: readonly SentLine[];
  /** The service's rows that have answered a sent line, which no later line is read back by. */
  taken: ReadonlySet<string>;
  /** How many lines this tab has sent, which names the next. */
  count: number;
}

function fresh(agentId: string): Held {
  return {
    agentId,
    sending: false,
    failed: undefined,
    closed: undefined,
    sent: [],
    taken: new Set(),
    count: 0,
  };
}

/** What a sent line is named, apart from every row of the service's, which are UUIDs. */
const SENT_LINE_PREFIX = "sent-";

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** Whether a draft holds neither words nor files. */
function holdsNothing(draft: Draft): boolean {
  return draft.text === "" && draft.attachments.length === 0;
}

export function useAgentComposer(input: {
  agentId: string;
  /** The agent's plan, whose repository a refusal's remedy mends; null for an agent with no plan, whose refusal says its words alone. */
  planId: string | null;
  /** The transcript as the tab holds it, which a sent line is read back from. */
  messages: readonly CodingAgentMessage[];
  send: MessageSender;
  /** The service said where the agent stands now, which is newer than the list. */
  onStatus: (agentId: string, run: AgentRun) => void;
}): AgentComposerControl {
  const { agentId, messages } = input;
  const kept = useDraft({ kind: DRAFT_PLACE.AGENT, planId: input.planId, agentId });
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

  // A line the transcript has read back is let go in the service's favour,
  // and the row that answered it stays taken.
  const read = unreadSentLines(held.sent, messages, held.taken);
  const sent = read.lines;
  useEffect(() => {
    if (sent.length === held.sent.length) return;
    setHeld((was) => {
      const again = unreadSentLines(was.sent, latest.current.messages, was.taken);
      return { ...was, sent: again.lines, taken: again.taken };
    });
  }, [sent.length, held.sent.length]);

  const sendDraft = (
    clientKey: string = crypto.randomUUID(),
    known: ReadonlySet<string> = knownDeveloperRows(messages),
  ) => {
    const text = kept.draft.text.trim();
    const { attachments } = kept.draft;
    if (
      !hasWordsOrFiles(wordsBesideQuotes(text), attachments) ||
      held.sending ||
      held.closed !== undefined
    ) {
      return;
    }
    const id = `${SENT_LINE_PREFIX}${held.count + 1}`;
    const line: SentLine = { id, text, attachments, known };
    const { update } = kept;
    update(() => EMPTY_DRAFT);
    setHeld((was) => ({
      ...was,
      sending: true,
      failed: undefined,
      sent: [...was.sent, line],
      count: was.count + 1,
    }));
    latest.current
      .send(agentId, text, clientKey, attachments)
      .catch((): CodingAgentAgentAnswer => UNANSWERED)
      .then((answer) => {
        // An answer to another agent's tab, or to a tab since remounted, is nobody's.
        if (latest.current.agentId !== agentId) return;
        if ("failure" in answer) {
          const note = messageFailureNote(answer, latest.current.planId);
          // A line a row has already read back reached the agent whatever the answer said: the
          // row stands, so there is nothing to send again and nothing to put back in the box.
          if (!heldNow.current.sent.some((each) => each.id === id)) {
            setHeld((was) => ({ ...was, sending: false }));
            return;
          }
          // The words come back into the agent's draft where it holds nothing newer, and the line out of the transcript.
          update((now) => (holdsNothing(now) ? { ...EMPTY_DRAFT, text, attachments } : now));
          setHeld((was) => ({
            ...was,
            sending: false,
            failed: { clientKey, known, note },
            closed: closesComposer(answer.failure) ? note.text : was.closed,
            sent: was.sent.filter((each) => each.id !== id),
          }));
          return;
        }
        setHeld((was) => ({ ...was, sending: false }));
        latest.current.onStatus(agentId, answer.agent);
      });
  };

  return {
    draft: kept.draft.text,
    // Note that an edit lets Retry go, because the words are no longer the message that failed.
    setDraft: (text) => {
      if (text !== kept.draft.text) setHeld((was) => ({ ...was, failed: undefined }));
      kept.update((was) => ({ ...was, text }));
    },
    attachments: kept.draft.attachments,
    // Note that a file put on or taken off lets Retry go too, since the message is another.
    setAttachments: (next) => {
      setHeld((was) => ({ ...was, failed: undefined }));
      kept.update((was) => ({ ...was, attachments: next(was.attachments) }));
    },
    sending: held.sending,
    note: held.closed === undefined ? held.failed?.note : undefined,
    closed: held.closed,
    send: () => sendDraft(),
    retry: () => {
      if (held.failed !== undefined) sendDraft(held.failed.clientKey, held.failed.known);
    },
    sent,
  };
}
