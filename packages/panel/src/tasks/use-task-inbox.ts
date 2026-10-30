import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  type AgentInboxAnsweredView,
  type AgentInboxAnswerParams,
  type AgentInboxAttachmentParams,
  type AgentInboxAttachmentView,
  type AgentInboxMessagedView,
  type AgentInboxMessageParams,
  type AgentInboxScope,
  type AgentInboxStartParams,
  INBOX_SCOPE_KIND,
} from "@luke/features/agent-view";
import type { AgentAttachment } from "@luke/features/agent-wire";
import { inboxAttachmentIdsIn } from "@luke/features/inbox-attachment-link";
import { INBOX_REPLY, INBOX_STATUS, type InboxItem } from "@luke/features/inbox-wire";
import { LIVE_READ } from "@luke/features/live-wire";
import type { AppInboxItems } from "@luke/host/app-state";
import { Equal } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { afterPaint } from "../after-paint.js";
import {
  DRAFT_PLACE,
  type Draft,
  draftOfItem,
  EMPTY_DRAFT,
  holdsPicks,
  type InboxPlace,
  picksStandOn,
  useDraftWriter,
  useInboxDraftStandings,
  useInboxDrafts,
  withoutPicks,
} from "../composer-drafts.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
import { messageFailureWords } from "./agent-model.js";
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

/**
 * use-task-inbox.ts -- the open task's inbox as one control: its items, drawn from the account's feed at once and from the holder's own read as the host holds it, and the answers on their way back.
 *
 * The holder's own read, a task's by its plan or an agent's by its own id,
 * is held (`use-host-read.ts`) while the window shows the tasks and a task
 * with an agent, or one main says an item waits on, is open, so the tab's
 * count stands whichever tab is chosen; the host keeps it followed a while
 * after, so a task taken up again draws from where its read stands. The
 * account's feed of every item draws first, in the first frame, since it
 * holds the holder's items already, and the holder's read fills in what
 * the feed leaves out, such as settled items past its bound. Each read is
 * the inbox whole, which replaces what was held; nothing here asks again
 * or holds a cursor. An item marked read or unread reaches both reads as
 * any change does, so nothing reads it again. A holder's read that could
 * not be read says so, with Try again.
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
 * newer, and the box says why. A plain reply, one carrying no answer,
 * stands at the thread's end as the reader's own message the moment it is
 * sent, marked as sending, under the key it goes under, until its answer
 * lands, when the item the service answers holding it takes its place, or
 * a read holding it first does; refused, it leaves the thread as its words
 * go back. Only one send of an item is out at a time,
 * so a second Enter before the first lands sends nothing again. A message
 * may carry the answer to its thread's open ask, which the reader pressed
 * and attached: such a reply settles the ask, which the host draws into
 * every read the window draws the item from the moment it is sent
 * (`@luke/host`'s `inbox-collections.ts`), so the item leaves what needs the
 * developer at once and no read behind it brings it back, and a refusal
 * brings the item back as it stood, its draft kept. A send no answer came
 * back for may have reached the agent all the same, so its words go back
 * and the card says so only until the thread holds it, when it is taken as
 * sent: its note goes, and so do its words, where the box still holds them
 * as they went back.
 *
 * A notice's nod, Got it, goes the same way under a key minted for the
 * revision it nods to, so a nod sent again after a lost reply is taken
 * once, and the host draws it into every read as it draws an answer. A nod to a notice its
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
 * item (`../composer-drafts.ts`), so it waits through a look at another tab,
 * task, or page, the Inbox's and the plan's tab reading the same one, and
 * its words outlast a relaunch; the files attached to it are held in this
 * window's memory alone, as a message's are. A settled item's box keeps the
 * message being written the same way, in the same place, so a message
 * landing on the item, the agent posting on it again or a teammate's answer
 * settling it, never takes what is being written. Its picks are kept with
 * the revision they were made on and stand only while the item is open at
 * it. A read of the inbox lets go of the drafts of items it no longer holds
 * and of the picks it holds made on an item since changed, and a message
 * written lets go of its own.
 */

/** How one nod is sent: the item, the revision it nods to, and the key the send is known by. */
export type InboxAnswerer = (params: AgentInboxAnswerParams) => Promise<AgentInboxAnsweredView>;

