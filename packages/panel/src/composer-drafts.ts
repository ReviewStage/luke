import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { type AgentAttachment, DIFF_SIDE } from "@repo/features/agent-wire";
import {
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxFormValue,
  type InboxItem,
  type InboxReplyKind,
  inboxFormValueSchema,
} from "@repo/features/inbox-wire";
import { DESCRIPTION_COMMENT_SCOPE } from "@repo/features/description-comment-wire";
import { Duration, Effect, Equal, Schema, SchemaTransformation } from "effect";
import { Atom } from "effect/reactivity";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { readKept, writeKept } from "./kept-storage.js";
import { rendererRuntime } from "./renderer-runtime.js";

const STORAGE_KEY = "app.composerDrafts";

const MAX_KEPT = 200;

const STORE_PAUSE = Duration.millis(300);

export const DRAFT_PLACE = {
  AGENT: "agent",
  NEW_AGENT: "newAgent",
  INBOX: "inbox",
  NEW_TASK: "newTask",
  NEW_AUTOMATION: "newAutomation",
  DESCRIPTION_COMMENT: "descriptionComment",
  LINE_COMMENT: "lineComment",
  EDIT: "edit",
} as const;

const descriptionCommentKind = Schema.Literals([
  DRAFT_PLACE.DESCRIPTION_COMMENT,
  "planComment",
]).pipe(
  Schema.decodeTo(
    Schema.Literal(DRAFT_PLACE.DESCRIPTION_COMMENT),
    SchemaTransformation.transform<
      typeof DRAFT_PLACE.DESCRIPTION_COMMENT,
      typeof DRAFT_PLACE.DESCRIPTION_COMMENT | "planComment"
    >({
      decode: () => DRAFT_PLACE.DESCRIPTION_COMMENT,
      encode: (kind) => kind,
    }),
  ),
);

const draftPlaceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.AGENT),
    planId: Schema.NullOr(Schema.String),
    agentId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.NEW_AGENT),
    planId: Schema.String,
    draftId: Schema.String,
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
    planId: Schema.NullOr(Schema.String),
    agentId: Schema.String,
    itemId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.NEW_TASK),
    workspaceId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.NEW_AUTOMATION),
    workspaceId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: descriptionCommentKind,
    planId: Schema.String,
    on: Schema.Union([
      Schema.Struct({ threadId: Schema.String, entryId: Schema.String }),
      Schema.Struct({ threadId: Schema.String }),
      Schema.Struct({
        quote: Schema.String,
        scope: Schema.Literals(Object.values(DESCRIPTION_COMMENT_SCOPE)),
      }),
    ]),
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.LINE_COMMENT),
    agentId: Schema.String,
    number: Schema.optionalKey(Schema.Number),
    path: Schema.String,
    side: Schema.Literals(Object.values(DIFF_SIDE)),
    line: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal(DRAFT_PLACE.EDIT),
    agentId: Schema.String,
    messageId: Schema.String,
  }),
]);

export type DraftPlace = typeof draftPlaceSchema.Type;

const issueDraftPlaceSchema = Schema.Struct({
  kind: Schema.Literal(DRAFT_PLACE.NEW_TASK),
  workspaceId: Schema.NullOr(Schema.String),
  issueId: Schema.String,
});

const revisedPlaceSchema = Schema.Struct({
  kind: Schema.Literal(DRAFT_PLACE.INBOX),
  planId: Schema.NullOr(Schema.String),
  agentId: Schema.String,
  itemId: Schema.String,
  revision: Schema.Number,
  thread: Schema.optionalKey(Schema.Literal(true)),
});

const RETIRED_DRAFT_PLACE = {
  CHAT: "chat",
  CHAT_ASK: "chatAsk",
  NEW_THREAD: "newThread",
} as const;

const retiredPlaceSchema = Schema.Struct({
  kind: Schema.Literals(Object.values(RETIRED_DRAFT_PLACE)),
});

const storedPlaceSchema = Schema.Union([
  issueDraftPlaceSchema,
  revisedPlaceSchema,
  draftPlaceSchema,
  retiredPlaceSchema,
]);

type StoredPlace = typeof storedPlaceSchema.Type;

function retired(stored: StoredPlace): stored is typeof retiredPlaceSchema.Type {
  return Object.values<string>(RETIRED_DRAFT_PLACE).includes(stored.kind);
}

