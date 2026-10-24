import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentCallFailure,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAnswerParams,
  type CodingAgentInboxAttachmentParams,
  type CodingAgentInboxAttachmentView,
  type CodingAgentInboxMessagedView,
  type CodingAgentInboxMessageParams,
  type CodingAgentInboxScope,
  type CodingAgentInboxStartParams,
  INBOX_SCOPE_KIND,
} from "@luke/features/coding-agent-view";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { inboxAttachmentIdsIn } from "@luke/features/inbox-attachment-link";
import { INBOX_REPLY, INBOX_STATUS, type InboxItem } from "@luke/features/inbox-wire";
import { Equal } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DRAFT_PLACE,
  type Draft,
  draftOfItem,
  EMPTY_DRAFT,
  type InboxPlace,
  useDraftWriter,
  useInboxDrafts,
} from "../composer-drafts.js";
import { messageFailureWords } from "./coding-agent-model.js";
import { useInboxArrivals } from "./inbox-arrivals.js";
import {
  awaitsNod,
  EMPTY_INBOX_DRAFT,
  type InboxBoardView,
  type InboxDraft,
  type InboxNote,
  inboxBoard,
  inboxThreadSend,
} from "./inbox-model.js";
import { useInboxSettler, useSettledItems } from "./inbox-settling.js";
import { type InboxFollower, useFollowedInboxes } from "./use-followed-inboxes.js";

/**
 * use-task-inbox.ts -- the open task's inbox as one control: its items, followed while the window shows the tasks and pushed as they change, and the answers on their way back.
 *
 * The inbox is followed (`use-followed-inboxes.ts`) while the window shows
 * the tasks and a task with an agent, or one main says an item waits on,
 * is open, so the tab's count stands whichever tab is chosen, and another
 * task starts from nothing of this one's. Each push is the inbox whole,
 * which replaces what was held; nothing here asks again or holds a cursor.
 * An item marked read or unread is pushed as any change is, so nothing
 * reads it again. An inbox that could not be read is let go and says so,
 * with Try again, rather than following it again at once.
 *
 * A message on an item's thread goes under a key minted here and kept with
 * its words, open or settled, so the same message sent again after a lost
 * reply is taken once, and comes back as the item with its thread, which
 * replaces the one held; once taken it stands over the window's other
 * reads of the item until they hold it. It reaches the agent as one of the
 * developer's messages, which may wake it, so the agents are read again.
 * As the agent's own box does (`use-agent-composer.ts`), a send takes what
 * the box holds out of it at once, so the box stands empty and open while
 * the message is out, and a message refused leaves nothing on the thread,
 * its words and files coming back into the box where it holds nothing
 * newer, and the box says why. Only one send of an item is out at a time,
 * so a second Enter before the first lands sends nothing again. A message
 * may carry the answer to its thread's open ask, which the reader pressed
 * and attached: such a reply settles the ask, so it stands over every read
 * the window draws the item from the moment it is sent
 * (`inbox-settling.ts`), so the item leaves what needs the developer at
 * once and no read behind it brings it back, and a refusal brings the item
 * back as it stood, its draft kept.
 *
 * A notice's nod, Got it, goes the same way under a key minted for the
 * revision it nods to, so a nod sent again after a lost reply is taken
 * once, and is laid over every read as an answer is. A nod to a notice its
 * agent posted over first is not taken, and the card says so above the
 * item as it now stands. A nod the agent waits on (`needsReply`) reaches
 * it, which may start its turn again, so the task's agents are read again
 * for where they stand.
 *
 * Each file a message carried and each picture of the item's own its
 * Markdown draws names an attachment the service keeps, and their bytes are
 * read apart from the inbox, once per attachment while the task is open,
 * as a card first draws it: the host fetches them under the account
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
 * message's are. A settled item's box keeps the message being written the
 * same way. A read of the inbox
 * lets go of the drafts of items it no longer holds at their revision, save
 * that the words and files written on an item the agent posted on again are
 * carried to it as it now stands, and a nod taken or a message written
 * lets go of its own.
 */

/** How one nod is sent: the item, the revision it nods to, and the key the send is known by. */
export type InboxAnswerer = (
  params: CodingAgentInboxAnswerParams,
) => Promise<CodingAgentInboxAnsweredView>;