/** How one message on an item's thread is sent: the item, the words and files, and the key the send is known by. */
export type InboxMessenger = (params: AgentInboxMessageParams) => Promise<AgentInboxMessagedView>;

/** How one thread is started with an agent: the agent, its subject, the words and files, and the key the send is known by. */
export type InboxThreadStarter = (params: AgentInboxStartParams) => Promise<AgentInboxMessagedView>;

/** How one image is read: the item and the attachment it names, answered as the view hears it. */
export type InboxImageReader = (
  params: AgentInboxAttachmentParams,
) => Promise<AgentInboxAttachmentView>;

/** One image as the hook holds it: the `data:` URL its card draws, or that its read did not answer. */
export type InboxImage = { readonly url: string } | { readonly failed: true };

/** A plain reply on its way, drawn at its thread's end until the item holds it: the key it goes under, its words and files, and when it was sent. */
export interface PendingInboxReply {
  readonly key: string;
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly at: number;
}

/**
 * Whether the item's thread holds the message sent under `key`, which the
 * service names on the reader's own messages alone. Note that the one the
 * host draws for an answer while it goes stands under the key as its id,
 * and carries none.
 */
function holdsSent(item: InboxItem, key: string): boolean {
  return (item.thread ?? []).some((message) => message.clientKey === key);
}

/** The reply on its way on `item`, where the thread drawn does not hold it yet, as a read may before its own answer lands. */
export function pendingReplyOn(
  pending: TaskInboxControl["pendingReplies"],
  item: InboxItem,
): PendingInboxReply | undefined {
  const reply = pending.get(item.id);
  if (reply === undefined) return undefined;
  return holdsSent(item, reply.key) ? undefined : reply;
}