function placeOf(
  stored: StoredPlace,
): { readonly place: DraftPlace; readonly revision?: number } | undefined {
  if (retired(stored) || "issueId" in stored) return undefined;
  if (!("revision" in stored)) return { place: stored };
  const { kind, planId, agentId, itemId, revision } = stored;
  return { place: { kind, planId, agentId, itemId }, revision };
}

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
      resolving: Schema.optionalKey(Schema.Literal(true)),
      dropped: Schema.optionalKey(Schema.Array(Schema.String)),
      revision: Schema.optionalKey(Schema.Number),
    }),
  ),
);

type StoredDraft = (typeof storedDrafts.Type)[number];

type Owner = string | null;

export interface Draft {
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly choices: readonly string[];
  readonly values: readonly InboxFormValue[];
  readonly steps?: readonly number[] | undefined;
  readonly press?: InboxReplyKind | undefined;
  readonly resolving?: true | undefined;
  readonly dropped?: readonly string[] | undefined;
  readonly revision?: number | undefined;
}

export interface KeptDraft<Place extends DraftPlace = DraftPlace> extends Draft {
  readonly place: Place;
}

export type NewAgentPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.NEW_AGENT }>;

export type InboxPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.INBOX }>;

export type DescriptionCommentPlace = Extract<
  DraftPlace,
  { kind: typeof DRAFT_PLACE.DESCRIPTION_COMMENT }
>;

export type LineCommentPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.LINE_COMMENT }>;

export type EditPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.EDIT }>;

export const EMPTY_DRAFT: Draft = { text: "", attachments: [], choices: [], values: [] };

function stored(draft: Draft): boolean {
  return (
    draft.text !== "" ||
    draft.choices.length > 0 ||
    draft.values.length > 0 ||
    (draft.steps ?? []).length > 0 ||
    draft.press !== undefined ||
    draft.resolving === true ||
    (draft.dropped ?? []).length > 0
  );
}

function holds(draft: Draft): boolean {
  return stored(draft) || draft.attachments.length > 0;
}

function readStored(): readonly StoredDraft[] {
  return readKept(STORAGE_KEY, storedDrafts, []);
}

function readDrafts(owner: Owner): readonly KeptDraft[] {
  const read = readStored()
    .filter((kept) => kept.accountId === owner)
    .flatMap(({ place: storedPlace, text, choices = [], values = [], ...rest }) => {
      const read = placeOf(storedPlace);
      if (read === undefined) return [];
      const { steps, press, resolving, dropped } = rest;
      const revision = rest.revision ?? read.revision;
      return [
        {
          place: read.place,
          text,
          attachments: [],
          choices,
          values,
          ...(steps === undefined ? undefined : { steps }),
          ...(press === undefined ? undefined : { press }),
          ...(resolving === undefined ? undefined : { resolving }),
          ...(dropped === undefined ? undefined : { dropped }),
          ...(revision === undefined ? undefined : { revision }),
        },
      ];
    })
    .filter(stored);
  return read.filter(
    (kept, at) => !read.slice(at + 1).some((later) => Equal.equals(later.place, kept.place)),
  );
}

function storedAs(owner: Owner, kept: KeptDraft, entry: StoredDraft): boolean {
  return (
    entry.accountId === owner &&
    Equal.equals(entry.place, kept.place) &&
    entry.text === kept.text &&
    Equal.equals(entry.choices ?? [], kept.choices) &&
    Equal.equals(entry.values ?? [], kept.values) &&
    Equal.equals(entry.steps ?? [], kept.steps ?? []) &&
    entry.press === kept.press &&
    entry.resolving === kept.resolving &&
    Equal.equals(entry.dropped ?? [], kept.dropped ?? []) &&
    entry.revision === kept.revision
  );
}

function entryOf(
  owner: Owner,
  { place, text, choices, values, steps = [], press, resolving, dropped = [], revision }: KeptDraft,
): StoredDraft {
  return {
    accountId: owner,
    place,
    text,
    ...(choices.length === 0 ? undefined : { choices }),
    ...(values.length === 0 ? undefined : { values }),
    ...(steps.length === 0 ? undefined : { steps }),
    ...(press === undefined ? undefined : { press }),
    ...(resolving === undefined ? undefined : { resolving }),
    ...(dropped.length === 0 ? undefined : { dropped }),
    ...(revision === undefined ? undefined : { revision }),
  };
}

