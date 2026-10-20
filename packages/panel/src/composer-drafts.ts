import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import {
  INBOX_STATUS,
  type InboxFormValue,
  type InboxItem,
  inboxFormValueSchema,
} from "@luke/features/inbox-wire";
import { Equal, Schema } from "effect";
import { Atom } from "effect/reactivity";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { readKept, writeKept } from "./desktop/folded-groups.js";

/**
 * composer-drafts.ts -- what the developer typed in a box and has not sent, kept per destination on this Mac, so switching away and back finds it where it was left.
 *
 * Every chat keeps an unsent message per conversation, Slack's, Linear's,
 * Discord's, and GitHub's comments alike, and so does every box here that
 * sends somewhere: an agent's composer keeps its words per agent, a plan's
 * draft agent its first message per plan, New task its words per workspace
 * the task starts in, and an inbox
 * card its answer per item, at the revision it was written against, the
 * options picked and the fields filled beside its note. A draft is known by where
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
 * because another panel's window keeps its drafts there too.
 */

/** Where the drafts are kept in the renderer's storage. */
const STORAGE_KEY = "luke.composerDrafts";

/** How many drafts are kept at most, the oldest written let go first. */
const MAX_KEPT = 200;

/** What a draft is written to: a started agent, a plan's agent not yet started, an inbox item, or a task not yet started. */
export const DRAFT_PLACE = {
  AGENT: "agent",
  NEW_AGENT: "newAgent",
  INBOX: "inbox",
  NEW_TASK: "newTask",
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
    /** The item's revision the answer was written against; the agent changing the item starts its card afresh. */
    revision: Schema.Number,
    /** Set where the draft is a message on a settled item's thread rather than the answer to an open one, so neither is ever taken for the other. */
    thread: Schema.optionalKey(Schema.Literal(true)),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.NEW_TASK),
    /** The workspace the task starts in; null before the workspaces are read. */
    workspaceId: Schema.NullOr(Schema.String),
  }),
]);

/** Where one draft goes. */
export type DraftPlace = typeof draftPlaceSchema.Type;

/** The drafts as storage keeps them: each place's words, a card's picks where it holds some, and the account that wrote them, the latest written last. */
const storedDrafts = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      accountId: Schema.NullOr(Schema.String),
      place: draftPlaceSchema,
      text: Schema.String,
      choices: Schema.optionalKey(Schema.Array(Schema.String)),
      values: Schema.optionalKey(Schema.Array(inboxFormValueSchema)),
    }),
  ),
);

type StoredDraft = (typeof storedDrafts.Type)[number];

/** The account a window's drafts are written by: the one signed in, none before its state is read, as in a test. */
type Owner = string | null;

/** What a box holds unsent: its words, the files attached to them, and an inbox card's options picked and fields filled. */
export interface Draft {
  readonly text: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly choices: readonly string[];
  readonly values: readonly InboxFormValue[];
}

/** One place's draft. */
export interface KeptDraft<Place extends DraftPlace = DraftPlace> extends Draft {
  readonly place: Place;
}

/** A plan's draft agent's place. */
export type NewAgentPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.NEW_AGENT }>;

/** An inbox card's place. */
export type InboxPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.INBOX }>;

/** A box holding nothing. */
export const EMPTY_DRAFT: Draft = { text: "", attachments: [], choices: [], values: [] };

/** Whether a draft holds anything storage keeps: everything but its files. */
function stored(draft: Draft): boolean {
  return draft.text !== "" || draft.choices.length > 0 || draft.values.length > 0;
}

/** Whether a draft holds anything to keep. */
function holds(draft: Draft): boolean {
  return stored(draft) || draft.attachments.length > 0;
}

/** Every account's kept drafts, none where none were kept or they no longer read. */
function readStored(): readonly StoredDraft[] {
  return readKept(STORAGE_KEY, storedDrafts, []);
}

/** The owner's kept drafts; storage keeps no files, and no draft of files alone. */
function readDrafts(owner: Owner): readonly KeptDraft[] {
  return readStored()
    .filter((kept) => kept.accountId === owner)
    .map(({ place, text, choices = [], values = [] }) => ({
      place,
      text,
      attachments: [],
      choices,
      values,
    }))
    .filter(stored);
}

