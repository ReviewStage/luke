import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { type CodingAgentAttachment, DIFF_SIDE } from "@luke/features/coding-agent-wire";
import {
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxFormValue,
  type InboxItem,
  type InboxReplyKind,
  inboxFormValueSchema,
} from "@luke/features/inbox-wire";
import { PLAN_COMMENT_SCOPE } from "@luke/features/plan-comment-wire";
import { Duration, Effect, Equal, Schema } from "effect";
import { Atom } from "effect/reactivity";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { readKept, writeKept } from "./kept-storage.js";
import { rendererRuntime } from "./renderer-runtime.js";

/**
 * composer-drafts.ts -- what the developer typed in a box and has not sent, kept per destination on this Mac, so switching away and back finds it where it was left.
 *
 * Every chat keeps an unsent message per conversation, Slack's, Linear's,
 * Discord's, and GitHub's comments alike, and so does every box here that
 * sends somewhere: an agent's composer keeps its words per agent, a plan's
 * draft agent its first message per plan, New task its words per workspace
 * the task starts in, a chat's box its message per channel and per thread
 * (`chat-composer.tsx`), the Inbox's New thread its To, Subject, and words
 * per workspace (`inbox-compose.tsx`), a plan's comment its words per
 * thread being started, per thread answered, and per comment edited
 * (`plan-comments.tsx`), a line comment in Files changed its words per
 * agent, pull request, file, side, and last line (`comment-drafts.ts`), an agent's line
 * written again its words and files per agent and line
 * (`edit-composer.tsx`), a chat ask's answer its
 * picks and note per message, at the revision it was written against
 * (`chat-ask.tsx`), and an inbox
 * card its answer per item, at the revision it was written against, the
 * options picked, the fields filled, and, on a thread, the steps ticked and
 * the answer pressed beside its note. A draft is known by where
 * it goes, a place named by the ids of what it goes to, never one key built
 * of them. Sending a draft lets it go, and so does emptying its box, so a
 * place holds a draft only while its box holds something.
 *
 * The words are kept in the renderer's own storage, as the sidebar's folds
 * and the plans' looks are, so they outlast a reload and a relaunch on this
 * Mac and reach no other. They are the account's that wrote them, each kept
 * with its account's id, or its address where its identity was stored
 * without an id, and a window reads only the drafts of the account
 * signed in to it (`useDraftsOwner`), so a teammate signing in on the same
 * Mac meets nothing of another's unsent words, which wait for their writer
 * to sign in again. A window reads what another panel's window wrote as it
 * is written, so two boxes for one place show the words written last. A mention or a skill is part of the words, written
 * as its link or its `/name`, so it comes back as the chip it was. The files
 * attached are kept in this window alone, for as long as it stands, because
 * a message's files may run to megabytes and storage holds a few: a relaunch
 * brings the words back without them. The store keeps the latest
 * `MAX_KEPT` drafts, so one left on an agent long gone is let go in time.
 * Note that a write starts from what storage holds, as the looks' does,
 * because another panel's window keeps its drafts there too. A change is the
 * window's at once and reaches storage once the typing rests
 * (`STORE_PAUSE`), or sooner where the box loses focus, the window is hidden
 * or closed, or another account signs in to it, so a burst of keys reads and
 * writes the whole store once rather than on every key.
 */

/** Where the drafts are kept in the renderer's storage. */
const STORAGE_KEY = "luke.composerDrafts";

/** How many drafts are kept at most, the oldest written let go first. */
const MAX_KEPT = 200;

/** How long the typing rests before what the window changed is written to storage. */
const STORE_PAUSE = Duration.millis(300);

/** What a draft is written to: a started agent, a plan's agent not yet started, an inbox item, a task not yet started, an automation's helper not yet started, a chat's channel or thread, an Inbox thread not yet started, a plan's comment, a line comment on an agent's changed file, an agent's line written again, or a chat message's ask. */
export const DRAFT_PLACE = {
  AGENT: "agent",
  NEW_AGENT: "newAgent",
  INBOX: "inbox",
  NEW_TASK: "newTask",
  NEW_AUTOMATION: "newAutomation",
  CHAT: "chat",
  NEW_THREAD: "newThread",
  PLAN_COMMENT: "planComment",
  LINE_COMMENT: "lineComment",
  EDIT: "edit",
  CHAT_ASK: "chatAsk",
} as const;

const draftPlaceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.AGENT),
    /** The agent's plan, which the sidebar marks; null for an agent with none. */
    planId: Schema.NullOr(Schema.String),
    agentId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.NEW_AGENT),
    planId: Schema.String,
    /** The key the draft agent starts under, which a relaunch keeps, so a Start asked again is the same one. */
    draftId: Schema.String,
    /** The agent and message the draft forks, with the message's opening words and, for a reply still being written, where the fork cuts it, which a relaunch keeps beside its words; no message for a continue of the agent's whole transcript. */
    fork: Schema.optionalKey(
      Schema.Struct({
        agentId: Schema.String,
        messageId: Schema.optionalKey(Schema.String),
        opening: Schema.String,
        messageSteps: Schema.optionalKey(Schema.Number),
        messageStepParts: Schema.optionalKey(Schema.Number),
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.INBOX),
    /** The item's plan, which the sidebar marks; null for an inbox of an agent with no plan. */
    planId: Schema.NullOr(Schema.String),
    /** The agent that posted the item, whose own inbox, where it has no plan, is all that reads it. */
    agentId: Schema.String,
    itemId: Schema.String,
    /** The item's revision the answer was written against; the agent changing the item starts its picks afresh, its words and files carried to the new revision (`use-task-inbox.ts`). */
    revision: Schema.Number,
    /** Set where the draft is a message on a settled item's thread rather than the answer to an open one, so neither is ever taken for the other. */
    thread: Schema.optionalKey(Schema.Literal(true)),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.NEW_TASK),
    /** The workspace the task starts in; null before the workspaces are read. */
    workspaceId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.NEW_AUTOMATION),
    /** The workspace the automation's helper starts in; null before the workspaces are read. */
    workspaceId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.CHAT),
    channelId: Schema.String,
    /** The thread's root, by its place in the chat, where the draft is a reply in it rather than a post at the channel's foot. */
    replyTo: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.NEW_THREAD),
    /** The workspace whose Inbox the thread is written in; null before the workspaces are read. */
    workspaceId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.PLAN_COMMENT),
    /** The plan the comment is on, which the sidebar marks. */
    planId: Schema.String,
    /**
     * What the words go to: the comment of a thread they edit, the thread
     * they answer, or, for a thread not yet started, the words it is started
     * on and whether on them or their block. Note that an edit is read first,
     * because a reply's place would read one with the comment it names left off.
     */
    on: Schema.Union([
      Schema.Struct({ threadId: Schema.String, entryId: Schema.String }),
      Schema.Struct({ threadId: Schema.String }),
      Schema.Struct({
        quote: Schema.String,
        scope: Schema.Literals(Object.values(PLAN_COMMENT_SCOPE)),
      }),
    ]),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.LINE_COMMENT),
    /** The agent whose pull request's Files changed the comment is written in. */
    agentId: Schema.String,
    /** The number of the pull request a tab names other than its agent's own, so two pull requests changing one file keep their words apart; none for the agent's own. */
    number: Schema.optionalKey(Schema.Number),
    /** The changed file the comment is on. */
    path: Schema.String,
    /** The side of the diff the comment's last line counts on, as GitHub anchors a thread. */
    side: Schema.Literals(Object.values(DIFF_SIDE)),
    /** The comment's last line, under which it stands. */
    line: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.EDIT),
    /** The agent whose transcript holds the line. */
    agentId: Schema.String,
    /** The developer's line the words are written again in place of. */
    messageId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.CHAT_ASK),
    /** The chat message that carries the ask. */
    messageId: Schema.String,
    /** The ask's revision the answer was written against, so picks never land on options its poster changed since. */
    revision: Schema.Number,
  }),
]);

/** Where one draft goes. */
export type DraftPlace = typeof draftPlaceSchema.Type;

/**
 * New task's words on one of the workspace's own issues, as a build from
 * before Luke kept no issues stored them. No card opens on an issue now, so
 * such an entry is read past rather than taken for the workspace's own
 * draft, which it would displace, and goes once its account writes again.
 */
const issueDraftPlaceSchema = Schema.Struct({
  kind: Schema.Literal(DRAFT_PLACE.NEW_TASK),
  workspaceId: Schema.NullOr(Schema.String),
  issueId: Schema.String,
});

