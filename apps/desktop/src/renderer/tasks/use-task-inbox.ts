import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAnswerParams,
  type CodingAgentInboxAnswerView,
  type CodingAgentInboxAttachmentParams,
  type CodingAgentInboxAttachmentView,
  type CodingAgentInboxParams,
} from "@luke/features/coding-agent-view";
import {
  INBOX_BLOCK,
  INBOX_CURSOR_START,
  INBOX_STATUS,
  type InboxItem,
  type InboxReplyKind,
  inboxAnswerHeard,
  knownBlock,
} from "@luke/features/inbox-wire";
import { Equal } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DRAFT_PLACE, useDraftWriter, useInboxDrafts } from "../composer-drafts";
import { messageFailureWords } from "./coding-agent-model";
import {
  EMPTY_INBOX_DRAFT,
  type InboxBoardView,
  type InboxDraft,
  inboxBoard,
  inboxReply,
} from "./inbox-model";

/**
 * use-task-inbox.ts -- the open task's inbox as one control: its items, read on the service's held long-poll while the window shows the tasks, and the answers on their way back.
 *
 * The service holds a read open while nothing changed past the cursor and
 * lets it go at its own hold, so the loop is one read after another with no
 * clock of its own, as an agent's transcript is read (`use-agent-transcript.ts`);
 * each answer is the inbox whole, which replaces what was held. The loop
 * runs while the window shows the tasks and a task with an agent, or one
 * main says an item waits on, is open, so the tab's
 * count stands whichever tab is chosen, and another task starts from
 * nothing of this one's. A read that did not answer ends the loop and says
 * so, with Try again, rather than asking again at once.
 *
 * An answer goes under a key minted here and kept with its words, so the
 * same answer sent again after a lost reply is taken once; the service
 * answers with the item as it then stands, which replaces the one held. An
 * answer to an item its agent changed first is not taken, and the card says
 * so above the item as it now stands. An answer the agent was to hear
 * reached it as one of the developer's messages, which may have started
 * its turn again, so the task's agents are read again for where they stand.
 *
 * An image block names an attachment the service keeps, and so does each
 * file an answer carried, and their bytes are read apart from the inbox, once per attachment while the task is open,
 * as a card first draws the block: the host fetches them under the account
 * and the hook holds them as a `data:` URL the card draws, so a read of
 * the inbox that replaces every item draws the same picture again without
 * asking for it again, and a picture inside a settled card no one opened
 * is never asked for. A picture no item names any longer, once the agent
 * posted its item again, is let go, since the service deleted it too. A
 * picture landing before the hook's own read of the items does is kept all
 * the same, since the Inbox draws an item from its list's read first and
 * nothing would ask for the picture again, and so is one landing after
 * that read failed, when the Inbox draws from its list's read again; one
 * landing while that read stands, which no item names, is not. A read
 * that did not answer is held as failed, and the card offers to try again.
 *
 * What the developer has put on a card and not sent is its draft, kept by
 * item at the revision it was written against (`../composer-drafts.ts`), so
 * it waits through a look at another tab, task, or page, the Inbox's and the
 * plan's tab reading the same one, and its words outlast a relaunch; the
 * files attached to it are held in this window's memory alone, as a
 * message's are, and go with the answer apart from it. A read of the
 * inbox lets go of the drafts of items no longer open at their revision,
 * and an answer taken lets go of its own.
 */

/** How one read is asked: the task and the cursor to read past, answered as the view hears it. */
export type InboxReader = (params: CodingAgentInboxParams) => Promise<CodingAgentInboxAnswerView>;

/** How one answer is sent: the item, its revision, the answer, and the key the send is known by. */
export type InboxAnswerer = (
  params: CodingAgentInboxAnswerParams,
) => Promise<CodingAgentInboxAnsweredView>;

/** How one image is read: the item and the attachment its block names, answered as the view hears it. */
export type InboxImageReader = (
  params: CodingAgentInboxAttachmentParams,
) => Promise<CodingAgentInboxAttachmentView>;

/** One image as the hook holds it: the `data:` URL its card draws, or that its read did not answer. */
export type InboxImage = { readonly url: string } | { readonly failed: true };