/** Whether a kept draft is the one storage holds for an entry: the owner's, at its place, holding the same. */
function storedAs(owner: Owner, kept: KeptDraft, entry: StoredDraft): boolean {
  return (
    entry.accountId === owner &&
    Equal.equals(entry.place, kept.place) &&
    entry.text === kept.text &&
    Equal.equals(entry.choices ?? [], kept.choices) &&
    Equal.equals(entry.values ?? [], kept.values)
  );
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
    .map(({ place, text, choices, values }) => ({
      accountId: owner,
      place,
      text,
      ...(choices.length === 0 ? undefined : { choices }),
      ...(values.length === 0 ? undefined : { values }),
    }));
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

/** A change to the drafts: one place's draft moved on from what it holds, or the drafts a predicate names let go. */
type DraftChange =
  | { readonly place: DraftPlace; readonly next: (was: Draft) => Draft }
  | { readonly drop: (place: DraftPlace) => boolean }
  | { readonly reread: true };

/**
 * Every draft one account holds, in an atom of its own. Note that a write
 * keeps the words of every other place as storage holds them, and the files
 * as this window does, since storage holds none, with a draft of files alone
 * this window's own; each draft unchanged is the very one it was, so a box
 * reading another place's draft does not draw again. Each account's atom is
 * kept alive, because the files live nowhere else while no box is open, and
 * is its own, so nothing one account attached reaches another's box.
 */
const draftsOf = Atom.family((owner: Owner) => {
  const self: Atom.Writable<readonly KeptDraft[], DraftChange> = Atom.keepAlive(
    Atom.writable(
      () => readDrafts(owner),
      (ctx, change: DraftChange) => {
        const held = ctx.get(self);
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
              kept.attachments.length > 0 &&
              !read.some((each) => Equal.equals(each.place, kept.place)),
          )
          .map((kept) => ({ ...EMPTY_DRAFT, place: kept.place, attachments: kept.attachments }));
        const standing = [...filesAlone, ...read];
        // A read again takes what another window or a move wrote, and writes nothing of its own.
        if ("reread" in change) {
          ctx.setSelf(standing);
          return;
        }
        const next =
          "drop" in change
            ? standing.filter((kept) => !change.drop(kept.place))
            : withDraft(
                standing,
                change.place,
                change.next(
                  standing.find((kept) => Equal.equals(kept.place, change.place)) ?? EMPTY_DRAFT,
                ),
              );
        ctx.setSelf(writeDrafts(owner, next));
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
    if (id !== undefined && email !== undefined) adoptDrafts(email, id);
    own(id ?? email ?? null);
    // Note that the account's drafts are read again, because a window that held them before may
    // hold them as they stood then, before a move from its address added to them.
    change({ reread: true });
  }, [own, change, id, email]);
  // Another panel's window writing the drafts is read at once, so a box never types over its words.
  useEffect(() => {
    const heard = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) change({ reread: true });
    };
    window.addEventListener("storage", heard);
    return () => window.removeEventListener("storage", heard);
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

/** One box's draft and the presses that change it. */
export interface DraftControl {
  readonly draft: Draft;
  /** Moves the draft on from what it holds as the change lands, which a file read late needs. */
  readonly update: (next: (was: Draft) => Draft) => void;
}

/** The draft kept for `place`, empty where none is. */
export function useDraft(place: DraftPlace): DraftControl {
  const draft = useAtomValue(
    draftsAtom,
    (drafts) => drafts.find((kept) => Equal.equals(kept.place, place)) ?? EMPTY_DRAFT,
  );
  const change = useAtomSet(draftsAtom);
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
  return useMemo(
    () => ({ update: (place, next) => change({ place, next }), drop: (drop) => change({ drop }) }),
    [change],
  );
}

/** Whether a plan holds a draft: one of its agents', its draft agent's, or an inbox card's. */
export function usePlanDrafted(taskId: string): boolean {
  return useAtomValue(draftedAtom, (tasks) => tasks.includes(taskId));
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