/** A place as storage may hold it: one of today's, or New task's on an issue (`issueDraftPlaceSchema`). */
const storedPlaceSchema = Schema.Union([issueDraftPlaceSchema, draftPlaceSchema]);

type StoredPlace = typeof storedPlaceSchema.Type;

/** Whether a place storage holds is one a box opens today. */
function isDraftPlace(place: StoredPlace): place is DraftPlace {
  return !("issueId" in place);
}

/** The drafts as storage keeps them: each place's words, a card's picks where it holds some, and the account that wrote them, the latest written last. */
const storedDrafts = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      accountId: Schema.NullOr(Schema.String),
      place: storedPlaceSchema,
      text: Schema.String,
      choices: Schema.optionalKey(Schema.Array(Schema.String)),
      values: Schema.optionalKey(Schema.Array(inboxFormValueSchema)),
      steps: Schema.optionalKey(Schema.Array(Schema.Number)),
      press: Schema.optionalKey(Schema.Literals(Object.values(INBOX_REPLY))),
      title: Schema.optionalKey(Schema.String),
      to: Schema.optionalKey(Schema.String),
      dropped: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
  ),
);

type StoredDraft = (typeof storedDrafts.Type)[number];

/** The account a window's drafts are written by: the one signed in, none before its state is read, as in a test. */
type Owner = string | null;

/** What a box holds unsent: its words, the files attached to them, and an inbox card's options picked and fields filled, and a thread's steps ticked and answer pressed; a box that names its own title and whom it goes to, as New thread's Subject and To do, keeps those beside them. */
export interface Draft {
  readonly text: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly choices: readonly string[];
  readonly values: readonly InboxFormValue[];
  readonly steps?: readonly number[] | undefined;
  readonly press?: InboxReplyKind | undefined;
  readonly title?: string | undefined;
  /** The agent the draft goes to, by its id; kept only beside something written, since a pick alone is no draft. */
  readonly to?: string | undefined;
  /** The files of a line written again that its box took off, by their key in the line, so they stay off where the line's files are offered again (`edit-composer.tsx`). */
  readonly dropped?: readonly string[] | undefined;
}

/** One place's draft. */
export interface KeptDraft<Place extends DraftPlace = DraftPlace> extends Draft {
  readonly place: Place;
}

/** A plan's draft agent's place. */
export type NewAgentPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.NEW_AGENT }>;

/** An inbox card's place. */
export type InboxPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.INBOX }>;

/** A chat box's place: a channel's foot, or a thread in it. */
export type ChatDraftPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.CHAT }>;

/** New thread's place: the workspace whose Inbox it is written in. */
export type NewThreadPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.NEW_THREAD }>;

/** A plan comment's place: a thread being started, answered, or one of its comments edited. */
export type PlanCommentPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.PLAN_COMMENT }>;

/** A line comment in Files changed: the agent, the file, and the side and last line it stands under. */
export type LineCommentPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.LINE_COMMENT }>;

/** An agent's line written again: the agent and the line. */
export type EditPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.EDIT }>;

/** A chat ask's answer: the message carrying it, at the ask's revision. */
export type ChatAskPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.CHAT_ASK }>;

/** A box holding nothing. */
export const EMPTY_DRAFT: Draft = { text: "", attachments: [], choices: [], values: [] };

/** Whether a draft holds anything storage keeps: everything but its files. */
function stored(draft: Draft): boolean {
  return (
    draft.text !== "" ||
    draft.choices.length > 0 ||
    draft.values.length > 0 ||
    (draft.steps ?? []).length > 0 ||
    draft.press !== undefined ||
    (draft.title ?? "") !== "" ||
    (draft.dropped ?? []).length > 0
  );
}

/** Whether a draft holds anything to keep. */
function holds(draft: Draft): boolean {
  return stored(draft) || draft.attachments.length > 0;
}

/** Every account's kept drafts, none where none were kept or they no longer read. */
function readStored(): readonly StoredDraft[] {
  return readKept(STORAGE_KEY, storedDrafts, []);
}