/** What the tab draws and presses. */
export interface TaskInboxControl {
  readonly board: InboxBoardView;
  /** Whether a read is out, with nothing held yet to draw. */
  readonly reading: boolean;
  /** Whether a read of the task's inbox has answered, so the board is what it holds rather than nothing yet. */
  readonly read: boolean;
  /** Whether the last read did not answer, so the tab offers to try again. */
  readonly failed: boolean;
  readonly onRetry: () => void;
  /** The items whose answer is on its way, by id. */
  readonly sending: ReadonlySet<string>;
  /** Why an answer did not go, or was not taken, by item, said on its card until the next send. */
  readonly notes: ReadonlyMap<string, string>;
  /** What the developer has put on the item's card so far, at the revision it stands at; an empty card where nothing, or where the agent has changed the item since. */
  readonly draftOf: (item: InboxItem) => InboxDraft;
  /** Keeps what the developer has put on the item's card, at its revision. */
  readonly onDraft: (item: InboxItem, draft: InboxDraft) => void;
  /** Sends the card's answer, with the press where its kind is answered by one; nothing where it holds none or one is out. */
  readonly onAnswer: (item: InboxItem, draft: InboxDraft, press?: InboxReplyKind) => void;
  /** The images the cards asked for, by attachment, as each read came back; none while a read is out. */
  readonly images: ReadonlyMap<string, InboxImage>;
  /** Asks for an image a card draws, where it is neither held nor on its way. */
  readonly onImage: (itemId: string, attachmentId: string) => void;
  /** Reads an image again whose read did not answer. */
  readonly onRetryImage: (attachmentId: string) => void;
}

/** What a card says when its answer was not taken, by what had become of the item. */
const INBOX_NOT_TAKEN_NOTE = {
  /** The agent changed the item before the answer landed. */
  CHANGED: "The agent changed this item before your answer landed. Answer it as it stands now.",
  /** The item was answered first, from another window or Mac. */
  ANSWERED: "This item was already answered.",
  /** The agent took the item back first. */
  CLOSED: "The agent took this item back.",
} as const;

/** Why an answer was not taken, from the item as the service answered it. */
function notTakenNote(item: InboxItem): string {
  switch (item.status) {
    case INBOX_STATUS.ANSWERED:
      return INBOX_NOT_TAKEN_NOTE.ANSWERED;
    case INBOX_STATUS.CLOSED:
      return INBOX_NOT_TAKEN_NOTE.CLOSED;
    case INBOX_STATUS.OPEN:
      return INBOX_NOT_TAKEN_NOTE.CHANGED;
  }
}

/** An answer's key and words, kept so the same answer sent again goes under the same key. */
interface Attempt {
  readonly key: string;
  readonly words: string;
}

interface Held {
  readonly taskId: string | undefined;
  readonly items: readonly InboxItem[];
  readonly read: boolean;
  readonly failed: boolean;
}

function fresh(taskId: string | undefined): Held {
  return { taskId, items: [], read: false, failed: false };
}

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** Every attachment the items name: their blocks' pictures, and the files their answers carried. */
function attachmentsNamed(items: readonly InboxItem[]): ReadonlySet<string> {
  const named = new Set<string>();
  for (const item of items) {
    for (const block of item.blocks) {
      if (knownBlock(block) && block.type === INBOX_BLOCK.IMAGE) named.add(block.attachmentId);
    }
    for (const file of item.answerFiles ?? []) named.add(file.attachmentId);
  }
  return named;
}

/** The images held under the attachments still named; the rest let go. */
function imagesNamed(
  images: ReadonlyMap<string, InboxImage>,
  named: ReadonlySet<string>,
): ReadonlyMap<string, InboxImage> {
  if ([...images.keys()].every((attachmentId) => named.has(attachmentId))) return images;
  return new Map([...images].filter(([attachmentId]) => named.has(attachmentId)));
}

/** The items with one replaced by the service's newer word on it. */
function withItem(items: readonly InboxItem[], item: InboxItem): readonly InboxItem[] {
  return items.some((each) => each.id === item.id)
    ? items.map((each) => (each.id === item.id ? item : each))
    : [item, ...items];
}