function sameStored(
  owner: Owner,
  one: KeptDraft | undefined,
  other: KeptDraft | undefined,
): boolean {
  if (one === undefined || !stored(one)) return other === undefined || !stored(other);
  return other !== undefined && storedAs(owner, one, entryOf(owner, other));
}

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

function withDraft(
  drafts: readonly KeptDraft[],
  place: DraftPlace,
  draft: Draft,
): readonly KeptDraft[] {
  const others = drafts.filter((kept) => !Equal.equals(kept.place, place));
  return holds(draft) ? [...others, { ...draft, place }] : others;
}

type DraftChange =
  | { readonly place: DraftPlace; readonly next: (was: Draft) => Draft }
  | { readonly drop: (place: DraftPlace) => boolean }
  | { readonly store: true }
  | { readonly reread: true }
  | { readonly adopt: Owner }
  | { readonly forget: true };

const STORE: DraftChange = { store: true };

const REREAD: DraftChange = { reread: true };

const FORGET: DraftChange = { forget: true };

interface UnstoredPlace {
  readonly place: DraftPlace;
  readonly was: KeptDraft | undefined;
}

type Unstored = readonly UnstoredPlace[];

const NOTHING_UNSTORED: Unstored = [];

const unstoredOf = Atom.family((_owner: Owner) =>
  Atom.keepAlive(Atom.make<Unstored>(NOTHING_UNSTORED)),
);

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

function readBeside(owner: Owner, held: readonly KeptDraft[]): readonly KeptDraft[] {
  const read = readDrafts(owner).map((kept) => {
    const was = held.find((each) => Equal.equals(each.place, kept.place));
    if (was === undefined) return kept;
    return Equal.equals({ ...was, attachments: [] }, kept)
      ? was
      : { ...kept, attachments: was.attachments };
  });
  const filesAlone = held
    .filter(
      (kept) =>
        kept.attachments.length > 0 && !read.some((each) => Equal.equals(each.place, kept.place)),
    )
    .map((kept) => ({ ...EMPTY_DRAFT, place: kept.place, attachments: kept.attachments }));
  return [...filesAlone, ...read];
}

function withUnstored(
  standing: readonly KeptDraft[],
  held: readonly KeptDraft[],
  unstored: Unstored,
): readonly KeptDraft[] {
  return unstored.reduce<readonly KeptDraft[]>(
    (drafts, { place }) =>
      withDraft(drafts, place, held.find((kept) => Equal.equals(kept.place, place)) ?? EMPTY_DRAFT),
    standing,
  );
}

type DraftEdit = Extract<
  DraftChange,
  { readonly place: DraftPlace } | { readonly drop: (place: DraftPlace) => boolean }
>;

function filesGoWith(owner: Owner, theirs: KeptDraft, standing: KeptDraft | undefined): boolean {
  if (!stored(theirs)) return standing === undefined;
  return standing !== undefined && sameStored(owner, theirs, standing);
}

function withFilesOf(
  owner: Owner,
  held: readonly KeptDraft[],
  theirs: readonly KeptDraft[],
): readonly KeptDraft[] {
  const standing = readDrafts(owner);
  return theirs
    .filter((kept) => kept.attachments.length > 0)
    .filter((kept) =>
      filesGoWith(
        owner,
        kept,
        standing.find((each) => Equal.equals(each.place, kept.place)),
      ),
    )
    .reduce<readonly KeptDraft[]>((drafts, { place, attachments }) => {
      const was = drafts.find((kept) => Equal.equals(kept.place, place)) ?? EMPTY_DRAFT;
      return withDraft(drafts, place, { ...was, attachments });
    }, held);
}

function edited(held: readonly KeptDraft[], edit: DraftEdit): readonly KeptDraft[] {
  if ("drop" in edit) return held.filter((kept) => !edit.drop(kept.place));
  const was = held.find((kept) => Equal.equals(kept.place, edit.place)) ?? EMPTY_DRAFT;
  return withDraft(held, edit.place, edit.next(was));
}

function unstoredWith(unstored: Unstored, held: readonly KeptDraft[], place: DraftPlace): Unstored {
  const standing = unstored.find((each) => Equal.equals(each.place, place));
  const was =
    standing === undefined ? held.find((kept) => Equal.equals(kept.place, place)) : standing.was;
  return [...unstored.filter((each) => each !== standing), { place, was }];
}

function unstoredAfter(unstored: Unstored, held: readonly KeptDraft[], edit: DraftEdit): Unstored {
  if (!("drop" in edit)) return unstoredWith(unstored, held, edit.place);
  return held
    .filter((kept) => edit.drop(kept.place))
    .reduce((after, kept) => unstoredWith(after, held, kept.place), unstored);
}