/** The owner's kept drafts; storage keeps no files, and no draft of files alone, or of a place no box opens now. */
function readDrafts(owner: Owner): readonly KeptDraft[] {
  return readStored()
    .filter((kept) => kept.accountId === owner)
    .flatMap(({ place, text, choices = [], values = [], steps, press, title, to, dropped }) =>
      isDraftPlace(place)
        ? [
            {
              place,
              text,
              attachments: [],
              choices,
              values,
              ...(steps === undefined ? undefined : { steps }),
              ...(press === undefined ? undefined : { press }),
              ...(title === undefined ? undefined : { title }),
              ...(to === undefined ? undefined : { to }),
              ...(dropped === undefined ? undefined : { dropped }),
            },
          ]
        : [],
    )
    .filter(stored);
}

/** Whether a kept draft is the one storage holds for an entry: the owner's, at its place, holding the same. */
function storedAs(owner: Owner, kept: KeptDraft, entry: StoredDraft): boolean {
  return (
    entry.accountId === owner &&
    Equal.equals(entry.place, kept.place) &&
    entry.text === kept.text &&
    Equal.equals(entry.choices ?? [], kept.choices) &&
    Equal.equals(entry.values ?? [], kept.values) &&
    Equal.equals(entry.steps ?? [], kept.steps ?? []) &&
    entry.press === kept.press &&
    (entry.title ?? "") === (kept.title ?? "") &&
    entry.to === kept.to &&
    Equal.equals(entry.dropped ?? [], kept.dropped ?? [])
  );
}

/** A draft as storage keeps it, a card's picks only where it holds some. */
function entryOf(
  owner: Owner,
  { place, text, choices, values, steps = [], press, title = "", to, dropped = [] }: KeptDraft,
): StoredDraft {
  return {
    accountId: owner,
    place,
    text,
    ...(choices.length === 0 ? undefined : { choices }),
    ...(values.length === 0 ? undefined : { values }),
    ...(steps.length === 0 ? undefined : { steps }),
    ...(press === undefined ? undefined : { press }),
    ...(title === "" ? undefined : { title }),
    ...(to === undefined ? undefined : { to }),
    ...(dropped.length === 0 ? undefined : { dropped }),
  };
}

/** Whether two of the owner's drafts for one place hold the same that storage keeps, none and one of files alone alike. */
function sameStored(
  owner: Owner,
  one: KeptDraft | undefined,
  other: KeptDraft | undefined,
): boolean {
  if (one === undefined || !stored(one)) return other === undefined || !stored(other);
  return other !== undefined && storedAs(owner, one, entryOf(owner, other));
}

/**
 * Keeps the owner's drafts beside every other account's, in the order they
 * were written: an entry unchanged stands where it stood and one written
 * moves last, so the oldest written of any account's is the one let go past
 * `MAX_KEPT`, a card's picks kept only where it holds some. Answers the
 * owner's drafts as kept, a draft of files alone among them, since storage
 * holds none of those to let go.
 */
function writeDrafts(owner: Owner, drafts: readonly KeptDraft[]): readonly KeptDraft[] {
  const kept = drafts.filter(stored);
  const standing = readStored().filter(
    (entry) => entry.accountId !== owner || kept.some((draft) => storedAs(owner, draft, entry)),
  );
  const written = kept
    .filter((draft) => !standing.some((entry) => storedAs(owner, draft, entry)))
    .map((draft) => entryOf(owner, draft));
  const entries = [...standing, ...written].slice(-MAX_KEPT);
  writeKept(STORAGE_KEY, storedDrafts, entries);
  return drafts.filter(
    (draft) => !stored(draft) || entries.some((entry) => storedAs(owner, draft, entry)),
  );
}

/** The drafts with `place`'s set to `draft`, latest last, or let go where it holds nothing. */
function withDraft(
  drafts: readonly KeptDraft[],
  place: DraftPlace,
  draft: Draft,
): readonly KeptDraft[] {
  const others = drafts.filter((kept) => !Equal.equals(kept.place, place));
  return holds(draft) ? [...others, { ...draft, place }] : others;
}

/** A change to the drafts: one place's draft moved on from what it holds, the drafts a predicate names let go, what the window changed written to storage, or storage read again. */
type DraftChange =
  | { readonly place: DraftPlace; readonly next: (was: Draft) => Draft }
  | { readonly drop: (place: DraftPlace) => boolean }
  | { readonly store: true }
  | { readonly reread: true };

