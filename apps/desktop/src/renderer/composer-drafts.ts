import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { Equal, Schema } from "effect";
import { Atom } from "effect/reactivity";
import { useLayoutEffect, useMemo } from "react";
import { readKept, writeKept } from "./desktop/folded-groups";

/**
 * composer-drafts.ts -- what the developer typed in a box and has not sent, kept per destination on this Mac, so switching away and back finds it where it was left.
 *
 * Every chat keeps an unsent message per conversation, Slack's, Linear's,
 * Discord's, and GitHub's comments alike, and so does every box here that
 * sends somewhere: an agent's composer keeps its words per agent, and a
 * plan's draft agent its first message per plan. A draft is known by where
 * it goes, a place named by the ids of what it goes to, never one key built
 * of them. Sending a draft lets it go, and so does emptying its box, so a
 * place holds a draft only while its box holds something.
 *
 * The words are kept in the renderer's own storage, as the sidebar's folds
 * and the plans' looks are, so they outlast a reload and a relaunch on this
 * Mac and reach no other. They are the account's that wrote them, each kept
 * with its account's id, and a window reads only the drafts of the account
 * signed in to it (`useDraftsOwner`), so a teammate signing in on the same
 * Mac meets nothing of another's unsent words, which wait for their writer
 * to sign in again. A mention or a skill is part of the words, written
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

/** What a draft is written to: a started agent, or a plan's agent not yet started. */
export const DRAFT_PLACE = {
  AGENT: "agent",
  NEW_AGENT: "newAgent",
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
  }),
]);

/** Where one draft goes. */
export type DraftPlace = typeof draftPlaceSchema.Type;

/** The drafts as storage keeps them: each place's words and the account that wrote them, the latest written last. */
const storedDrafts = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      accountId: Schema.NullOr(Schema.String),
      place: draftPlaceSchema,
      text: Schema.String,
    }),
  ),
);

type StoredDraft = (typeof storedDrafts.Type)[number];

/** The account a window's drafts are written by: the one signed in, none before its state is read, as in a test. */
type Owner = string | null;

/** What a box holds unsent: its words, and the files attached to them. */
export interface Draft {
  readonly text: string;
  readonly attachments: readonly CodingAgentAttachment[];
}

/** One place's draft. */
export interface KeptDraft<Place extends DraftPlace = DraftPlace> extends Draft {
  readonly place: Place;
}

/** A plan's draft agent's place. */
export type NewAgentPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.NEW_AGENT }>;

/** A box holding nothing. */
export const EMPTY_DRAFT: Draft = { text: "", attachments: [] };

/** Whether a draft holds anything to keep. */
function holds(draft: Draft): boolean {
  return draft.text !== "" || draft.attachments.length > 0;
}

/** Every account's kept drafts, none where none were kept or they no longer read. */
function readStored(): readonly StoredDraft[] {
  return readKept(STORAGE_KEY, storedDrafts, []);
}

/** The owner's kept drafts; storage keeps no files, and no draft of files alone. */
function readDrafts(owner: Owner): readonly KeptDraft[] {
  return readStored()
    .filter((kept) => kept.accountId === owner && kept.text !== "")
    .map(({ place, text }) => ({ place, text, attachments: [] }));
}

/** Keeps the owner's drafts' words, each holding some, beside every other account's as storage holds them. */
function writeDrafts(owner: Owner, drafts: readonly KeptDraft[]): void {
  const others = readStored().filter((kept) => kept.accountId !== owner);
  const worded = drafts
    .filter((kept) => kept.text !== "")
    .map(({ place, text }) => ({ accountId: owner, place, text }));
  writeKept(STORAGE_KEY, storedDrafts, [...others, ...worded].slice(-MAX_KEPT));
}