/** What the tab draws and presses. */
export interface TaskInboxControl {
  readonly board: InboxBoardView;
  /** Whether a read is out, with nothing held yet to draw: neither the account's feed nor the holder's own read holds the holder. */
  readonly reading: boolean;
  /** Whether the holder's own read has answered, so the board holds what the feed leaves out, such as a settled item past its bound. */
  readonly read: boolean;
  /** Whether the board draws the holder's items, from the account's feed or the holder's own read, so an item opened is as the service holds it. */
  readonly drawn: boolean;
  /** Whether the last read did not answer, so the tab offers to try again. */
  readonly failed: boolean;
  readonly onRetry: () => void;
  /** The items whose send is on its way, by id. */
  readonly sending: ReadonlySet<string>;
  /** The plain replies on their way, by item, each drawn at its thread's end while it goes (`pendingReplyOn`). */
  readonly pendingReplies: ReadonlyMap<string, PendingInboxReply>;
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
    next: (was: readonly AgentAttachment[]) => readonly AgentAttachment[],
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

/** A reply no answer came back for, which may have landed all the same: the key it went under, the task it was sent on, where its words went back and as what, and what its card says of it. */
interface UnheardReply {
  readonly key: string;
  readonly taskId: string | undefined;
  readonly place: InboxPlace;
  readonly unsent: Draft;
  readonly note: InboxNote;
}

/** A send's key and words, kept so the same send sent again goes under the same key. */
interface Attempt {
  readonly key: string;
  readonly words: string;
}

interface Held {
  readonly taskId: string | undefined;
  readonly items: readonly InboxItem[];
  /** Whether the items are a read's, the feed's or the holder's own, rather than nothing yet. */
  readonly drawn: boolean;
}

/** The holder's items as its reads first stand: those read already, so a holder drawn again draws them in its first frame. */
function fresh(taskId: string | undefined, read: readonly InboxItem[] | undefined): Held {
  return { taskId, items: read ?? [], drawn: read !== undefined };
}

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/**
 * The holder's items as the account's feed holds them: a plan's whole, an
 * agent's with no plan its own, and an agent's on a plan its own among
 * that plan's; none where the feed has not answered, or holds nothing of
 * the holder, whose own read may still hold a settled item past the feed's
 * bound.
 */
function fedItemsOf(
  fed: AppInboxItems | undefined,
  kind: AgentInboxScope["kind"],
  id: string | undefined,
  planId: string | null | undefined,
): readonly InboxItem[] | undefined {
  if (fed === undefined || id === undefined) return undefined;
  if (kind === INBOX_SCOPE_KIND.PLAN) return fed[INBOX_SCOPE_KIND.PLAN][id];
  if (planId == null) return fed[INBOX_SCOPE_KIND.AGENT][id];
  return fed[INBOX_SCOPE_KIND.PLAN][planId]?.filter((item) => item.agentId === id);
}

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

/** An Inbox's pictures as read: each held by its attachment, and how one is asked for and asked for again. */
export type InboxImageReads = Pick<TaskInboxControl, "images" | "onImage" | "onRetryImage">;

/**
 * The pictures items draw, each read once as it is first drawn and held by
 * its attachment, for the task's Inbox and for a channel's stream, which
 * posts threads of many tasks. What `scope` reads is let go when it changes,
 * a picture no item among `items` names any longer is let go too, and one
 * landing after its scope moved on, or, while `drawn`, for an attachment no
 * item names, is kept for nobody. Note that one landing while not `drawn` is
 * kept, because the Inbox's pane draws the item from its list's read then,
 * and nothing would ask for the picture again.
 */
function useInboxImageReads(input: {
  read: InboxImageReader;
  scope: string | undefined;
  items: readonly InboxItem[];
  drawn: boolean;
}): InboxImageReads {
  const { scope, items, drawn } = input;
  const [images, setImages] = useState<ReadonlyMap<string, InboxImage>>(new Map());
  // The reads out now, by attachment, so an item drawn again while its read is out asks once.
  const reading = useRef(new Set<string>());
  const named = useMemo(() => attachmentsNamed(items), [items]);
  const latest = useRef({ read: input.read, scope, drawn, named });
  latest.current = { read: input.read, scope, drawn, named };
  useEffect(() => {
    setImages((standing) => imagesNamed(standing, named));
  }, [named]);
  const onImage = useCallback(
    (itemId: string, attachmentId: string) => {
      if (images.has(attachmentId) || reading.current.has(attachmentId)) return;
      reading.current.add(attachmentId);
      const askedOn = scope;
      // Note that a picture is read once the frame that drew its place has painted, so it never holds up the thread.
      afterPaint(() => {
        latest.current
          .read({ itemId, attachmentId })
          .catch((): AgentInboxAttachmentView => UNANSWERED)
          .then((answer) => {
            reading.current.delete(attachmentId);
            const image: InboxImage =
              "failure" in answer
                ? { failed: true }
                : { url: `data:${answer.contentType};base64,${answer.base64}` };
            const now = latest.current;
            const kept = now.scope === askedOn && (!now.drawn || now.named.has(attachmentId));
            setImages((standing) => (kept ? new Map(standing).set(attachmentId, image) : standing));
          });
      });
    },
    [images, scope],
  );
  // Another scope's images are its own: what this one asked for is let go with it.
  useEffect(() => {
    setImages(new Map());
    reading.current.clear();
  }, [scope]);
  const onRetryImage = useCallback((attachmentId: string) => {
    setImages((standing) => {
      const next = new Map(standing);
      next.delete(attachmentId);
      return next;
    });
  }, []);
  return { images, onImage, onRetryImage };
}

/** Where an item's card keeps its draft: the item, whatever its revision or status, so a message landing on it never moves the words being written. */
function draftPlace(item: InboxItem, taskId: string | null): InboxPlace {
  return { kind: DRAFT_PLACE.INBOX, planId: taskId, agentId: item.agentId, itemId: item.id };
}

/** The items with one replaced by the service's newer word on it. */
function withItem(items: readonly InboxItem[], item: InboxItem): readonly InboxItem[] {
  return items.some((each) => each.id === item.id)
    ? items.map((each) => (each.id === item.id ? item : each))
    : [item, ...items];
}

/**
 * Whether a draft's picks were made on its item as the read holds it or
 * earlier, so they can be let go where they stand no longer. Note that a
 * reader holding an older revision than the picks were made on, as one
 * reader of a plan does while another has heard the agent's newer post
 * first, leaves them be, since its read is what is out of date.
 */
function caughtUp(item: InboxItem, draft: Pick<Draft, "revision">): boolean {
  return draft.revision === undefined || item.revision >= draft.revision;
}

/** A card's draft as the drafts keep it, its picks made on the item at `revision`. */
function keptDraft(draft: InboxDraft, revision: number): Draft {
  return {
    revision,
    text: draft.note,
    attachments: draft.attachments,
    choices: draft.choices,
    values: draft.values,
    steps: draft.steps,
    press: draft.press,
  };
}

/**
 * What a box holds once a reply carrying an answer is refused: the words and
 * files that went, then any written on the thread while the answer stood
 * settled, and the picks that went unless others were made meanwhile.
 */
function withRefused(now: Draft, went: Draft): Draft {
  if (holdsNothing(now)) return went;
  return {
    ...(holdsPicks(now) ? now : went),
    text: [went.text, now.text].filter((words) => words !== "").join("\n"),
    attachments: [...went.attachments, ...now.attachments],
  };
}

/**
 * Whether a box holds just the words and files a reply gave back to it, so
 * letting go of them takes nothing written since. Note that its picks are
 * not compared, and are kept where they still stand, because the drafts
 * let go of those made on an item that has changed since, as the reply
 * landing changes it, and one made since on an ask still open is the
 * reader's own.
 */
function holdsOnly(now: Draft, went: Draft): boolean {
  return now.text === went.text && Equal.equals(now.attachments, went.attachments);
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

/**
 * Where a held read's cards keep their drafts, kept apart from the hook so
 * another tab's or page's reading of the inbox shares them: under the plan,
 * or under none where the inbox is an agent's with no plan; and what of
 * them the read covers, a plan's or, for an agent with no plan, that
 * agent's alone.
 */
function draftScope(
  taskId: string | undefined,
  kind: AgentInboxScope["kind"],
  draftTask: string | null | undefined,
) {
  const ownTask = kind === INBOX_SCOPE_KIND.PLAN ? taskId : undefined;
  return {
    ownTask,
    // Note that one agent's inbox keeps them under its plan where it has one, as its task's Inbox does.
    draftsOn: ownTask ?? draftTask ?? null,
    // Note that an agent with no plan is the planId its inbox is read by.
    readAgent: kind === INBOX_SCOPE_KIND.AGENT ? taskId : undefined,
  };
}

/** The doors of a held read's cards' drafts (`useInboxCardDrafts`). */
type InboxCardDrafts = Pick<TaskInboxControl, "draftOf" | "drafted" | "onDraft" | "onAttachments">;

/**
 * A held read without its cards' drafts, which the window's Inbox reads in
 * its pane alone (`useHeldTaskInbox`); and its holder's own read whole, none
 * until it answers, which alone says an item is gone (`useInboxDraftsLetGo`).
 */
export type HeldTaskInboxControl = Omit<TaskInboxControl, keyof InboxCardDrafts> & {
  readonly whole: readonly InboxItem[] | undefined;
};

/** The open task's inbox as one control, its cards' drafts among it: its held read (`useHeldTaskInbox`), the drafts it lets go (`useInboxDraftsLetGo`), and those drafts (`useInboxCardDrafts`). */
export function useTaskInbox(input: Parameters<typeof useHeldTaskInbox>[0]): TaskInboxControl {
  const held = useHeldTaskInbox(input);
  useInboxDraftsLetGo(held, input);
  return { ...held, ...useInboxCardDrafts(held, input) };
}

/**
 * The open task's inbox as one control, but for its cards' drafts, which
 * it reads none of, so a word typed in a box draws nothing that holds it:
 * the window's Inbox holds it at its page, beside the drafts it lets go
 * (`useInboxDraftsLetGo`), and reads the drafts in its pane, which draws the
 * box (`useInboxCardDrafts`).
 */
export function useHeldTaskInbox(input: {
  /** The task whose inbox is held, or, with `kind` an agent's, the agent with no task whose inbox is. */
  taskId: string | undefined;
  /** Whose inbox `taskId` names: a task's, unless it is one agent's with no task. */
  kind?: AgentInboxScope["kind"] | undefined;
  /** The task an agent's inbox keeps its cards' drafts under, where the agent works on one, so its task's own Inbox reads the same drafts, and under which the feed holds the agent's items; none for a task's inbox, which keeps them under its own. */
  draftTask?: string | null | undefined;
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
    readonly answerInbox: InboxAnswerer;
    readonly messageInbox: InboxMessenger;
    readonly readInboxImage: InboxImageReader;
    /** Reads the task's agents again, for where an agent an answer reached stands now. */
    readonly onRetryList: () => void;
  };
}): HeldTaskInboxControl {
  const { taskId, shown, waiting, readerId, agents } = input;
  const kind = input.kind ?? INBOX_SCOPE_KIND.PLAN;

  // A task with no agent, standing or archived, has no Inbox tab and nothing
  // to read, unless an item waits on it, which an agent this window has not
  // listed, one started on another Mac, posted.
  const readable = (agents.heldIds?.length ?? 0) > 0 || waiting;
  const active = shown && taskId !== undefined && readable;
  const holder = useHostRead(
    LIVE_READ.HOLDER_INBOX,
    useMemo(
      () => (active && taskId !== undefined ? { kind, id: taskId } : undefined),
      [active, kind, taskId],
    ),
  );
  const feed = useHostRead(LIVE_READ.INBOX_ITEMS);
  // Note that an agent on a plan draws its own items among the plan's, which keep their identity while the plan's list stands.
  const planItems =
    kind === INBOX_SCOPE_KIND.AGENT && input.draftTask != null
      ? feed.rows?.[INBOX_SCOPE_KIND.PLAN][input.draftTask]
      : undefined;
  const fedRows = feed.rows;
  const fed = useMemo(
    () =>
      planItems === undefined
        ? fedItemsOf(fedRows, kind, taskId, input.draftTask)
        : planItems.filter((item) => item.agentId === taskId),
    [fedRows, planItems, kind, taskId, input.draftTask],
  );
  // The holder's own read stands in for the feed's once it answered, since it holds what the feed leaves out.
  const pushed = holder.rows ?? fed;
  const read = holder.status === HOST_READ_STATUS.READY;
  const failed = holder.status === HOST_READ_STATUS.FAILED;
  const [held, setHeld] = useState<Held>(() => fresh(taskId, pushed));
  if (held.taskId !== taskId) setHeld(fresh(taskId, pushed));
  useInboxArrivals(
    { taskId: held.taskId, items: held.items, read: held.drawn },
    input.onScreen === true,
  );
  // Note that a read that failed is drawn no longer, since the Inbox falls back to its list's read, whose pictures this hook's reads still hold.
  const { images, onImage, onRetryImage } = useInboxImageReads({
    read: input.agents.readInboxImage,
    scope: taskId,
    items: held.items,
    drawn: held.drawn && !failed,
  });
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const [pendingReplies, setPendingReplies] = useState<ReadonlyMap<string, PendingInboxReply>>(
    new Map(),
  );
  const [notes, setNotes] = useState<ReadonlyMap<string, InboxNote>>(new Map());
  const [unheard, setUnheard] = useState<ReadonlyMap<string, UnheardReply>>(new Map());
  const draftsOn = draftScope(taskId, kind, input.draftTask).draftsOn;
  const writer = useDraftWriter();
  const attempts = useRef(new Map<string, Attempt>());
  // The items whose send is out, as `sending` holds them but at once, so a second press before
  // the render that draws the first sends nothing again.
  const out = useRef(new Set<string>());
  const latest = useRef({ ...agents, taskId });
  latest.current = { ...agents, taskId };

  // Each read is the inbox whole, which replaces what was held, an answer's own patch among it.
  // Note that a holder neither read holds any more, as after a sign-out, is let go with its items, so nothing of the last account stands drawn.
  useEffect(() => {
    if (pushed === undefined) {
      setHeld((was) => (was.drawn ? fresh(was.taskId, undefined) : was));
      return;
    }
    setHeld((was) =>
      was.drawn && was.items === pushed ? was : { ...was, items: pushed, drawn: true },
    );
  }, [pushed]);

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
    (itemId: string, failure: AgentCallFailure): InboxNote => {
      const said = { words: messageFailureWords(failure), failure };
      note(itemId, said);
      if (failure === AGENT_CALL_FAILURE.NOT_FOUND) latest.current.onRetryList();
      return said;
    },
    [note],
  );