/** Writes to storage what the window changed and has not written yet. */
const STORE: DraftChange = { store: true };

/** Reads storage again, and writes beside it what the window changed and has not written yet where no other window wrote over it since. */
const REREAD: DraftChange = { reread: true };

/** A place the window set and has not written, and its draft as storage held it before, none where it held none. */
interface UnstoredPlace {
  readonly place: DraftPlace;
  readonly was: KeptDraft | undefined;
}

/** What a window changed in an account's drafts and has not written to storage: the places it set, the latest set last, and what it let go. */
interface Unstored {
  readonly places: readonly UnstoredPlace[];
  readonly drops: readonly ((place: DraftPlace) => boolean)[];
}

const NOTHING_UNSTORED: Unstored = { places: [], drops: [] };

/** What the window changed in one account's drafts and has not written to storage yet. */
const unstoredOf = Atom.family((_owner: Owner) =>
  Atom.keepAlive(Atom.make<Unstored>(NOTHING_UNSTORED)),
);

/**
 * The wait before one account's drafts are written to storage, as an atom
 * whose work is the pause and then the write: setting it again starts the
 * pause over and lets go of the one standing, so a burst of keys writes once,
 * after the last. Note that it is not lazy, because nothing reads it: the
 * wait runs as soon as it is set.
 */
const storeLaterOf = Atom.family((owner: Owner) =>
  Atom.keepAlive(
    Atom.setLazy(
      rendererRuntime.fn((_: undefined, get) =>
        Effect.sleep(STORE_PAUSE).pipe(
          Effect.andThen(Effect.sync(() => get.set(draftsOf(owner), STORE))),
        ),
      ),
      false,
    ),
  ),
);

/**
 * The owner's drafts as storage holds them, the files beside them as this
 * window holds them, since storage holds none, with a draft of files alone
 * this window's own; each draft unchanged is the very one `held` holds.
 */
function readBeside(owner: Owner, held: readonly KeptDraft[]): readonly KeptDraft[] {
  const read = readDrafts(owner).map((kept) => {
    const was = held.find((each) => Equal.equals(each.place, kept.place));
    if (was === undefined) return kept;
    return Equal.equals({ ...was, attachments: [] }, kept)
      ? was
      : { ...kept, attachments: was.attachments };
  });
  // Note that files storage has no word of stay as a draft of files alone, even where another
  // window let the words beside them go, because they live in this window and nowhere else.
  const filesAlone = held
    .filter(
      (kept) =>
        kept.attachments.length > 0 && !read.some((each) => Equal.equals(each.place, kept.place)),
    )
    .map((kept) => ({ ...EMPTY_DRAFT, place: kept.place, attachments: kept.attachments }));
  return [...filesAlone, ...read];
}

/**
 * What storage holds with the window's unwritten changes laid over it: what
 * they let go let go, and each place they set as the window holds it, moved
 * last. Note that a place the window did not change stands as storage holds
 * it, because another window may have written it since.
 */
function withUnstored(
  standing: readonly KeptDraft[],
  held: readonly KeptDraft[],
  unstored: Unstored,
): readonly KeptDraft[] {
  return unstored.places.reduce<readonly KeptDraft[]>(
    (drafts, { place }) =>
      withDraft(drafts, place, held.find((kept) => Equal.equals(kept.place, place)) ?? EMPTY_DRAFT),
    standing.filter((kept) => !unstored.drops.some((drop) => drop(kept.place))),
  );
}

/** A change to one place, or a drop, as `DraftChange` names them. */
type DraftEdit = Exclude<DraftChange, { readonly store: true } | { readonly reread: true }>;

/** The drafts the window holds once `edit` lands on them. */
function edited(held: readonly KeptDraft[], edit: DraftEdit): readonly KeptDraft[] {
  if ("drop" in edit) return held.filter((kept) => !edit.drop(kept.place));
  const was = held.find((kept) => Equal.equals(kept.place, edit.place)) ?? EMPTY_DRAFT;
  return withDraft(held, edit.place, edit.next(was));
}