/** The drafts with `place`'s set to `draft`, latest last, or let go where it holds nothing. */
function withDraft(
  drafts: readonly KeptDraft[],
  place: DraftPlace,
  draft: Draft,
): readonly KeptDraft[] {
  const others = drafts.filter((kept) => !Equal.equals(kept.place, place));
  return holds(draft) ? [...others, { place, ...draft }] : others;
}

/** A change to the drafts: one place's draft moved on from what it holds, or the drafts a predicate names let go. */
type DraftChange =
  | { readonly place: DraftPlace; readonly next: (was: Draft) => Draft }
  | { readonly drop: (place: DraftPlace) => boolean };

/** The account signed in to this window, whose drafts it reads and writes. */
const ownerAtom = Atom.keepAlive(Atom.make<Owner>(null));

/**
 * Every draft this window's account holds. Note that a write keeps the words
 * of every other place as storage holds them, and the files as this window
 * does, since storage holds none, with a draft of files alone this window's
 * own; each draft unchanged is the very one it was, so a box reading another
 * place's draft does not draw again. The atom is kept alive, because the
 * files live nowhere else while no box is open; another account signing in
 * reads its own afresh.
 */
const draftsAtom = Atom.keepAlive(
  Atom.writable(
    (get) => readDrafts(get(ownerAtom)),
    (ctx, change: DraftChange) => {
      const owner = ctx.get(ownerAtom);
      const held = ctx.get(draftsAtom);
      const read = readDrafts(owner).map((stored) => {
        const was = held.find((kept) => Equal.equals(kept.place, stored.place));
        if (was === undefined) return stored;
        return was.text === stored.text ? was : { ...stored, attachments: was.attachments };
      });
      const filesAlone = held.filter(
        (kept) =>
          kept.text === "" &&
          kept.attachments.length > 0 &&
          !read.some((stored) => Equal.equals(stored.place, kept.place)),
      );
      const stored = [...filesAlone, ...read];
      const next =
        "drop" in change
          ? stored.filter((kept) => !change.drop(kept.place))
          : withDraft(
              stored,
              change.place,
              change.next(
                stored.find((kept) => Equal.equals(kept.place, change.place)) ?? EMPTY_DRAFT,
              ),
            );
      writeDrafts(owner, next);
      ctx.setSelf(next);
    },
  ),
);

/**
 * Hands this window's drafts to the account signed in to it, before the
 * window is painted, so a box opening as the account changes never shows
 * another's words; nothing while none is signed in.
 */
export function useDraftsOwner(accountId: string | undefined): void {
  const own = useAtomSet(ownerAtom);
  useLayoutEffect(() => own(accountId ?? null), [own, accountId]);
}

/**
 * Where a draft waits, read off every draft: the plans and the agents, each
 * by id. Note that it is an atom of its own, compared by its contents, so a
 * row or a tab marking a draft draws again only as a draft comes or goes,
 * never on each word typed.
 */
const draftedAtom = Atom.withEquality(
  Atom.make((get) => {
    const places = get(draftsAtom).map((kept) => kept.place);
    return {
      plans: places.flatMap((place) => (place.planId === null ? [] : [place.planId])),
      agents: places.flatMap((place) => (place.kind === DRAFT_PLACE.AGENT ? [place.agentId] : [])),
    };
  }),
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
  planId: string | undefined,
  draftId: string | undefined,
): KeptDraft<NewAgentPlace> | undefined {
  return useAtomValue(draftsAtom, (drafts) => {
    const plans = drafts.filter(isNewAgent).filter((kept) => kept.place.planId === planId);
    return draftId === undefined
      ? plans.at(-1)
      : plans.find((kept) => kept.place.draftId === draftId);
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

/** Whether a plan holds a draft: one of its agents', or its draft agent's. */
export function usePlanDrafted(planId: string): boolean {
  return useAtomValue(draftedAtom, (drafted) => drafted.plans.includes(planId));
}

/** The agents holding a draft, by id. */
export function useDraftedAgents(): readonly string[] {
  return useAtomValue(draftedAtom).agents;
}