function unstoredBeside(
  owner: Owner,
  unstored: Unstored,
  standing: readonly KeptDraft[],
): Unstored {
  return unstored.filter(({ place, was }) =>
    sameStored(
      owner,
      was,
      standing.find((kept) => Equal.equals(kept.place, place)),
    ),
  );
}

function nothingUnstored(unstored: Unstored): boolean {
  return unstored.length === 0;
}

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
        if ("adopt" in change) {
          ctx.setSelf(withFilesOf(owner, held, ctx.get(draftsOf(change.adopt))));
          ctx.set(draftsOf(change.adopt), FORGET);
          return;
        }
        if ("forget" in change) {
          ctx.set(unstoredOf(owner), NOTHING_UNSTORED);
          ctx.setSelf(readDrafts(owner));
          return;
        }
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

const ownerAtom = Atom.keepAlive(Atom.make<Owner>(null));

const draftsAtom = Atom.writable(
  (get) => get(draftsOf(get(ownerAtom))),
  (ctx, change: DraftChange) => ctx.set(draftsOf(ctx.get(ownerAtom)), change),
);

const ADOPTERS: ((ctx: Atom.WriteContext<null>, address: string, accountId: string) => void)[] = [];

export function heldLines<Line>(): Atom.Writable<readonly Line[]> {
  const all = Atom.keepAlive(Atom.make<ReadonlyMap<Owner, readonly Line[]>>(new Map()));
  ADOPTERS.push((ctx, address, accountId) => {
    const lines = ctx.get(all);
    const theirs = lines.get(address);
    if (theirs === undefined) return;
    const moved = new Map(lines).set(accountId, [...(lines.get(accountId) ?? []), ...theirs]);
    moved.delete(address);
    ctx.set(all, moved);
  });
  return Atom.keepAlive(
    Atom.writable(
      (get) => get(all).get(get(ownerAtom)) ?? [],
      (ctx, next: readonly Line[]) =>
        ctx.set(all, new Map(ctx.get(all)).set(ctx.get(ownerAtom), next)),
    ),
  );
}

export interface KeptLines<Line, Kept> {
  readonly key: string;
  readonly kept: Schema.Codec<Kept, Kept>;
  readonly toKept: (line: Line) => Kept;
  readonly fromKept: (kept: Kept) => Line;
  readonly idOf: (kept: Kept) => string;
}

const keptRevisionAtom = Atom.keepAlive(Atom.make(0));

export function keptLines<Line, Kept>(spec: KeptLines<Line, Kept>): Atom.Writable<readonly Line[]> {
  const stored = Schema.fromJsonString(
    Schema.Array(Schema.Struct({ accountId: Schema.String, line: spec.kept })),
  );
  const idOf = (line: Line) => spec.idOf(spec.toKept(line));
  const held = Atom.keepAlive(Atom.make<ReadonlyMap<string, Line>>(new Map()));
  const read = (owner: Owner, lines: ReadonlyMap<string, Line>): readonly Line[] =>
    owner === null
      ? []
      : readKept(spec.key, stored, [])
          .filter((entry) => entry.accountId === owner)
          .map(({ line: kept }) => {
            const was = lines.get(spec.idOf(kept));
            return was !== undefined && Equal.equals(spec.toKept(was), kept)
              ? was
              : spec.fromKept(kept);
          });
  const self: Atom.Writable<readonly Line[]> = Atom.keepAlive(
    Atom.writable(
      (get) => {
        get(keptRevisionAtom);
        return read(get(ownerAtom), get(held));
      },
      (ctx, next: readonly Line[]) => {
        const owner = ctx.get(ownerAtom);
        if (owner === null) return;
        const was = new Set(ctx.get(self).map(idOf));
        const changed = new Map(next.map((line) => [idOf(line), line]));
        const all = readKept(spec.key, stored, []);
        const standing = all.flatMap((entry) => {
          if (entry.accountId !== owner) return [entry];
          const id = spec.idOf(entry.line);
          const line = changed.get(id);
          if (line !== undefined) return [{ accountId: owner, line: spec.toKept(line) }];
          return was.has(id) ? [] : [entry];
        });
        const kept = new Set(
          standing.flatMap((entry) => (entry.accountId === owner ? [spec.idOf(entry.line)] : [])),
        );
        const added = next
          .filter((line) => !was.has(idOf(line)) && !kept.has(idOf(line)))
          .map((line) => ({ accountId: owner, line: spec.toKept(line) }));
        writeKept(spec.key, stored, [...standing, ...added]);
        ctx.set(held, new Map([...ctx.get(held), ...changed]));
        ctx.set(keptRevisionAtom, ctx.get(keptRevisionAtom) + 1);
      },
    ),
  );
  return self;
}