/** What the window holds unwritten once `edit` lands: a place set moves last and keeps what storage held before its first change. */
function unstoredAfter(unstored: Unstored, held: readonly KeptDraft[], edit: DraftEdit): Unstored {
  if ("drop" in edit) return { ...unstored, drops: [...unstored.drops, edit.drop] };
  const standing = unstored.places.find(({ place }) => Equal.equals(place, edit.place));
  const was =
    standing === undefined
      ? held.find((kept) => Equal.equals(kept.place, edit.place))
      : standing.was;
  return {
    ...unstored,
    places: [...unstored.places.filter((each) => each !== standing), { place: edit.place, was }],
  };
}

/**
 * What the window holds unwritten that still stands once storage is read
 * again: each place set where storage holds what it held before the window
 * changed it. Note that a place another window wrote since is taken as that
 * window wrote it, because its words are the later.
 */
function unstoredBeside(
  owner: Owner,
  unstored: Unstored,
  standing: readonly KeptDraft[],
): Unstored {
  return {
    ...unstored,
    places: unstored.places.filter(({ place, was }) =>
      sameStored(
        owner,
        was,
        standing.find((kept) => Equal.equals(kept.place, place)),
      ),
    ),
  };
}

/** Whether the window holds nothing unwritten. */
function nothingUnstored(unstored: Unstored): boolean {
  return unstored.places.length === 0 && unstored.drops.length === 0;
}

/**
 * Every draft one account holds, in an atom of its own. A change is held at
 * once and written to storage once the typing rests (`storeLaterOf`), or
 * sooner where a store is asked for; the write starts from what storage
 * holds, so another window's words at a place this one did not change stand.
 * Each account's atom is kept alive, because the files live nowhere else
 * while no box is open, and is its own, so nothing one account attached
 * reaches another's box.
 */
const draftsOf = Atom.family((owner: Owner) => {
  const self: Atom.Writable<readonly KeptDraft[], DraftChange> = Atom.keepAlive(
    Atom.writable(
      () => readDrafts(owner),
      (ctx, change: DraftChange) => {
        const held = ctx.get(self);
        const unstored = ctx.get(unstoredOf(owner));
        if ("drop" in change || "place" in change) {
          ctx.setSelf(edited(held, change));
          ctx.set(unstoredOf(owner), unstoredAfter(unstored, held, change));
          ctx.set(storeLaterOf(owner), undefined);
          return;
        }
        // A store with nothing unwritten reads nothing, so a pause ending after a flush costs nothing.
        if ("store" in change && nothingUnstored(unstored)) return;
        const standing = readBeside(owner, held);
        const writing = "reread" in change ? unstoredBeside(owner, unstored, standing) : unstored;
        ctx.set(unstoredOf(owner), NOTHING_UNSTORED);
        ctx.setSelf(
          nothingUnstored(writing)
            ? standing
            : writeDrafts(owner, withUnstored(standing, held, writing)),
        );
      },
    ),
  );
  return self;
});

/** The account signed in to this window, whose drafts it reads and writes. */
const ownerAtom = Atom.keepAlive(Atom.make<Owner>(null));

/** The drafts of the account signed in to this window, written as that account's. */
const draftsAtom = Atom.writable(
  (get) => get(draftsOf(get(ownerAtom))),
  (ctx, change: DraftChange) => ctx.set(draftsOf(ctx.get(ownerAtom)), change),
);

/**
 * Moves the drafts kept under an account's address to its id once its
 * identity learns the id, the order they were written kept; where the id
 * and the address each kept a draft for one place, the one written later
 * stands, as one place holds one draft.
 */
function adoptDrafts(address: string, accountId: string): void {
  const entries = readStored();
  if (!entries.some((entry) => entry.accountId === address)) return;
  const moved = entries.map((entry) =>
    entry.accountId === address ? { ...entry, accountId } : entry,
  );
  const latest = moved.filter(
    (entry, at) =>
      entry.accountId !== accountId ||
      !moved
        .slice(at + 1)
        .some((later) => later.accountId === accountId && Equal.equals(later.place, entry.place)),
  );
  writeKept(STORAGE_KEY, storedDrafts, latest);
}

/**
 * Hands this window's drafts to the account signed in to it, before the
 * window is painted, so a box opening as the account changes never shows
 * another's words; nothing while none is signed in. An account is known by
 * its id, or by its address where its identity was stored without one, so
 * two such accounts never share their drafts either; the drafts it kept
 * under its address become its id's once its identity learns the id.
 */
