import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@sidecar/hosted/coding-agent-view";
import type {
  CodingAgentDelivery,
  CodingAgentMessage,
  CodingAgentStatus,
} from "@sidecar/hosted/coding-agent-wire";
import { useEffect, useRef, useState } from "react";
import {
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
 * (`unreadSentLines`). A message that did not go comes back into the box
 * with why beside it and Retry, which sends the words again the same way;
 * editing the words is a new message, sent the way the developer next
 * chooses, so Retry goes with the edit. A refusal that is for good closes
 * the box with its reason in place of the field. Another agent's tab
 * starts from nothing of this one's.
 */

/** How one message is sent: the agent, the words, and how they reach a turn under way, answered as the view hears it. */
export type MessageSender = (
  agentId: string,
  text: string,
  delivery: CodingAgentDelivery,
) => Promise<CodingAgentAgentAnswer>;

/** Everything the composer draws and presses. */
export interface AgentComposerControl {
  /** The words in the box. */
  draft: string;
  setDraft: (text: string) => void;
  /** Whether a message is on its way, during which the box takes nothing. */
  sending: boolean;
  /** Why the last message did not go, said under the box beside Retry; nothing while none failed. */
  note: string | undefined;
  /** Why the agent takes no message any more, in the host's words; nothing while it does. */
  closed: string | undefined;
  /** Sends the words in the box, trimmed, the way named; nothing on an empty box, a send out, or a closed agent. */
  send: (delivery: CodingAgentDelivery) => void;
  /** Sends the words in the box again, the way the failed message went. */
  retry: () => void;
  /** The lines sent that the transcript has not read back yet, in order. */
  sent: readonly SentLine[];
}

interface Held {
  agentId: string;
  draft: string;
  sending: boolean;
  /** The last message that did not go: how it went, and why not. */
  failed: { delivery: CodingAgentDelivery; note: string } | undefined;
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
    draft: "",
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

export function useAgentComposer(input: {
  agentId: string;
  /** The transcript as the tab holds it, which a sent line is read back from. */
  messages: readonly CodingAgentMessage[];
  send: MessageSender;
  /** The service said where the agent stands now, which is newer than the list. */
  onStatus: (agentId: string, status: CodingAgentStatus) => void;
}): AgentComposerControl {
  const { agentId, messages } = input;
  const [held, setHeld] = useState<Held>(() => fresh(agentId));
  if (held.agentId !== agentId) setHeld(fresh(agentId));
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

  const sendDraft = (delivery: CodingAgentDelivery) => {
    const text = held.draft.trim();
    if (text === "" || held.sending || held.closed !== undefined) return;
    const id = `${SENT_LINE_PREFIX}${held.count + 1}`;
    const line: SentLine = { id, text, delivery, known: knownDeveloperRows(messages) };
    setHeld((was) => ({
      ...was,
      draft: "",
      sending: true,
      failed: undefined,
      sent: [...was.sent, line],
      count: was.count + 1,
    }));
    latest.current
      .send(agentId, text, delivery)
      .catch((): CodingAgentAgentAnswer => UNANSWERED)
      .then((answer) => {
        // An answer to another agent's tab, or to a tab since remounted, is nobody's.
        if (latest.current.agentId !== agentId) return;
        if ("failure" in answer) {
          const note = messageFailureNote(answer.failure);
          // The words come back into the box, and the line out of the transcript.
          setHeld((was) => ({
            ...was,
            draft: was.draft === "" ? text : was.draft,
            sending: false,
            failed: { delivery, note },
            closed: closesComposer(answer.failure) ? note : was.closed,
            sent: was.sent.filter((each) => each.id !== id),
          }));
          return;
        }
        setHeld((was) => ({ ...was, sending: false }));
        latest.current.onStatus(agentId, answer.agent.status);
      });
  };

  return {
    draft: held.draft,
    // Note that an edit lets Retry go, because the words are no longer the message that failed.
    setDraft: (text) =>
      setHeld((was) => ({
        ...was,
        draft: text,
        failed: text === was.draft ? was.failed : undefined,
      })),
    sending: held.sending,
    note: held.closed === undefined ? held.failed?.note : undefined,
    closed: held.closed,
    send: sendDraft,
    retry: () => {
      if (held.failed !== undefined) sendDraft(held.failed.delivery);
    },
    sent,
  };
}