const adoptAtom = Atom.writable(
  () => null,
  (ctx, { address, accountId }: { readonly address: string; readonly accountId: string }) => {
    if (ctx.get(ownerAtom) !== address) return;
    ctx.set(draftsOf(accountId), { adopt: address });
    for (const adopt of ADOPTERS) adopt(ctx, address, accountId);
  },
);

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

export function useDraftsOwner(
  account: { readonly id?: string | undefined; readonly email: string } | undefined,
): void {
  const own = useAtomSet(ownerAtom);
  const change = useAtomSet(draftsAtom);
  const reread = useAtomSet(keptRevisionAtom);
  const adopt = useAtomSet(adoptAtom);
  const id = account?.id;
  const email = account?.email;
  useLayoutEffect(() => {
    change(STORE);
    if (id !== undefined && email !== undefined) {
      adoptDrafts(email, id);
      adopt({ address: email, accountId: id });
    }
    own(id ?? email ?? null);
    change(REREAD);
  }, [own, change, adopt, id, email]);
  useEffect(() => {
    const heard = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) change(REREAD);
      else reread((was) => was + 1);
    };
    window.addEventListener("storage", heard);
    return () => window.removeEventListener("storage", heard);
  }, [change, reread]);
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

const draftedAtom = Atom.withEquality(
  Atom.make((get): readonly (string | null)[] =>
    get(draftsAtom).flatMap(({ place }) => ("planId" in place ? [place.planId] : [])),
  ),
  Equal.equals,
);

const draftedAgentsAtom = Atom.withEquality(
  Atom.make((get): readonly string[] =>
    get(draftsAtom).flatMap(({ place }) =>
      place.kind === DRAFT_PLACE.AGENT ? [place.agentId] : [],
    ),
  ),
  Equal.equals,
);

export interface DraftControl {
  readonly draft: Draft;
  readonly update: (next: (was: Draft) => Draft) => void;
}

function useStoreOnLeave(change: (change: DraftChange) => void): void {
  useEffect(() => () => change(STORE), [change]);
}

export function useDraft(place: DraftPlace): DraftControl {
  const draft = useAtomValue(
    draftsAtom,
    (drafts) => drafts.find((kept) => Equal.equals(kept.place, place)) ?? EMPTY_DRAFT,
  );
  const change = useAtomSet(draftsAtom);
  useStoreOnLeave(change);
  return { draft, update: (next) => change({ place, next }) };
}

function isNewAgent(kept: KeptDraft): kept is KeptDraft<NewAgentPlace> {
  return kept.place.kind === DRAFT_PLACE.NEW_AGENT;
}

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

function isInbox(kept: KeptDraft): kept is KeptDraft<InboxPlace> {
  return kept.place.kind === DRAFT_PLACE.INBOX;
}

export function holdsPicks(
  draft: Pick<Draft, "choices" | "values" | "steps" | "press" | "resolving">,
): boolean {
  return (
    draft.choices.length > 0 ||
    draft.values.length > 0 ||
    (draft.steps ?? []).length > 0 ||
    draft.press !== undefined ||
    draft.resolving === true
  );
}

export function withoutPicks<D extends Draft>(draft: D): D {
  return {
    ...draft,
    choices: [],
    values: [],
    steps: undefined,
    press: undefined,
    resolving: undefined,
    revision: undefined,
  };
}

function draftAt<D extends Draft>(draft: D, revision: number | null): D {
  return draft.revision === revision || !holdsPicks(draft) ? draft : withoutPicks(draft);
}

export function draftOfItem<D extends Draft>(
  draft: D,
  item: Pick<InboxItem, "revision" | "status">,
): D {
  return draftAt(draft, item.status === INBOX_STATUS.OPEN ? item.revision : null);
}

export function useInboxItemDrafted(item: Pick<InboxItem, "id" | "revision" | "status">): boolean {
  return useAtomValue(draftsAtom, (drafts) =>
    drafts.some(
      (kept) => isInbox(kept) && kept.place.itemId === item.id && holds(draftOfItem(kept, item)),
    ),
  );
}