/** How one message on an item's thread is sent: the item, the words and files, and the key the send is known by. */
export type InboxMessenger = (
  params: CodingAgentInboxMessageParams,
) => Promise<CodingAgentInboxMessagedView>;

/** How one thread is started with an agent: the agent, its subject, the words and files, and the key the send is known by. */
export type InboxThreadStarter = (
  params: CodingAgentInboxStartParams,
) => Promise<CodingAgentInboxMessagedView>;

/** How one image is read: the item and the attachment it names, answered as the view hears it. */
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
  /** The items whose send is on its way, by id. */
  readonly sending: ReadonlySet<string>;
  /** Why a send did not go, or was not taken, by item, said on its card until the next send. */
  readonly notes: ReadonlyMap<string, InboxNote>;
  /** Lets go of an item's note once what it said no longer stands, as an agent unarchived from it; nothing where a later send has said something else since. */
  readonly onDropNote: (itemId: string, note: InboxNote) => void;
  /** What the developer has put on the item's card so far, at the revision it stands at; an empty card where nothing, or where the agent has changed the item since. */
  readonly draftOf: (item: InboxItem) => InboxDraft;
  /** Whether a card holds a draft for its item as it now stands, which the Inbox tab marks with the pencil (`draft-mark.tsx`). */
  readonly drafted: boolean;
  /** Keeps what the developer has put on the item's card, at its revision. */
  readonly onDraft: (item: InboxItem, draft: InboxDraft) => void;
  /** Moves the files on the item's card on from what they are as the write lands, so two reads landing in one render both stand. */
  readonly onAttachments: (
    item: InboxItem,
    next: (was: readonly CodingAgentAttachment[]) => readonly CodingAgentAttachment[],
  ) => void;
  /** Nods to a notice with Got it, settling it at the revision drawn; nothing where a send is out. */
  readonly onAcknowledge: (item: InboxItem) => void;
  /** Sends the box's words and files as a message on the item's thread, open or settled, with the answer attached to the thread's open ask where one is; nothing where it holds nothing the service takes or a send is out. */
  readonly onMessage: (item: InboxItem, draft: InboxDraft) => void;
  /** The images the cards asked for, by attachment, as each read came back; none while a read is out. */
  readonly images: ReadonlyMap<string, InboxImage>;
  /** Asks for an image a card draws, where it is neither held nor on its way. */
  readonly onImage: (itemId: string, attachmentId: string) => void;
  /** Reads an image again whose read did not answer. */
  readonly onRetryImage: (attachmentId: string) => void;
}

/** What a card says when its nod was not taken, by what had become of the item. */
const INBOX_NOT_TAKEN_NOTE = {
  /** The agent changed the item before the nod landed. */
  CHANGED: "The agent changed this item before your answer landed. Answer it as it stands now.",
  /** The item was answered first, from another window or Mac. */
  ANSWERED: "This item was already answered.",
  /** The agent took the item back first. */
  CLOSED: "The agent took this item back.",
  /** A member resolved the item first, from another window or Mac. */
  CLOSED_BY_MEMBER: "This item was already resolved.",
} as const;

/** Why a nod was not taken, from the item as the service answered it. */
function notTakenNote(item: InboxItem): string {
  switch (item.status) {
    case INBOX_STATUS.ANSWERED:
      return INBOX_NOT_TAKEN_NOTE.ANSWERED;
    case INBOX_STATUS.CLOSED:
      return item.closedBy === undefined
        ? INBOX_NOT_TAKEN_NOTE.CLOSED
        : INBOX_NOT_TAKEN_NOTE.CLOSED_BY_MEMBER;
    case INBOX_STATUS.OPEN:
      return INBOX_NOT_TAKEN_NOTE.CHANGED;
  }
}

/** A send's key and words, kept so the same send sent again goes under the same key. */
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

/** The open task's inbox is let go with its items, so another task's, or a later look at this one, never starts from them. */
const FORGET_LET_GO = { forget: true } as const;

/**
 * Every attachment the items name: the files their threads' messages
 * carried, and the item's own pictures those messages' Markdown draws
 * (`inbox-attachment-link`).
 */