export function useDraftsOwner(
  account: { readonly id?: string | undefined; readonly email: string } | undefined,
): void {
  const own = useAtomSet(ownerAtom);
  const change = useAtomSet(draftsAtom);
  const id = account?.id;
  const email = account?.email;
  useLayoutEffect(() => {
    // What the account signed in until now typed is written as its own before another's are read.
    change(STORE);
    if (id !== undefined && email !== undefined) adoptDrafts(email, id);
    own(id ?? email ?? null);
    // Note that the account's drafts are read again, because a window that held them before may
    // hold them as they stood then, before a move from its address added to them.
    change(REREAD);
  }, [own, change, id, email]);
  // Another panel's window writing the drafts is read at once, so a box never types over its words.
  useEffect(() => {
    const heard = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) change(REREAD);
    };
    window.addEventListener("storage", heard);
    return () => window.removeEventListener("storage", heard);
  }, [change]);
  // Note that what the window holds unwritten is written at once wherever the words could be lost
  // or read elsewhere before the typing rests: the box losing focus, the window losing it, hidden,
  // or closed, a quit's included, and the window's root going.
  useEffect(() => {
    const store = () => change(STORE);
    const hidden = () => {
      if (document.visibilityState === "hidden") store();
    };
    window.addEventListener("focusout", store);
    window.addEventListener("blur", store);
    window.addEventListener("pagehide", store);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("focusout", store);
      window.removeEventListener("blur", store);
      window.removeEventListener("pagehide", store);
      document.removeEventListener("visibilitychange", hidden);
      store();
    };
  }, [change]);
}

/**
 * The plans a draft waits in, read off every draft, null for an agent with
 * no plan. Note that it is an atom of its own, compared by its contents, so
 * a row marking a draft draws again only as a draft comes or goes, never on
 * each word typed.
 */
const draftedAtom = Atom.withEquality(
  Atom.make((get): readonly (string | null)[] =>
    get(draftsAtom).flatMap(({ place }) => ("planId" in place ? [place.planId] : [])),
  ),
  Equal.equals,
);

/**
 * The started agents a draft waits in, read off every draft, compared by
 * its contents as `draftedAtom` is, so a tab marking one draws again only
 * as a draft comes or goes.
 */
const draftedAgentsAtom = Atom.withEquality(
  Atom.make((get): readonly string[] =>
    get(draftsAtom).flatMap(({ place }) =>
      place.kind === DRAFT_PLACE.AGENT ? [place.agentId] : [],
    ),
  ),
  Equal.equals,
);

/** One box's draft and the presses that change it. */
export interface DraftControl {
  readonly draft: Draft;
  /** Moves the draft on from what it holds as the change lands, which a file read late needs. */
  readonly update: (next: (was: Draft) => Draft) => void;
}

/**
 * Writes what the window holds unwritten as a box that writes drafts goes,
 * so whatever reads them next, here or after a relaunch, finds its words.
 */
function useStoreOnLeave(change: (change: DraftChange) => void): void {
  useEffect(() => () => change(STORE), [change]);
}

/** The draft kept for `place`, empty where none is. */
export function useDraft(place: DraftPlace): DraftControl {
  const draft = useAtomValue(
    draftsAtom,
    (drafts) => drafts.find((kept) => Equal.equals(kept.place, place)) ?? EMPTY_DRAFT,
  );
  const change = useAtomSet(draftsAtom);
  useStoreOnLeave(change);
  return { draft, update: (next) => change({ place, next }) };
}

/** Whether a draft is a plan's draft agent's. */
function isNewAgent(kept: KeptDraft): kept is KeptDraft<NewAgentPlace> {
  return kept.place.kind === DRAFT_PLACE.NEW_AGENT;
}

/**
 * The draft kept for a plan's draft agent under the key the window holds, or,
 * where it holds none, as after a relaunch, the latest kept for the plan
 * under any; nothing where there is none. Note that a key the window holds
 * reads its own words alone, because another window may keep a draft agent
 * of its own on the same plan.
 */
export function useNewAgentDraft(
  taskId: string | undefined,
  draftId: string | undefined,
): KeptDraft<NewAgentPlace> | undefined {
  return useAtomValue(draftsAtom, (drafts) => {
    const onTask = drafts.filter(isNewAgent).filter((kept) => kept.place.planId === taskId);
    return draftId === undefined
      ? onTask.at(-1)
      : onTask.find((kept) => kept.place.draftId === draftId);
  });
}