export function useTaskInbox(input: {
  /** The task whose inbox is held, or, with `reader`, the agent with no task whose inbox is. */
  taskId: string | undefined;
  /** How the inbox is read where it is one agent's with no task rather than a task's. */
  reader?: ((after: string) => Promise<CodingAgentInboxAnswerView>) | undefined;
  /** Whether the window shows the tasks. */
  shown: boolean;
  /** Whether main's read of what waits across the account says an item waits on the task. */
  waiting: boolean;
  agents: {
    /** Every agent of the task by id, an archived one among them, whose items still stand. */
    readonly heldIds: readonly string[] | undefined;
    readonly readInbox: InboxReader;
    readonly answerInbox: InboxAnswerer;
    readonly readInboxImage: InboxImageReader;
    /** Reads the task's agents again, for where an agent an answer reached stands now. */
    readonly onRetryList: () => void;
  };
}): TaskInboxControl {
  const { taskId, shown, waiting, agents } = input;
  const [held, setHeld] = useState<Held>(() => fresh(taskId));
  if (held.taskId !== taskId) setHeld(fresh(taskId));
  const [images, setImages] = useState<ReadonlyMap<string, InboxImage>>(new Map());
  // The reads out now, by attachment, so an item drawn again while its read is out asks once.
  const reading = useRef(new Set<string>());
  // The attachments the items name now, so a picture an item no longer names is let go, and one
  // landing for it while this hook's read is what the pane draws is not kept.
  const named = useMemo(() => attachmentsNamed(held.items), [held.items]);
  // Note that a read that failed is drawn no longer, since the Inbox falls back to its list's read.
  const namedNow = useRef({ drawn: held.read && !held.failed, named });
  namedNow.current = { drawn: held.read && !held.failed, named };
  useEffect(() => {
    setImages((standing) => imagesNamed(standing, named));
  }, [named]);
  const [attempt, setAttempt] = useState(0);
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map());
  // The cards' drafts, kept apart from the hook so another tab's or page's reading of the inbox
  // shares them, under the plan, or under none where the inbox is an agent's with no plan.
  const ownPlan = input.reader === undefined ? taskId : undefined;
  const draftsOn = ownPlan ?? null;
  // Note that an agent with no plan is the planId its inbox is read by.
  const readAgent = input.reader === undefined ? undefined : taskId;
  const drafts = useInboxDrafts(draftsOn);
  const writer = useDraftWriter();
  const attempts = useRef(new Map<string, Attempt>());
  const latest = useRef({ ...agents, taskId, reader: input.reader });
  latest.current = { ...agents, taskId, reader: input.reader };

  // A task with no agent, standing or archived, has no Inbox tab and nothing
  // to read, so it holds no read open, unless an item waits on it, which an
  // agent this window has not listed, one started on another Mac, posted.
  const readable = (agents.heldIds?.length ?? 0) > 0 || waiting;
  const active = shown && taskId !== undefined && readable && !held.failed;
  useEffect(() => {
    if (!active || taskId === undefined) return;
    let live = true;
    const loop = async () => {
      let after = INBOX_CURSOR_START;
      while (live) {
        const { reader, readInbox } = latest.current;
        const read = reader === undefined ? readInbox({ taskId: taskId, after }) : reader(after);
        const answer = await read.catch((): CodingAgentInboxAnswerView => UNANSWERED);
        if (!live) return;
        if ("failure" in answer) {
          setHeld((was) => ({ ...was, failed: true }));
          return;
        }
        after = answer.cursor;
        setHeld((was) => ({ ...was, items: answer.items, read: true }));
      }
    };
    void loop();
    return () => {
      live = false;
    };
  }, [active, taskId, attempt]);

  const onRetry = useCallback(() => {
    setHeld((was) => ({ ...was, failed: false }));
    setAttempt((count) => count + 1);
  }, []);

  const note = useCallback((itemId: string, words: string | undefined) => {
    setNotes((was) => {
      const next = new Map(was);
      if (words === undefined) next.delete(itemId);
      else next.set(itemId, words);
      return next;
    });
  }, []);

  const onAnswer = useCallback(
    (item: InboxItem, draft: InboxDraft, press?: InboxReplyKind) => {
      const reply = inboxReply(item, draft, press);
      if (reply === undefined || sending.has(item.id)) return;
      const { attachments } = draft;
      const words = JSON.stringify([item.revision, reply, attachments]);
      const was = attempts.current.get(item.id);
      const key = was?.words === words ? was.key : crypto.randomUUID();
      attempts.current.set(item.id, { key, words });
      setSending((standing) => new Set(standing).add(item.id));
      note(item.id, undefined);
      const askedOn = taskId;
      latest.current
        .answerInbox({
          itemId: item.id,
          revision: item.revision,
          ...reply,
          ...(attachments.length === 0 ? undefined : { attachments }),
          clientKey: key,
        })
        .catch((): CodingAgentInboxAnsweredView => UNANSWERED)
        .then((answer) => {
          setSending((standing) => {
            const next = new Set(standing);
            next.delete(item.id);
            return next;
          });
          if ("failure" in answer) {
            note(item.id, messageFailureWords(answer.failure));
            return;
          }
          // An answer landing after the window moved to another task is that task's no longer.
          setHeld((standing) =>
            standing.taskId === askedOn
              ? { ...standing, items: withItem(standing.items, answer.item) }
              : standing,
          );
          if (!answer.taken) {
            note(item.id, notTakenNote(answer.item));
            return;
          }
          writer.drop((place) => place.kind === DRAFT_PLACE.INBOX && place.itemId === item.id);
          // Note that an answer the agent hears may open its turn, so the agents are read again.
          if (inboxAnswerHeard(item, reply, attachments)) latest.current.onRetryList();
        });
    },
    [sending, note, taskId, writer],
  );

  // An item of an agent the list has not read yet, one started from another
  // window, has the list read again, once for each such agent.
  const asked = useRef(new Set<string>());
  const ids = agents.heldIds;
  useEffect(() => {
    if (ids === undefined) return;
    const unknown = held.items
      .map((item) => item.agentId)
      .filter((agentId) => !ids.includes(agentId) && !asked.current.has(agentId));
    if (unknown.length === 0) return;
    for (const agentId of unknown) asked.current.add(agentId);
    latest.current.onRetryList();
  }, [held.items, ids]);
  // An image is read once, as a card first asks for it, and held under its attachment.
  const onImage = useCallback(
    (itemId: string, attachmentId: string) => {
      if (images.has(attachmentId) || reading.current.has(attachmentId)) return;
      reading.current.add(attachmentId);
      const askedOn = taskId;
      latest.current
        .readInboxImage({ itemId, attachmentId })
        .catch((): CodingAgentInboxAttachmentView => UNANSWERED)
        .then((answer) => {
          reading.current.delete(attachmentId);
          const image: InboxImage =
            "failure" in answer
              ? { failed: true }
              : { url: `data:${answer.contentType};base64,${answer.base64}` };
          // An image landing after the window moved to another task, or after this hook's drawn read let
          // its item's block go, is kept for nobody. Note that one landing while that read is not drawn,
          // before it lands or after it failed, is kept, because the Inbox's pane draws the item from its
          // list's read then, and nothing would ask for the picture again.
          const { drawn, named: namedThen } = namedNow.current;
          const kept = latest.current.taskId === askedOn && (!drawn || namedThen.has(attachmentId));
          setImages((standing) => (kept ? new Map(standing).set(attachmentId, image) : standing));
        });
    },
    [images, taskId],
  );
  // Another task's images are its own: what this one asked for is let go with its items.
  useEffect(() => {
    setImages(new Map());
    reading.current.clear();
  }, [taskId]);
  const onRetryImage = useCallback((attachmentId: string) => {
    setImages((standing) => {
      const next = new Map(standing);
      next.delete(attachmentId);
      return next;
    });
  }, []);

  // A read lets go of the drafts of the items it covers that are no longer open at the revision
  // they were written against: a plan's, or, for an agent with no plan, that agent's alone.
  const { drop } = writer;
  useEffect(() => {
    if (!held.read || (ownPlan === undefined && readAgent === undefined)) return;
    const stale = drafts.filter(
      (kept) =>
        (ownPlan !== undefined || kept.place.agentId === readAgent) &&
        !held.items.some(
          (item) =>
            item.id === kept.place.itemId &&
            item.revision === kept.place.revision &&
            item.status === INBOX_STATUS.OPEN,
        ),
    );
    if (stale.length === 0) return;
    drop((place) => stale.some((kept) => Equal.equals(kept.place, place)));
  }, [held.read, held.items, ownPlan, readAgent, drafts, drop]);

  const board = useMemo(() => inboxBoard(held.items), [held.items]);
  const draftOf = useCallback(
    (item: InboxItem): InboxDraft => {
      const kept = drafts.find(
        (each) => each.place.itemId === item.id && each.place.revision === item.revision,
      );
      return kept === undefined
        ? EMPTY_INBOX_DRAFT
        : {
            choices: kept.choices,
            values: kept.values,
            note: kept.text,
            attachments: kept.attachments,
          };
    },
    [drafts],
  );
  const onDraft = useCallback(
    (item: InboxItem, draft: InboxDraft) =>
      writer.update(
        {
          kind: DRAFT_PLACE.INBOX,
          planId: draftsOn,
          agentId: item.agentId,
          itemId: item.id,
          revision: item.revision,
        },
        (was) => ({
          ...was,
          text: draft.note,
          choices: draft.choices,
          values: draft.values,
          attachments: draft.attachments,
        }),
      ),
    [writer, draftsOn],
  );

  return {
    board,
    draftOf,
    onDraft,
    reading: active && !held.read,
    read: held.read,
    failed: held.failed,
    onRetry,
    sending,
    notes,
    onAnswer,
    images,
    onImage,
    onRetryImage,
  };
}