function attachmentsNamed(items: readonly InboxItem[]): ReadonlySet<string> {
  const named = new Set<string>();
  for (const item of items) {
    for (const message of item.thread ?? []) {
      for (const file of message.files ?? []) named.add(file.attachmentId);
      for (const attachmentId of inboxAttachmentIdsIn(message.text, item.id)) {
        named.add(attachmentId);
      }
    }
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

/**
 * Where an item's card keeps its draft: the reply while the item is open,
 * and a message on its thread once it is settled, apart, so an answer left
 * unsent when another member settles the item never becomes a message.
 */
function draftPlace(item: InboxItem, taskId: string | null): InboxPlace {
  const place: InboxPlace = {
    kind: DRAFT_PLACE.INBOX,
    planId: taskId,
    agentId: item.agentId,
    itemId: item.id,
    revision: item.revision,
  };
  return item.status === INBOX_STATUS.OPEN ? place : { ...place, thread: true };
}

/** The items with one replaced by the service's newer word on it. */
function withItem(items: readonly InboxItem[], item: InboxItem): readonly InboxItem[] {
  return items.some((each) => each.id === item.id)
    ? items.map((each) => (each.id === item.id ? item : each))
    : [item, ...items];
}

/**
 * Whether a read holds the draft's item at an older revision than the draft
 * was written against, as one reader of a plan does while another has heard
 * the agent's newer post first; such a reader leaves the draft be, since its
 * read is what is out of date.
 */
function behind(items: readonly InboxItem[], place: InboxPlace): boolean {
  return items.some((item) => item.id === place.itemId && item.revision < place.revision);
}

/** A card's draft as the drafts keep it. */
function keptDraft(draft: InboxDraft): Draft {
  return {
    text: draft.note,
    attachments: draft.attachments,
    choices: draft.choices,
    values: draft.values,
    steps: draft.steps,
    press: draft.press,
  };
}

/** Whether a card holds nothing at all: no words, files, picks, fields, steps, or press. */
function holdsNothing(draft: Draft): boolean {
  return (
    draft.text === "" &&
    draft.attachments.length === 0 &&
    draft.choices.length === 0 &&
    draft.values.length === 0 &&
    (draft.steps ?? []).length === 0 &&
    draft.press === undefined
  );
}

export function useTaskInbox(input: {
  /** The task whose inbox is held, or, with `kind` an agent's, the agent with no task whose inbox is. */
  taskId: string | undefined;
  /** Whose inbox `taskId` names: a task's, unless it is one agent's with no task. */
  kind?: CodingAgentInboxScope["kind"] | undefined;
  /** Whether the window shows the tasks. */
  shown: boolean;
  /** Whether this Inbox is the one on screen, which says what lands in it (`inbox-arrivals.ts`); none where it is not. */
  onScreen?: boolean | undefined;
  /** Whether main's read of what waits across the account says an item waits on the task. */
  waiting: boolean;
  /** The reader's account id, which says whose of the open items wait on them; none before it is known. */
  readerId: string | undefined;
  agents: {
    /** Every agent of the task by id, an archived one among them, whose items still stand. */
    readonly heldIds: readonly string[] | undefined;
    /** How the inbox is followed and heard pushed. */
    readonly inboxFollower: InboxFollower;
    readonly answerInbox: InboxAnswerer;
    readonly messageInbox: InboxMessenger;
    readonly readInboxImage: InboxImageReader;
    /** Reads the task's agents again, for where an agent an answer reached stands now. */
    readonly onRetryList: () => void;
  };
}): TaskInboxControl {
  const { taskId, shown, waiting, readerId, agents } = input;
  const kind = input.kind ?? INBOX_SCOPE_KIND.PLAN;
  const [held, setHeld] = useState<Held>(() => fresh(taskId));
  if (held.taskId !== taskId) setHeld(fresh(taskId));
  useInboxArrivals(held, input.onScreen === true);
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
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const [notes, setNotes] = useState<ReadonlyMap<string, InboxNote>>(new Map());
  // The cards' drafts, kept apart from the hook so another tab's or page's reading of the inbox
  // shares them, under the plan, or under none where the inbox is an agent's with no plan.
  const ownTask = kind === INBOX_SCOPE_KIND.PLAN ? taskId : undefined;
  const draftsOn = ownTask ?? null;
  // Note that an agent with no plan is the planId its inbox is read by.
  const readAgent = kind === INBOX_SCOPE_KIND.AGENT ? taskId : undefined;
  const drafts = useInboxDrafts(draftsOn);
  // The drafts as last drawn, which a refusal landing later reads.
  const draftsNow = useRef(drafts);
  draftsNow.current = drafts;
  const writer = useDraftWriter();
  const settler = useInboxSettler();
  const attempts = useRef(new Map<string, Attempt>());
  // The items whose send is out, as `sending` holds them but at once, so a second press before
  // the render that draws the first sends nothing again.
  const out = useRef(new Set<string>());
  const latest = useRef({ ...agents, taskId });
  latest.current = { ...agents, taskId };

  // A task with no agent, standing or archived, has no Inbox tab and nothing
  // to follow, unless an item waits on it, which an agent this window has not
  // listed, one started on another Mac, posted.
  const readable = (agents.heldIds?.length ?? 0) > 0 || waiting;
  const active = shown && taskId !== undefined && readable;
  // Note that a task taken up again holds nothing until its follow pushes anew, since the push kept
  // from before lacks every item posted since, and the Inbox would draw it over its list's fresh read.
  const followed = useFollowedInboxes(
    kind,
    useMemo(() => (active && taskId !== undefined ? [taskId] : []), [active, taskId]),
    agents.inboxFollower,
    FORGET_LET_GO,
  );
  const pushed = taskId === undefined ? undefined : followed.items.get(taskId);
  const notRead = taskId !== undefined && followed.failed.has(taskId);
  // Each push is the inbox whole, which replaces what was held, an answer's own patch among it.
  useEffect(() => {
    if (pushed !== undefined) setHeld((was) => ({ ...was, items: pushed, read: true }));
  }, [pushed]);
  useEffect(() => {
    setHeld((was) => (was.failed === notRead ? was : { ...was, failed: notRead }));
  }, [notRead]);

  const { onRetry: retryFollow } = followed;
  const onRetry = useCallback(() => {
    setHeld((was) => ({ ...was, failed: false }));
    retryFollow();
  }, [retryFollow]);

  const note = useCallback((itemId: string, said: InboxNote | undefined) => {
    setNotes((was) => {
      const next = new Map(was);
      if (said === undefined) next.delete(itemId);
      else next.set(itemId, said);
      return next;
    });
  }, []);
  const onDropNote = useCallback((itemId: string, said: InboxNote) => {
    setNotes((was) => {
      if (was.get(itemId) !== said) return was;
      const next = new Map(was);
      next.delete(itemId);
      return next;
    });
  }, []);

  // Note that a refusal naming no agent may be an archive the list has not read yet, so the agents are read again for the card to say which.
  const refused = useCallback(
    (itemId: string, failure: CodingAgentCallFailure) => {
      note(itemId, { words: messageFailureWords(failure), failure });
      if (failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND) latest.current.onRetryList();
    },
    [note],
  );

  // A send that settled its item at once, refused, brings the item back open, where a message
  // written on it meanwhile would read as no draft of it and be let go; so its words and files are
  // carried into the open box beside the picks it holds. Note that they take the place of the words
  // that went, and are joined after any the open box holds besides, as another window may have
  // written there meanwhile, so neither is lost.
  const reopen = useCallback(
    (item: InboxItem, went: Pick<Draft, "text" | "attachments">) => {
      if (item.status !== INBOX_STATUS.OPEN) return;
      const open = draftPlace(item, draftsOn);
      const settled: InboxPlace = { ...open, thread: true };
      const written = draftsNow.current.find((kept) => Equal.equals(kept.place, settled));
      if (written === undefined) return;
      if (written.text !== "" || written.attachments.length > 0) {
        writer.update(open, (was) => {
          const text = was.text === went.text ? "" : was.text;
          const attachments = Equal.equals(was.attachments, went.attachments)
            ? []
            : was.attachments;
          return {
            ...was,
            text: [text, written.text].filter((words) => words !== "").join("\n"),
            attachments: [...attachments, ...written.attachments],
          };
        });
      }
      writer.drop((place) => Equal.equals(place, settled));
    },
    [writer, draftsOn],
  );

  // Note that a nod is keyed by the revision it nods to, so a press again after a lost reply is
  // taken once, and a nod to the notice posted over since goes under a key of its own.
  const onAcknowledge = useCallback(
    (item: InboxItem) => {
      if (out.current.has(item.id)) return;
      out.current.add(item.id);
      const words = JSON.stringify([item.revision, INBOX_REPLY.ACKNOWLEDGED]);
      const was = attempts.current.get(item.id);
      const key = was?.words === words ? was.key : crypto.randomUUID();
      attempts.current.set(item.id, { key, words });
      setSending((standing) => new Set(standing).add(item.id));
      note(item.id, undefined);
      // Note that the nod stands over every read the moment it is sent, so no read the window draws from brings the item back while it lands.
      const sent = settler.acknowledge(item);
      const askedOn = taskId;
      latest.current
        .answerInbox({
          itemId: item.id,
          revision: item.revision,
          reply: INBOX_REPLY.ACKNOWLEDGED,
          clientKey: key,
        })
        .catch((): CodingAgentInboxAnsweredView => UNANSWERED)
        .then((answer) => {
          out.current.delete(item.id);
          setSending((standing) => {
            const next = new Set(standing);
            next.delete(item.id);
            return next;
          });
          if ("failure" in answer) {
            settler.refuse(sent);
            refused(item.id, answer.failure);
            return;
          }
          // A nod landing after the window moved to another task is that task's no longer.
          setHeld((standing) =>
            standing.taskId === askedOn
              ? { ...standing, items: withItem(standing.items, answer.item) }
              : standing,
          );
          if (!answer.taken) {
            settler.refuse(sent);
            note(item.id, { words: notTakenNote(answer.item) });
            return;
          }
          settler.take(sent, answer.item);
          // Note that a message being written on the item settled meanwhile is kept, since the box takes words while the nod is out.
          writer.drop(
            (place) =>
              place.kind === DRAFT_PLACE.INBOX && place.itemId === item.id && place.thread !== true,
          );
          // Note that a nod the agent waits on reaches it and may open its turn, so the agents are read again.
          if (item.needsReply) latest.current.onRetryList();
        });
    },
    [note, refused, taskId, writer, settler],
  );

  const onMessage = useCallback(
    (item: InboxItem, draft: InboxDraft) => {
      const message = inboxThreadSend(item.thread ?? [], draft);
      if (message === undefined || out.current.has(item.id)) return;
      out.current.add(item.id);
      const { text, attachments, answers } = message;
      // Note that a reply on a notice names the revision shown, so it settles that notice and never one posted since.
      const revision = awaitsNod(item) ? item.revision : undefined;
      const words = JSON.stringify([text, attachments, answers, revision]);
      const was = attempts.current.get(item.id);
      const key = was?.words === words ? was.key : crypto.randomUUID();
      attempts.current.set(item.id, { key, words });
      setSending((standing) => new Set(standing).add(item.id));
      note(item.id, undefined);
      // Note that the box lets go of what it sent at once, as the agent's box does, and takes it
      // back below where the send is refused, so it never stands holding words already sent.
      const place = draftPlace(item, draftsOn);
      const unsent = keptDraft(draft);
      writer.update(place, () => EMPTY_DRAFT);
      // Note that a reply carrying an answer settles the ask, so it stands over every read the moment it is sent, as an answer does.
      const sent = answers === undefined ? undefined : settler.answer(item, { text, answers });
      const askedOn = taskId;
      latest.current
        .messageInbox({
          itemId: item.id,
          text,
          ...(attachments.length === 0 ? undefined : { attachments }),
          ...(answers === undefined ? undefined : { answers }),
          ...(revision === undefined ? undefined : { revision }),
          clientKey: key,
        })
        .catch((): CodingAgentInboxMessagedView => UNANSWERED)
        .then((answer) => {
          out.current.delete(item.id);
          setSending((standing) => {
            const next = new Set(standing);
            next.delete(item.id);
            return next;
          });
          if ("failure" in answer) {
            if (sent !== undefined) settler.refuse(sent);
            writer.update(place, (now) => (holdsNothing(now) ? unsent : now));
            if (sent !== undefined) reopen(item, unsent);
            refused(item.id, answer.failure);
            return;
          }
          setHeld((standing) =>
            standing.taskId === askedOn
              ? { ...standing, items: withItem(standing.items, answer.item) }
              : standing,
          );
          // Note that the message stands over every other read until it holds it, so none draws the thread without it meanwhile.
          if (sent === undefined) settler.message(answer.item);
          else settler.take(sent, answer.item);
          // Note that the key is let go with the words, because the same words written again are a new message, which the service refuses under a key already spent.
          attempts.current.delete(item.id);
          // Note that a message reaches the agent as one of the developer's, which may wake it, so the agents are read again.
          latest.current.onRetryList();
        });
    },
    [note, refused, taskId, writer, settler, draftsOn, reopen],
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

  // The board draws the window's own answers and messages over the read until it holds them.
  const settled = useSettledItems(held.items);
  // A read lets go of the drafts of the items it covers that it no longer holds as they were
  // written for: a plan's, or, for an agent with no plan, that agent's alone. Note that a settled
  // item keeps its thread's draft, and an answer left unsent on an item settled since is let go.
  // Note that a draft of the item as the board draws it is kept too, so a message written on an
  // item the window's own send settled stands while the read still holds the item open.
  // Note that the agent posting on the item again moves its revision on, which starts its picks,
  // fields, and steps afresh, but the words and files being written on it are carried to the item
  // as it now stands, so a post landing while the developer writes never takes them.
  const { drop, update } = writer;
  useEffect(() => {
    if (!held.read || (ownTask === undefined && readAgent === undefined)) return;
    const stale = drafts.filter(
      (kept) =>
        (ownTask !== undefined || kept.place.agentId === readAgent) &&
        !held.items.some((item) => draftOfItem(kept.place, item)) &&
        !settled.some((item) => draftOfItem(kept.place, item)) &&
        !behind(held.items, kept.place) &&
        !behind(settled, kept.place),
    );
    if (stale.length === 0) return;
    for (const kept of stale) {
      const reposted = settled.find(
        (item) => item.id === kept.place.itemId && item.revision > kept.place.revision,
      );
      if (reposted === undefined || (kept.text === "" && kept.attachments.length === 0)) continue;
      update(draftPlace(reposted, draftsOn), (was) => ({
        ...was,
        text: was.text === "" ? kept.text : was.text,
        attachments: was.attachments.length === 0 ? kept.attachments : was.attachments,
      }));
    }
    drop((place) => stale.some((kept) => Equal.equals(kept.place, place)));
  }, [held.read, held.items, settled, ownTask, readAgent, drafts, drop, update, draftsOn]);

  const board = useMemo(() => inboxBoard(settled, readerId), [settled, readerId]);
  const draftOf = useCallback(
    (item: InboxItem): InboxDraft => {
      const kept = drafts.find((each) => draftOfItem(each.place, item));
      return kept === undefined
        ? EMPTY_INBOX_DRAFT
        : {
            choices: kept.choices,
            values: kept.values,
            note: kept.text,
            attachments: kept.attachments,
            steps: kept.steps,
            press: kept.press,
          };
    },
    [drafts],
  );
  const drafted = drafts.some((kept) => settled.some((item) => draftOfItem(kept.place, item)));
  const onDraft = useCallback(
    (item: InboxItem, draft: InboxDraft) =>
      writer.update(draftPlace(item, draftsOn), (was) => ({
        ...was,
        text: draft.note,
        choices: draft.choices,
        values: draft.values,
        attachments: draft.attachments,
        steps: draft.steps,
        press: draft.press,
      })),
    [writer, draftsOn],
  );

  const onAttachments = useCallback(
    (
      item: InboxItem,
      next: (was: readonly CodingAgentAttachment[]) => readonly CodingAgentAttachment[],
    ) =>
      writer.update(draftPlace(item, draftsOn), (was) => ({
        ...was,
        attachments: next(was.attachments),
      })),
    [writer, draftsOn],
  );

  return {
    board,
    draftOf,
    drafted,
    onDraft,
    onAttachments,
    reading: active && !held.read && !held.failed,
    read: held.read,
    failed: held.failed,
    onRetry,
    sending,
    notes,
    onDropNote,
    onAcknowledge,
    onMessage,
    images,
    onImage,
    onRetryImage,
  };
}