export interface InboxRowDraft
  extends Pick<Draft, "choices" | "values" | "steps" | "press" | "resolving"> {
  readonly itemId: string;
  readonly revision: number | undefined;
  readonly words: boolean;
}

const inboxRowDraftsAtom = Atom.withEquality(
  Atom.make((get): readonly InboxRowDraft[] =>
    get(draftsAtom)
      .filter(isInbox)
      .map((kept) => ({
        itemId: kept.place.itemId,
        revision: kept.revision,
        words: kept.text !== "" || kept.attachments.length > 0 || (kept.dropped ?? []).length > 0,
        choices: kept.choices,
        values: kept.values,
        steps: kept.steps,
        press: kept.press,
        resolving: kept.resolving,
      })),
  ),
  Equal.equals,
);

const NO_ROW_DRAFTS: ReadonlyMap<string, InboxRowDraft> = new Map();

export function useInboxRowDrafts(): ReadonlyMap<string, InboxRowDraft> {
  const last = useRef(NO_ROW_DRAFTS);
  return useAtomValue(inboxRowDraftsAtom, (drafts) => {
    const was = last.current;
    const kept = drafts.map((draft): [string, InboxRowDraft] => {
      const held = was.get(draft.itemId);
      return [draft.itemId, held !== undefined && Equal.equals(held, draft) ? held : draft];
    });
    const same = kept.length === was.size && kept.every(([id, draft]) => was.get(id) === draft);
    if (!same) last.current = new Map(kept);
    return last.current;
  });
}

export function picksStandOn(
  revision: number | undefined,
  picks: boolean,
  item: Pick<InboxItem, "revision" | "status">,
): boolean {
  return !picks || revision === (item.status === INBOX_STATUS.OPEN ? item.revision : null);
}

function picksStand(draft: InboxRowDraft, item: Pick<InboxItem, "revision" | "status">): boolean {
  return picksStandOn(draft.revision, holdsPicks(draft), item);
}

export interface InboxDraftStanding {
  readonly place: InboxPlace;
  readonly revision: number | undefined;
  readonly picks: boolean;
}

const inboxDraftStandingsAtom = Atom.withEquality(
  Atom.make((get): readonly InboxDraftStanding[] =>
    get(draftsAtom)
      .filter(isInbox)
      .map((kept) => ({ place: kept.place, revision: kept.revision, picks: holdsPicks(kept) })),
  ),
  Equal.equals,
);

export function useInboxDraftStandings(): readonly InboxDraftStanding[] {
  return useAtomValue(inboxDraftStandingsAtom);
}

export function rowDrafted(
  draft: InboxRowDraft | undefined,
  item: Pick<InboxItem, "revision" | "status">,
): boolean {
  return draft !== undefined && (draft.words || (picksStand(draft, item) && holdsPicks(draft)));
}

export function rowPicks(
  draft: InboxRowDraft | undefined,
  item: Pick<InboxItem, "revision" | "status">,
): InboxRowDraft | undefined {
  return draft === undefined || !picksStand(draft, item) ? undefined : draft;
}

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

export interface DraftWriter {
  readonly update: (place: DraftPlace, next: (was: Draft) => Draft) => void;
  readonly drop: (drop: (place: DraftPlace) => boolean) => void;
  readonly heldAt: (find: (place: DraftPlace) => boolean) => KeptDraft | undefined;
}

export function useDraftWriter(): DraftWriter {
  const registry = useContext(RegistryContext);
  const change = useAtomSet(draftsAtom);
  useStoreOnLeave(change);
  return useMemo(
    () => ({
      update: (place, next) => change({ place, next }),
      drop: (drop) => change({ drop }),
      heldAt: (find) => registry.get(draftsAtom).find((kept) => find(kept.place)),
    }),
    [change, registry],
  );
}

export function useDescriptionDrafted(taskId: string): boolean {
  return useAtomValue(draftedAtom, (tasks) => tasks.includes(taskId));
}

export function useDraftedAgents(): readonly string[] {
  return useAtomValue(draftedAgentsAtom);
}

export function useNewTaskDrafted(workspaceId: string | undefined): boolean {
  return useAtomValue(draftsAtom, (drafts) =>
    drafts.some(
      ({ place }) =>
        place.kind === DRAFT_PLACE.NEW_TASK && place.workspaceId === (workspaceId ?? null),
    ),
  );
}