  // Note that a reply no answer came back for is taken as sent once the thread holds a message under its key, its key let go as a sent one's is.
  useEffect(() => {
    const landed = [...unheard.values()].filter((reply) => {
      const item = held.items.find((each) => each.id === reply.place.itemId);
      return held.taskId === reply.taskId && item !== undefined && holdsSent(item, reply.key);
    });
    if (landed.length === 0) return;
    setUnheard((standing) => {
      const next = new Map(standing);
      for (const reply of landed) {
        if (next.get(reply.place.itemId) === reply) next.delete(reply.place.itemId);
      }
      return next;
    });
    for (const reply of landed) {
      const { itemId } = reply.place;
      onDropNote(itemId, reply.note);
      writer.update(reply.place, (now) =>
        holdsOnly(now, reply.unsent) ? { ...now, text: "", attachments: [] } : now,
      );
      if (attempts.current.get(itemId)?.key === reply.key) attempts.current.delete(itemId);
    }
    latest.current.onRetryList();
  }, [held, unheard, onDropNote, writer]);

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
      latest.current
        .answerInbox({
          itemId: item.id,
          revision: item.revision,
          reply: INBOX_REPLY.ACKNOWLEDGED,
          clientKey: key,
        })
        .catch((): AgentInboxAnsweredView => UNANSWERED)
        .then((answer) => {
          out.current.delete(item.id);
          setSending((standing) => {
            const next = new Set(standing);
            next.delete(item.id);
            return next;
          });
          if ("failure" in answer) {
            refused(item.id, answer.failure);
            return;
          }
          if (!answer.taken) {
            note(item.id, { words: notTakenNote(answer.item) });
            return;
          }
          // Note that a nod the agent waits on reaches it and may open its turn, so the agents are read again.
          if (item.needsReply) latest.current.onRetryList();
        });
    },
    [note, refused],
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
      setUnheard((standing) => {
        if (!standing.has(item.id)) return standing;
        const next = new Map(standing);
        next.delete(item.id);
        return next;
      });
      // Note that the box lets go of what it sent at once, as the agent's box does, and takes it
      // back below where the send is refused, so it never stands holding words already sent.
      const place = draftPlace(item, draftsOn);
      const unsent = keptDraft(draft, item.revision);
      writer.update(place, () => EMPTY_DRAFT);
      // Note that a plain reply stands on the thread at once under its key, as the agent's box draws a message on its way, so its words are never nowhere while it goes; one carrying an answer the host draws settled.
      if (answers === undefined) {
        const reply: PendingInboxReply = { key, text, attachments, at: Date.now() };
        setPendingReplies((standing) => new Map(standing).set(item.id, reply));
      }
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
        .catch((): AgentInboxMessagedView => UNANSWERED)
        .then((answer) => {
          out.current.delete(item.id);
          setSending((standing) => {
            const next = new Set(standing);
            next.delete(item.id);
            return next;
          });
          // Note that the reply is let go under its own key, in the render its answer's item lands in, so it never stands beside the message it became.
          setPendingReplies((standing) => {
            if (standing.get(item.id)?.key !== key) return standing;
            const next = new Map(standing);
            next.delete(item.id);
            return next;
          });
          if ("failure" in answer) {
            // Note that a plain reply's words come back only into an empty box, and an answer's join the
            // message written while it stood settled, after them, so neither is lost.
            writer.update(place, (now) =>
              answers === undefined ? (holdsNothing(now) ? unsent : now) : withRefused(now, unsent),
            );
            const said = refused(item.id, answer.failure);
            if (answer.failure === AGENT_CALL_FAILURE.UNANSWERED) {
              const reply = { key, taskId: askedOn, place, unsent, note: said };
              setUnheard((standing) => new Map(standing).set(item.id, reply));
            }
            return;
          }
          // Note that the item as the service answered it lands in the render the reply on its way leaves, whichever of the answer and the host's push comes first.
          setHeld((standing) =>
            standing.taskId === askedOn
              ? { ...standing, items: withItem(standing.items, answer.item) }
              : standing,
          );
          // Note that the key is let go with the words, because the same words written again are a new message, which the service refuses under a key already spent.
          attempts.current.delete(item.id);
          // Note that a message reaches the agent as one of the developer's, which may wake it, so the agents are read again.
          latest.current.onRetryList();
        });
    },
    [note, refused, taskId, writer, draftsOn],
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

  const board = useMemo(() => inboxBoard(held.items, readerId), [held.items, readerId]);

  return {
    board,
    reading: active && !held.drawn && !failed,
    read,
    drawn: held.drawn,
    failed,
    onRetry: holder.retry,
    whole: holder.rows,
    sending,
    pendingReplies,
    notes,
    onDropNote,
    onAcknowledge,
    onMessage,
    images,
    onImage,
    onRetryImage,
  };
}

