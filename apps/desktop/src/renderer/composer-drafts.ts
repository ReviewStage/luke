import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { Equal, Schema } from "effect";
import { Atom } from "effect/reactivity";
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
 * Mac and reach no other. A mention or a skill is part of the words, written
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

/** The drafts as storage keeps them: each place's words, the latest written last. */
const storedDrafts = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ place: draftPlaceSchema, text: Schema.String })),
);

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

/** The kept drafts, none where none were kept or they no longer read; storage keeps no files, and no draft of files alone. */
function readDrafts(): readonly KeptDraft[] {
  return readKept(STORAGE_KEY, storedDrafts, [])
    .filter((kept) => kept.text !== "")
    .map((kept) => ({ ...kept, attachments: [] }));
}

/** Keeps the drafts' words, each holding some. */
function writeDrafts(drafts: readonly KeptDraft[]): void {
  const worded = drafts.filter((kept) => kept.text !== "");
  writeKept(
    STORAGE_KEY,
    storedDrafts,
    worded.map(({ place, text }) => ({ place, text })),
  );
}

/** The drafts with `place`'s set to `draft`, latest last, or let go where it holds nothing. */
function withDraft(
  drafts: readonly KeptDraft[],
  place: DraftPlace,
  draft: Draft,
): readonly KeptDraft[] {
  const others = drafts.filter((kept) => !Equal.equals(kept.place, place));
  return holds(draft) ? [...others, { place, ...draft }].slice(-MAX_KEPT) : others;
}

/** A change to the drafts: one place's draft moved on from what it holds, or the drafts a predicate names let go. */
type DraftChange =
  | { readonly place: DraftPlace; readonly next: (was: Draft) => Draft }
  | { readonly drop: (place: DraftPlace) => boolean };

/**
 * Every draft this window holds. Note that a write keeps the words of every
 * other place as storage holds them, and the files as this window does,
 * since storage holds none, with a draft of files alone this window's own;
 * each draft unchanged is the very one it was, so a box reading another
 * place's draft does not draw again. The atom is kept alive, because the
 * files live nowhere else while no box is open.
 */
const draftsAtom = Atom.keepAlive(
  Atom.writable(readDrafts, (ctx, change: DraftChange) => {
    const held = ctx.get(draftsAtom);
    const read = readDrafts().map((stored) => {
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
    writeDrafts(next);
    ctx.setSelf(next);
  }),
);

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

/** The draft kept for a plan's draft agent, under whichever key it was kept; nothing where the plan has none. */
export function useNewAgentDraft(planId: string | undefined): KeptDraft<NewAgentPlace> | undefined {
  return useAtomValue(draftsAtom, (drafts) =>
    drafts.filter(isNewAgent).find((kept) => kept.place.planId === planId),
  );
}

/** The presses that write any place's draft, or let go of those a predicate names. */
export interface DraftWriter {
  readonly update: (place: DraftPlace, next: (was: Draft) => Draft) => void;
  readonly drop: (drop: (place: DraftPlace) => boolean) => void;
}

/** The draft writer, for an owner that reads its drafts on its own. */
export function useDraftWriter(): DraftWriter {
  const change = useAtomSet(draftsAtom);
  return { update: (place, next) => change({ place, next }), drop: (drop) => change({ drop }) };
}

/** Whether a plan holds a draft: one of its agents', or its draft agent's. */
export function usePlanDrafted(planId: string): boolean {
  return useAtomValue(draftedAtom, (drafted) => drafted.plans.includes(planId));
}

/** The agents holding a draft, by id. */
export function useDraftedAgents(): readonly string[] {
  return useAtomValue(draftedAtom).agents;
}