/** Whether a draft is an inbox card's. */
function isInbox(kept: KeptDraft): kept is KeptDraft<InboxPlace> {
  return kept.place.kind === DRAFT_PLACE.INBOX;
}

/** Whether a kept draft is the one the item's card reads as it now stands: at its revision, an answer while it is open and a thread's message once it settled. */
export function draftOfItem(
  place: InboxPlace,
  item: Pick<InboxItem, "id" | "revision" | "status">,
): boolean {
  return (
    place.itemId === item.id &&
    place.revision === item.revision &&
    (place.thread === true) === (item.status !== INBOX_STATUS.OPEN)
  );
}

/**
 * Whether an inbox item holds a draft its card reads as it now stands, which
 * its row marks with the pencil (`draft-mark.tsx`). Note that it answers a
 * boolean, so a row draws again only as its draft comes or goes, never on
 * each word typed.
 */
export function useInboxItemDrafted(item: Pick<InboxItem, "id" | "revision" | "status">): boolean {
  return useAtomValue(draftsAtom, (drafts) =>
    drafts.some((kept) => isInbox(kept) && draftOfItem(kept.place, item)),
  );
}

/**
 * The draft an inbox item's box holds as it now stands (`draftOfItem`), its
 * steps ticked and the answer pressed, which its row and its card read to
 * show the steps as the box does; none where no draft stands. Note that it
 * answers the kept draft itself, the same until it changes.
 */
export function useInboxItemDraft(
  item: Pick<InboxItem, "id" | "revision" | "status">,
): KeptDraft | undefined {
  return useAtomValue(draftsAtom, (drafts) =>
    drafts.find((kept) => isInbox(kept) && draftOfItem(kept.place, item)),
  );
}

/**
 * The inbox cards' drafts of a plan, or of the agents with none where it is
 * null. Note that the list answered is the very one it was until one of its
 * drafts changes, so the inbox reading it draws again only then, never on a
 * word typed in another box.
 */
export function useInboxDrafts(taskId: string | null): readonly KeptDraft<InboxPlace>[] {
  const last = useRef<readonly KeptDraft<InboxPlace>[]>([]);
  return useAtomValue(draftsAtom, (drafts) => {
    const found = drafts.filter(isInbox).filter((kept) => kept.place.planId === taskId);
    const same =
      found.length === last.current.length && found.every((kept, at) => kept === last.current[at]);
    if (!same) last.current = found;
    return last.current;
  });
}

/** The presses that write any place's draft, or let go of those a predicate names. */
export interface DraftWriter {
  readonly update: (place: DraftPlace, next: (was: Draft) => Draft) => void;
  readonly drop: (drop: (place: DraftPlace) => boolean) => void;
}

/** The draft writer, for an owner that reads its drafts on its own, the same one for as long as the window's registry stands. */
export function useDraftWriter(): DraftWriter {
  const change = useAtomSet(draftsAtom);
  useStoreOnLeave(change);
  return useMemo(
    () => ({ update: (place, next) => change({ place, next }), drop: (drop) => change({ drop }) }),
    [change],
  );
}

/** Whether a plan holds a draft: one of its agents', its draft agent's, an inbox card's, or a comment's. */
export function usePlanDrafted(taskId: string): boolean {
  return useAtomValue(draftedAtom, (tasks) => tasks.includes(taskId));
}

/** The started agents whose boxes hold a draft, which their tabs mark with the pencil (`draft-mark.tsx`). */
export function useDraftedAgents(): readonly string[] {
  return useAtomValue(draftedAgentsAtom);
}

/**
 * Whether New task holds a draft in a workspace, none before the workspaces
 * are read, which the sidebar's New task row marks with the pencil
 * (`draft-mark.tsx`): the words its card keeps there. Note that it answers
 * a boolean, so the row draws again only as the draft comes or goes, never
 * on each word typed.
 */
export function useNewTaskDrafted(workspaceId: string | undefined): boolean {
  return useAtomValue(draftsAtom, (drafts) =>
    drafts.some(
      ({ place }) =>
        place.kind === DRAFT_PLACE.NEW_TASK && place.workspaceId === (workspaceId ?? null),
    ),
  );
}