/** Whose read a held read's cards' drafts are kept under. */
interface DraftScopeOf {
  readonly taskId: string | undefined;
  readonly kind?: AgentInboxScope["kind"] | undefined;
  readonly draftTask?: string | null | undefined;
}

/**
 * Lets go of the cards' drafts a held read covers (`useHeldTaskInbox`) once
 * it draws its holder's items: those of the items it no longer holds, and
 * the picks of those whose items changed since they were made. Note that
 * only the holder's own read says an item is gone (`whole`), since the feed
 * leaves out a settled item past its bound whose draft still stands. Note
 * too that it reads where each draft stands and never its words
 * (`useInboxDraftStandings`), so what holds the read draws nothing for a
 * word typed; and that it stands for as long as the read does, rather than
 * with the box, so an item gone from under its open box takes its draft
 * with it.
 */
export function useInboxDraftsLetGo(
  control: Pick<HeldTaskInboxControl, "board" | "drawn" | "whole">,
  scope: DraftScopeOf,
): void {
  const { ownTask, draftsOn, readAgent } = draftScope(
    scope.taskId,
    scope.kind ?? INBOX_SCOPE_KIND.PLAN,
    scope.draftTask,
  );
  const standings = useInboxDraftStandings();
  const { drop, update } = useDraftWriter();
  const { board, drawn, whole } = control;
  const items = useMemo(() => [...board.open, ...board.settled], [board]);
  // Note that the agent posting on the item again, or a teammate settling it, lets only the picks go,
  // which stand on the ask as it was, while the words and files being written stay as they are.
  useEffect(() => {
    if (!drawn || (ownTask === undefined && readAgent === undefined)) return;
    const covered = standings.filter(
      ({ place }) =>
        place.planId === draftsOn && (ownTask !== undefined || place.agentId === readAgent),
    );
    const gone =
      whole === undefined
        ? []
        : covered.filter((kept) => !whole.some((item) => item.id === kept.place.itemId));
    const lapsed = covered.filter((kept) => {
      const item = items.find((each) => each.id === kept.place.itemId);
      return (
        item !== undefined && caughtUp(item, kept) && !picksStandOn(kept.revision, kept.picks, item)
      );
    });
    for (const kept of lapsed) update(kept.place, withoutPicks);
    if (gone.length > 0) drop((place) => gone.some((kept) => Equal.equals(kept.place, place)));
  }, [drawn, items, whole, ownTask, readAgent, draftsOn, standings, drop, update]);
}

/**
 * The cards' drafts of a held read (`useHeldTaskInbox`), as the box that
 * writes them reads them (`../composer-drafts.ts`), read here alone, so a
 * word typed in a box draws only what reads this.
 */
export function useInboxCardDrafts(
  control: Pick<HeldTaskInboxControl, "board">,
  scope: DraftScopeOf,
): InboxCardDrafts {
  const { draftsOn } = draftScope(
    scope.taskId,
    scope.kind ?? INBOX_SCOPE_KIND.PLAN,
    scope.draftTask,
  );
  const drafts = useInboxDrafts(draftsOn);
  const writer = useDraftWriter();
  const { board } = control;
  const items = useMemo(() => [...board.open, ...board.settled], [board]);

  const draftOf = useCallback(
    (item: InboxItem): InboxDraft => {
      const found = drafts.find((each) => each.place.itemId === item.id);
      const kept = found === undefined ? undefined : draftOfItem(found, item);
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
  const drafted = drafts.some((kept) =>
    items.some((item) => item.id === kept.place.itemId && !holdsNothing(draftOfItem(kept, item))),
  );
  const onDraft = useCallback(
    (item: InboxItem, draft: InboxDraft) =>
      writer.update(draftPlace(item, draftsOn), (was) => ({
        ...was,
        revision: item.revision,
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
    (item: InboxItem, next: (was: readonly AgentAttachment[]) => readonly AgentAttachment[]) =>
      writer.update(draftPlace(item, draftsOn), (was) => ({
        ...was,
        attachments: next(was.attachments),
      })),
    [writer, draftsOn],
  );

  return { draftOf, drafted, onDraft, onAttachments };
}
