import { type AgentAttachment, DIFF_SIDE } from "@repo/features/agent-wire";
import { DESCRIPTION_COMMENT_SCOPE } from "@repo/features/description-comment-wire";
import {
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxFormValue,
  type InboxItem,
  type InboxReplyKind,
  inboxFormValueSchema,
} from "@repo/features/inbox-wire";
import { makeWait, type Wait } from "@repo/ui";
import { createStore, type ReadonlyStore, Store, useSelector } from "@tanstack/react-store";
import { Duration, Effect, Equal, Schema, SchemaTransformation } from "effect";
import { useEffect, useLayoutEffect, useRef } from "react";
import { readKept, writeKept } from "./kept-storage.js";

/**
 * composer-drafts.ts -- what the developer typed in a box and has not sent, kept per destination on this Mac, so switching away and back finds it where it was left.
 *
 * Every chat keeps an unsent message per conversation, Slack's, Linear's,
 * Discord's, and GitHub's comments alike, and so does every box here that
 * sends somewhere: an agent's composer keeps its words per agent, a plan's
 * draft agent its first message per plan, New task its words per workspace
 * the task starts in, a description's comment its words per
 * thread being started, per thread answered, and per comment edited
 * (`description-comments.tsx`), a line comment in Files changed its words per
 * agent, pull request, file, side, and last line (`comment-drafts.ts`), an agent's line
 * written again its words and files per agent and line
 * (`edit-composer.tsx`), and an inbox card its answer
 * per item, the options picked, the fields filled, and, on a thread, the
 * steps ticked and the answer pressed beside its note. A draft is known by
 * where it goes, a place named by the ids of what it goes to, never one key
 * built of them, and never by anything a message landing there moves, a
 * revision, a status, or a time, so what is being written outlasts every
 * message that arrives meanwhile. A card's picks are the one part made on
 * the ask as it stood, so they are kept with the revision they were made
 * on and read as none once the ask changed (`draftAt`), its words and files
 * standing whatever the revision. Sending a draft lets it go, and so does emptying its box, so a
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
const STORAGE_KEY = "app.composerDrafts";

/** How many drafts are kept at most, the oldest written let go first. */
const MAX_KEPT = 200;

/** How long the typing rests before what the window changed is written to storage. */
const STORE_PAUSE = Duration.millis(300);

/** What a draft is written to: a started agent, a plan's agent not yet started, an inbox item, a task not yet started, an automation's helper not yet started, a description's comment, a line comment on an agent's changed file, or an agent's line written again. */
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

/** A description's comment's kind as storage holds it: today's, or `planComment`, which every draft kept before the description was named so holds, read as today's. */
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
    kind: descriptionCommentKind,
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
        scope: Schema.Literals(Object.values(DESCRIPTION_COMMENT_SCOPE)),
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
]);

/** Where one draft goes. */
export type DraftPlace = typeof draftPlaceSchema.Type;

/**
 * New task's words on one of the workspace's own issues, as a build from
 * before the app kept no issues stored them. No card opens on an issue now, so
 * such an entry is read past rather than taken for the workspace's own
 * draft, which it would displace, and goes once its account writes again.
 */
const issueDraftPlaceSchema = Schema.Struct({
  kind: Schema.Literal(DRAFT_PLACE.NEW_TASK),
  workspaceId: Schema.NullOr(Schema.String),
  issueId: Schema.String,
});

/**
 * An inbox card's place as a build from before its picks kept their
 * revision stored it: the revision in the place, and its thread apart from
 * its answer. Note that such an entry is read as today's place with the
 * revision moved onto its draft, so its picks still stand on the ask they
 * were made on, and goes once its account writes again.
 */
const revisedPlaceSchema = Schema.Struct({
  kind: Schema.Literal(DRAFT_PLACE.INBOX),
  planId: Schema.NullOr(Schema.String),
  agentId: Schema.String,
  itemId: Schema.String,
  revision: Schema.Number,
  thread: Schema.optionalKey(Schema.Literal(true)),
});

/** The places of boxes since removed, as a build from before stored them: Chat's and its ask's answer, and the Inbox's New thread's. */
const RETIRED_DRAFT_PLACE = {
  CHAT: "chat",
  CHAT_ASK: "chatAsk",
  NEW_THREAD: "newThread",
} as const;

/**
 * A removed box's place, as a build from before it was removed stored it. No
 * box opens on one now, so such an entry is read past rather than refusing
 * every draft beside it, and goes once its account writes again.
 */
const retiredPlaceSchema = Schema.Struct({
  kind: Schema.Literals(Object.values(RETIRED_DRAFT_PLACE)),
});

/** A place as storage may hold it: one of today's, New task's on an issue (`issueDraftPlaceSchema`), one with its revision (`revisedPlaceSchema`), or a removed box's (`retiredPlaceSchema`). */
const storedPlaceSchema = Schema.Union([
  issueDraftPlaceSchema,
  revisedPlaceSchema,
  draftPlaceSchema,
  retiredPlaceSchema,
]);

type StoredPlace = typeof storedPlaceSchema.Type;

/** Whether a stored place is a removed box's, which no box opens now. */
function retired(stored: StoredPlace): stored is typeof retiredPlaceSchema.Type {
  return Object.values<string>(RETIRED_DRAFT_PLACE).includes(stored.kind);
}

/** The place a box opens today that a stored place names, with the revision a place from before held for its picks; none for a place no box opens now. */
function placeOf(
  stored: StoredPlace,
): { readonly place: DraftPlace; readonly revision?: number } | undefined {
  if (retired(stored) || "issueId" in stored) return undefined;
  if (!("revision" in stored)) return { place: stored };
  const { kind, planId, agentId, itemId, revision } = stored;
  return { place: { kind, planId, agentId, itemId }, revision };
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
      dropped: Schema.optionalKey(Schema.Array(Schema.String)),
      revision: Schema.optionalKey(Schema.Number),
    }),
  ),
);

type StoredDraft = (typeof storedDrafts.Type)[number];

/** The account a window's drafts are written by: the one signed in, none before its state is read, as in a test. */
type Owner = string | null;

/** What a box holds unsent: its words, the files attached to them, and an inbox card's options picked and fields filled, and a thread's steps ticked and answer pressed. */
export interface Draft {
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly choices: readonly string[];
  readonly values: readonly InboxFormValue[];
  readonly steps?: readonly number[] | undefined;
  readonly press?: InboxReplyKind | undefined;
  /** The files of a line written again that its box took off, by their key in the line, so they stay off where the line's files are offered again (`edit-composer.tsx`). */
  readonly dropped?: readonly string[] | undefined;
  /** The revision of the inbox item its picks were made on, so they never land on an ask changed since (`draftAt`). */
  readonly revision?: number | undefined;
}

/** One place's draft. */
export interface KeptDraft<Place extends DraftPlace = DraftPlace> extends Draft {
  readonly place: Place;
}

/** A plan's draft agent's place. */
export type NewAgentPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.NEW_AGENT }>;

/** An inbox card's place. */
export type InboxPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.INBOX }>;

/** A description comment's place: a thread being started, answered, or one of its comments edited. */
export type DescriptionCommentPlace = Extract<
  DraftPlace,
  { kind: typeof DRAFT_PLACE.DESCRIPTION_COMMENT }
>;

/** A line comment in Files changed: the agent, the file, and the side and last line it stands under. */
export type LineCommentPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.LINE_COMMENT }>;

/** An agent's line written again: the agent and the line. */
export type EditPlace = Extract<DraftPlace, { kind: typeof DRAFT_PLACE.EDIT }>;

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
  const read = readStored()
    .filter((kept) => kept.accountId === owner)
    .flatMap(({ place: storedPlace, text, choices = [], values = [], ...rest }) => {
      const read = placeOf(storedPlace);
      if (read === undefined) return [];
      const { steps, press, dropped } = rest;
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
          ...(dropped === undefined ? undefined : { dropped }),
          ...(revision === undefined ? undefined : { revision }),
        },
      ];
    })
    .filter(stored);
  // Note that an inbox card's answer and its thread, kept apart before, are one place now, so the one written later stands.
  return read.filter(
    (kept, at) => !read.slice(at + 1).some((later) => Equal.equals(later.place, kept.place)),
  );
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
    Equal.equals(entry.dropped ?? [], kept.dropped ?? []) &&
    entry.revision === kept.revision
  );
}

/** A draft as storage keeps it, a card's picks only where it holds some. */
function entryOf(
  owner: Owner,
  { place, text, choices, values, steps = [], press, dropped = [], revision }: KeptDraft,
): StoredDraft {
  return {
    accountId: owner,
    place,
    text,
    ...(choices.length === 0 ? undefined : { choices }),
    ...(values.length === 0 ? undefined : { values }),
    ...(steps.length === 0 ? undefined : { steps }),
    ...(press === undefined ? undefined : { press }),
    ...(dropped.length === 0 ? undefined : { dropped }),
    ...(revision === undefined ? undefined : { revision }),
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

/** A change to the drafts: one place's draft moved on from what it holds, the drafts a predicate names let go, what the window changed written to storage, storage read again, the files an account held under its address taken on as its id's, or what the window holds let go of for storage's alone. */
type DraftChange =
  | { readonly place: DraftPlace; readonly next: (was: Draft) => Draft }
  | { readonly drop: (place: DraftPlace) => boolean }
  | { readonly store: true }
  | { readonly reread: true }
  | { readonly adopt: Owner }
  | { readonly forget: true };

/** Writes to storage what the window changed and has not written yet. */
const STORE: DraftChange = { store: true };

/** Reads storage again, and writes beside it what the window changed and has not written yet where no other window wrote over it since. */
const REREAD: DraftChange = { reread: true };

/** Lets go of the files and the changes not written the window holds for an account, and reads storage again. */
const FORGET: DraftChange = { forget: true };

/** A place the window set and has not written, and its draft as storage held it before, none where it held none. */
interface UnstoredPlace {
  readonly place: DraftPlace;
  readonly was: KeptDraft | undefined;
}

/** What a window changed in an account's drafts and has not written to storage: the places it set or let go, the latest changed last. */
type Unstored = readonly UnstoredPlace[];

const NOTHING_UNSTORED: Unstored = [];

/** What the window changed in each account's drafts and has not written to storage yet, by account; none where it changed nothing. */
const unstoredByOwner = new Map<Owner, Unstored>();

/** What the window changed in one account's drafts and has not written to storage yet. */
function unstoredOf(owner: Owner): Unstored {
  return unstoredByOwner.get(owner) ?? NOTHING_UNSTORED;
}

/**
 * The wait before each account's drafts are written to storage, by account.
 * Note that the module holds it rather than the box that typed, because a
 * draft must still reach storage after its box goes (`@repo/ui`'s `wait.ts`).
 */
const storeLaterByOwner = new Map<Owner, Wait>();

/**
 * Writes one account's drafts to storage once the typing rests: starting the
 * wait again starts the pause over and calls off the one standing, so a burst
 * of keys writes once, after the last.
 */
function storeLater(owner: Owner): void {
  const wait = storeLaterByOwner.get(owner) ?? makeWait();
  storeLaterByOwner.set(owner, wait);
  wait.start(
    Effect.andThen(
      Effect.sleep(STORE_PAUSE),
      Effect.sync(() => changeDrafts(owner, STORE)),
    ),
  );
}

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
 * What storage holds with the window's unwritten changes laid over it: each
 * place they changed as the window holds it, moved last, or let go where it
 * holds none. Note that a place the window did not change stands as storage holds
 * it, because another window may have written it since.
 */
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

/** A change to one place, or a drop, as `DraftChange` names them. */
type DraftEdit = Extract<
  DraftChange,
  { readonly place: DraftPlace } | { readonly drop: (place: DraftPlace) => boolean }
>;

/**
 * Whether the files an address held at a place go with what storage now
 * holds there as its id's: where its words stood and won the place, or
 * where they were files alone and no words of the id's stand there. Note
 * that words the id wrote there later win the place (`adoptDrafts`), and the
 * files attached to other words never go with them.
 */
function filesGoWith(owner: Owner, theirs: KeptDraft, standing: KeptDraft | undefined): boolean {
  if (!stored(theirs)) return standing === undefined;
  // Note that the two are compared as storage keeps them, since a box may hold a field unset that storage leaves out.
  return standing !== undefined && sameStored(owner, theirs, standing);
}

/** The drafts the window holds with the files of `theirs` laid over them at each place their files go with what storage holds as the owner's (`filesGoWith`), a draft of files alone where none stands there. */
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

/** The drafts the window holds once `edit` lands on them. */
function edited(held: readonly KeptDraft[], edit: DraftEdit): readonly KeptDraft[] {
  if ("drop" in edit) return held.filter((kept) => !edit.drop(kept.place));
  const was = held.find((kept) => Equal.equals(kept.place, edit.place)) ?? EMPTY_DRAFT;
  return withDraft(held, edit.place, edit.next(was));
}

/** What the window holds unwritten once `place` is changed: it moves last and keeps what storage held before its first change. */
function unstoredWith(unstored: Unstored, held: readonly KeptDraft[], place: DraftPlace): Unstored {
  const standing = unstored.find((each) => Equal.equals(each.place, place));
  const was =
    standing === undefined ? held.find((kept) => Equal.equals(kept.place, place)) : standing.was;
  return [...unstored.filter((each) => each !== standing), { place, was }];
}

/**
 * What the window holds unwritten once `edit` lands. Note that a drop is
 * kept as each place it lets go, with what storage held there, so a read
 * again keeps words another window wrote at one of them since.
 */
function unstoredAfter(unstored: Unstored, held: readonly KeptDraft[], edit: DraftEdit): Unstored {
  if (!("drop" in edit)) return unstoredWith(unstored, held, edit.place);
  return held
    .filter((kept) => edit.drop(kept.place))
    .reduce((after, kept) => unstoredWith(after, held, kept.place), unstored);
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
  return unstored.filter(({ place, was }) =>
    sameStored(
      owner,
      was,
      standing.find((kept) => Equal.equals(kept.place, place)),
    ),
  );
}

/** Whether the window holds nothing unwritten. */
function nothingUnstored(unstored: Unstored): boolean {
  return unstored.length === 0;
}

/**
 * Every draft each account holds, a store of its own per account, read from
 * storage the first time it is asked for. A change is held at once and
 * written to storage once the typing rests (`storeLater`), or sooner where a
 * store is asked for; the write starts from what storage holds, so another
 * window's words at a place this one did not change stand. Each account's
 * store stands for as long as the window does, because the files live nowhere
 * else while no box is open, and is its own, so nothing one account attached
 * reaches another's box.
 */
const draftsByOwner = new Map<Owner, Store<readonly KeptDraft[]>>();

/** The store of one account's drafts, read from storage where the window holds none yet. */
function draftsOf(owner: Owner): Store<readonly KeptDraft[]> {
  const standing = draftsByOwner.get(owner);
  if (standing !== undefined) return standing;
  const made = new Store<readonly KeptDraft[]>(readDrafts(owner));
  draftsByOwner.set(owner, made);
  return made;
}

/** Lands a change on one account's drafts, as `DraftChange` names it. */
function changeDrafts(owner: Owner, change: DraftChange): void {
  const drafts = draftsOf(owner);
  const held = drafts.state;
  const unstored = unstoredOf(owner);
  const hold = (next: readonly KeptDraft[]) => drafts.setState(() => next);
  if ("drop" in change || "place" in change) {
    hold(edited(held, change));
    unstoredByOwner.set(owner, unstoredAfter(unstored, held, change));
    storeLater(owner);
    return;
  }
  // Note that the files an address held are this window's alone, so they are carried here rather than read from storage, and the address keeps none.
  if ("adopt" in change) {
    hold(withFilesOf(owner, held, draftsOf(change.adopt).state));
    changeDrafts(change.adopt, FORGET);
    return;
  }
  if ("forget" in change) {
    unstoredByOwner.delete(owner);
    hold(readDrafts(owner));
    return;
  }
  // A store with nothing unwritten reads nothing, so a pause ending after a flush costs nothing.
  if ("store" in change && nothingUnstored(unstored)) return;
  const standing = readBeside(owner, held);
  const writing = "reread" in change ? unstoredBeside(owner, unstored, standing) : unstored;
  unstoredByOwner.delete(owner);
  hold(
    nothingUnstored(writing) ? standing : writeDrafts(owner, withUnstored(standing, held, writing)),
  );
}

/** The account signed in to this window, whose drafts it reads and writes. */
const ownerStore = new Store<Owner>(null);

/** The drafts of the account signed in to this window. */
const draftsStore = createStore(() => draftsOf(ownerStore.state).state);

/** Lands a change on the drafts of the account signed in to this window, written as that account's. */
function changeOwned(change: DraftChange): void {
  changeDrafts(ownerStore.state, change);
}

/** What a store of lines beside the drafts holds for the window: how it moves an address's lines to its id, and how it lets go of all it holds. */
interface HeldBeside {
  readonly adopt: (address: string, accountId: string) => void;
  readonly forget: () => void;
}

/** Every store of lines held beside the drafts. */
const HELD_BESIDE: HeldBeside[] = [];

/** No lines held. */
const NO_LINES: readonly never[] = [];

/**
 * Lines a window holds for the account signed in to it: `store` reads them,
 * as the one signed in now, and `set` moves them on from what it holds, as
 * a store's `setState` does.
 */
export interface AccountLines<Line> {
  readonly store: ReadonlyStore<readonly Line[]>;
  readonly set: (next: (now: readonly Line[]) => readonly Line[]) => void;
}

/**
 * Lines a window holds for the account signed in to it beside its drafts,
 * in this window alone, as a send refused and kept with its Retry, its
 * words and pictures, is: one list per account, read and written as the
 * one signed in now. They follow the account from its address to its id as
 * its drafts do (`adoptHeld`), so a line written while only the address was
 * known is the id's once the identity learns it.
 */
export function heldLines<Line>(): AccountLines<Line> {
  const all = new Store<ReadonlyMap<Owner, readonly Line[]>>(new Map());
  HELD_BESIDE.push({
    adopt: (address, accountId) =>
      all.setState((lines) => {
        const theirs = lines.get(address);
        if (theirs === undefined) return lines;
        const moved = new Map(lines).set(accountId, [...(lines.get(accountId) ?? []), ...theirs]);
        moved.delete(address);
        return moved;
      }),
    forget: () => all.setState(() => new Map()),
  });
  const store = createStore((): readonly Line[] => all.state.get(ownerStore.state) ?? NO_LINES);
  return {
    store,
    set: (next) => {
      const owner = ownerStore.state;
      all.setState((lines) => new Map(lines).set(owner, next(lines.get(owner) ?? NO_LINES)));
    },
  };
}

/** What `keptLines` keeps a line as in storage, and reads it back from. */
export interface KeptLines<Line, Kept> {
  /** Where in the renderer's storage they are kept. */
  readonly key: string;
  /** A line as storage holds it. */
  readonly kept: Schema.Codec<Kept, Kept>;
  /** A line as it is kept, leaving out what storage cannot hold, its files among them. */
  readonly toKept: (line: Line) => Kept;
  readonly fromKept: (kept: Kept) => Line;
  /** What tells one kept line from another, whichever window wrote it. */
  readonly idOf: (kept: Kept) => string;
}

/** Moved on by every write of kept lines, and by another window's write to storage, so a read of them reads storage again. */
const keptRevision = new Store(0);

/** Reads every store of kept lines from storage again. */
function rereadKept(): void {
  keptRevision.setState((was) => was + 1);
}

/**
 * Lines a window holds for the account signed in to it, as `heldLines`
 * does, that also outlast a reload and a relaunch on this Mac: storage is
 * where they stand, each kept as `toKept` makes it, with its account's id,
 * and read back for that account alone. What storage cannot hold, a line's
 * files, stays in the window that attached them, by the line. Note that a write
 * starts from what storage holds, because another window keeps its lines
 * there too: it changes the lines it changed, adds the ones it added, and
 * lets go of the ones it let go, so a line another window let go is never
 * written back. A window not signed in keeps nothing.
 */
export function keptLines<Line, Kept>(spec: KeptLines<Line, Kept>): AccountLines<Line> {
  const stored = Schema.fromJsonString(
    Schema.Array(Schema.Struct({ accountId: Schema.String, line: spec.kept })),
  );
  const idOf = (line: Line) => spec.idOf(spec.toKept(line));
  // Each line as this window last wrote it, its files among it, by its id.
  const held = new Store<ReadonlyMap<string, Line>>(new Map());
  HELD_BESIDE.push({
    adopt: () => undefined,
    forget: () => held.setState(() => new Map()),
  });
  const read = (owner: Owner, lines: ReadonlyMap<string, Line>): readonly Line[] =>
    owner === null
      ? NO_LINES
      : readKept(spec.key, stored, [])
          .filter((entry) => entry.accountId === owner)
          .map(({ line: kept }) => {
            const was = lines.get(spec.idOf(kept));
            return was !== undefined && Equal.equals(spec.toKept(was), kept)
              ? was
              : spec.fromKept(kept);
          });
  const store = createStore((): readonly Line[] => {
    // Note that the revision is read for its moves alone, so a write here or in another window reads storage again.
    void keptRevision.state;
    return read(ownerStore.state, held.state);
  });
  const set = (change: (now: readonly Line[]) => readonly Line[]): void => {
    const owner = ownerStore.state;
    if (owner === null) return;
    const now = store.state;
    const next = change(now);
    const was = new Set(now.map(idOf));
    const changed = new Map(next.map((line) => [idOf(line), line]));
    const all = readKept(spec.key, stored, []);
    const standing = all.flatMap((entry) => {
      if (entry.accountId !== owner) return [entry];
      const id = spec.idOf(entry.line);
      const line = changed.get(id);
      if (line !== undefined) return [{ accountId: owner, line: spec.toKept(line) }];
      // Note that a line this window held and lets go goes, and one only another window holds stands.
      return was.has(id) ? [] : [entry];
    });
    const kept = new Set(
      standing.flatMap((entry) => (entry.accountId === owner ? [spec.idOf(entry.line)] : [])),
    );
    const added = next
      .filter((line) => !was.has(idOf(line)) && !kept.has(idOf(line)))
      .map((line) => ({ accountId: owner, line: spec.toKept(line) }));
    writeKept(spec.key, stored, [...standing, ...added]);
    held.setState((lines) => new Map([...lines, ...changed]));
    rereadKept();
  };
  return { store, set };
}

/**
 * Hands what the window holds for an account's address to its id, the
 * drafts' files and every store of held lines alike, once its identity
 * learns the id; nothing where the window was not signed in as the address,
 * since only that window holds anything of it.
 */
function adoptHeld(address: string, accountId: string): void {
  if (ownerStore.state !== address) return;
  changeDrafts(accountId, { adopt: address });
  for (const held of HELD_BESIDE) held.adopt(address, accountId);
}

/**
 * Lets go of everything the window holds of its drafts and the lines beside
 * them, files and waits among it, once what it held unwritten is written: the
 * window's document is ending, so nothing is left to read them, and a window
 * opened after it starts from storage. Note that the window's root going is
 * not that, because a root drawn again in the same document, as a boundary
 * recovering from a throw draws it, finds what the window held where it was.
 */
function forgetWindow(): void {
  for (const wait of storeLaterByOwner.values()) wait.stop();
  storeLaterByOwner.clear();
  for (const owner of draftsByOwner.keys()) changeDrafts(owner, FORGET);
  for (const held of HELD_BESIDE) held.forget();
  ownerStore.setState(() => null);
}

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
  const id = account?.id;
  const email = account?.email;
  useLayoutEffect(() => {
    // What the account signed in until now typed is written as its own before another's are read.
    changeOwned(STORE);
    if (id !== undefined && email !== undefined) {
      adoptDrafts(email, id);
      // Note that what this window holds and storage does not, files and lines not sent, moves too.
      adoptHeld(email, id);
    }
    ownerStore.setState(() => id ?? email ?? null);
    // Note that the account's drafts are read again, because a window that held them before may
    // hold them as they stood then, before a move from its address added to them.
    changeOwned(REREAD);
  }, [id, email]);
  // Another panel's window writing the drafts is read at once, so a box never types over its words.
  useEffect(() => {
    const heard = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) changeOwned(REREAD);
      // Note that lines kept beside the drafts are read from storage again on any other write, which costs a read.
      else rereadKept();
    };
    window.addEventListener("storage", heard);
    return () => window.removeEventListener("storage", heard);
  }, []);
  // Note that what the window holds unwritten is written at once wherever the words could be lost
  // or read elsewhere before the typing rests: the box losing focus, the window losing it, hidden,
  // or closed, a quit's included, and the window's root going. Only the document ending lets go of
  // the rest; a page kept in the back-forward cache has not ended, as it may come back as it stood.
  useEffect(() => {
    const store = () => changeOwned(STORE);
    const hidden = () => {
      if (document.visibilityState === "hidden") store();
    };
    const leaving = (event: PageTransitionEvent) => {
      store();
      if (!event.persisted) forgetWindow();
    };
    window.addEventListener("focusout", store);
    window.addEventListener("blur", store);
    window.addEventListener("pagehide", leaving);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("focusout", store);
      window.removeEventListener("blur", store);
      window.removeEventListener("pagehide", leaving);
      document.removeEventListener("visibilitychange", hidden);
      store();
    };
  }, []);
}

/**
 * The plans a draft waits in, read off every draft, null for an agent with
 * no plan. Note that its readers compare it by its contents, so a row
 * marking a draft draws again only as a draft comes or goes, never on each
 * word typed.
 */
function draftedPlans(drafts: readonly KeptDraft[]): readonly (string | null)[] {
  return drafts.flatMap(({ place }) => ("planId" in place ? [place.planId] : []));
}

/**
 * The started agents a draft waits in, read off every draft, compared by
 * its readers by its contents as `draftedPlans` is, so a tab marking one
 * draws again only as a draft comes or goes.
 */
function draftedAgents(drafts: readonly KeptDraft[]): readonly string[] {
  return drafts.flatMap(({ place }) => (place.kind === DRAFT_PLACE.AGENT ? [place.agentId] : []));
}

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
function useStoreOnLeave(): void {
  useEffect(() => () => changeOwned(STORE), []);
}

/** The draft kept for `place`, empty where none is. */
export function useDraft(place: DraftPlace): DraftControl {
  const draft = useSelector(
    draftsStore,
    (drafts) => drafts.find((kept) => Equal.equals(kept.place, place)) ?? EMPTY_DRAFT,
  );
  useStoreOnLeave();
  return { draft, update: (next) => changeOwned({ place, next }) };
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
  return useSelector(draftsStore, (drafts) => {
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

/** Whether a draft holds a pick: an option, a field, a step, a press, or a resolve staged, which stands on the ask it was staged on as a pick does. */
export function holdsPicks(draft: Pick<Draft, "choices" | "values" | "steps" | "press">): boolean {
  return (
    draft.choices.length > 0 ||
    draft.values.length > 0 ||
    (draft.steps ?? []).length > 0 ||
    draft.press !== undefined
  );
}

/** A draft with its picks let go, its words and files as they were. */
export function withoutPicks<D extends Draft>(draft: D): D {
  return {
    ...draft,
    choices: [],
    values: [],
    steps: undefined,
    press: undefined,
    revision: undefined,
  };
}

/**
 * A draft as a box answering an ask at `revision` reads it, none where no
 * ask stands to be picked on: its picks only where they were made on that
 * revision, and its words and files whatever the revision. Note that it is
 * the draft itself wherever nothing is let go, so a reader comparing drafts
 * by identity draws again only as one changes.
 */
function draftAt<D extends Draft>(draft: D, revision: number | null): D {
  return draft.revision === revision || !holdsPicks(draft) ? draft : withoutPicks(draft);
}

/** An inbox item's draft as its card reads it as the item now stands: its picks only at the item's revision while it is open. */
export function draftOfItem<D extends Draft>(
  draft: D,
  item: Pick<InboxItem, "revision" | "status">,
): D {
  return draftAt(draft, item.status === INBOX_STATUS.OPEN ? item.revision : null);
}

/**
 * Whether an inbox item holds a draft its card reads as it now stands, which
 * its row marks with the pencil (`draft-mark.tsx`). Note that it answers a
 * boolean, so a row draws again only as its draft comes or goes, never on
 * each word typed.
 */
export function useInboxItemDrafted(item: Pick<InboxItem, "id" | "revision" | "status">): boolean {
  return useSelector(draftsStore, (drafts) =>
    drafts.some(
      (kept) => isInbox(kept) && kept.place.itemId === item.id && holds(draftOfItem(kept, item)),
    ),
  );
}

/**
 * What a list of inbox rows reads of an item's draft: the item, its picks
 * and the revision they were made on, and whether it holds words or files,
 * never the words themselves, so a list reading every row's draft draws
 * again as a draft comes or goes or a pick moves, never on each word typed.
 */
export interface InboxRowDraft extends Pick<Draft, "choices" | "values" | "steps" | "press"> {
  readonly itemId: string;
  readonly revision: number | undefined;
  /** Whether it holds words or files, which its row marks with the pencil whatever its picks. */
  readonly words: boolean;
}

/** Every inbox card's draft as its row reads it (`InboxRowDraft`). */
function inboxRowDrafts(drafts: readonly KeptDraft[]): readonly InboxRowDraft[] {
  return drafts.filter(isInbox).map((kept) => ({
    itemId: kept.place.itemId,
    revision: kept.revision,
    words: kept.text !== "" || kept.attachments.length > 0 || (kept.dropped ?? []).length > 0,
    choices: kept.choices,
    values: kept.values,
    steps: kept.steps,
    press: kept.press,
  }));
}

/** No inbox card holds a draft. */
const NO_ROW_DRAFTS: ReadonlyMap<string, InboxRowDraft> = new Map();

/**
 * Every inbox card's draft as a list's rows read it, by item, read once
 * for the whole list rather than by each row. Note that a row's draft is
 * the very one it was until it changes, so a row handed it (`memo`) draws
 * again only as its own draft does.
 */
export function useInboxRowDrafts(): ReadonlyMap<string, InboxRowDraft> {
  const last = useRef(NO_ROW_DRAFTS);
  return useSelector(draftsStore, (all) => {
    const drafts = inboxRowDrafts(all);
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

/** Whether picks made on `revision` stand on an item as it now stands: made on its revision while it is open, or none made at all (`draftOfItem`). */
export function picksStandOn(
  revision: number | undefined,
  picks: boolean,
  item: Pick<InboxItem, "revision" | "status">,
): boolean {
  return !picks || revision === (item.status === INBOX_STATUS.OPEN ? item.revision : null);
}

/** Whether a row's draft's picks stand on its item as it now stands (`picksStandOn`). */
function picksStand(draft: InboxRowDraft, item: Pick<InboxItem, "revision" | "status">): boolean {
  return picksStandOn(draft.revision, holdsPicks(draft), item);
}

/**
 * Where an inbox card's draft stands, as a read letting go of the drafts it
 * no longer holds reads it: its place, the revision its picks were made on,
 * and whether it holds any, never its words.
 */
export interface InboxDraftStanding {
  readonly place: InboxPlace;
  readonly revision: number | undefined;
  readonly picks: boolean;
}

/** Every inbox card's draft as it stands (`InboxDraftStanding`). */
function inboxDraftStandings(drafts: readonly KeptDraft[]): readonly InboxDraftStanding[] {
  return drafts
    .filter(isInbox)
    .map((kept) => ({ place: kept.place, revision: kept.revision, picks: holdsPicks(kept) }));
}

/**
 * Where every inbox card's draft stands, for a read that lets go of those
 * it no longer holds. Note that it moves only as a draft comes or goes or
 * its picks do, so the page holding the read draws nothing for a word typed.
 */
export function useInboxDraftStandings(): readonly InboxDraftStanding[] {
  // Note that it is compared by its contents, so a word typed in a box tells no reader of these.
  return useSelector(draftsStore, inboxDraftStandings, { compare: Equal.equals });
}

/** Whether an item's row marks a draft, as `useInboxItemDrafted` says it of its draft as a list read it (`useInboxRowDrafts`). */
export function rowDrafted(
  draft: InboxRowDraft | undefined,
  item: Pick<InboxItem, "revision" | "status">,
): boolean {
  return draft !== undefined && (draft.words || (picksStand(draft, item) && holdsPicks(draft)));
}

/** A row's draft whose picks its row shows, read of its draft as a list read it; none where its picks were made on the item before it changed. */
export function rowPicks(
  draft: InboxRowDraft | undefined,
  item: Pick<InboxItem, "revision" | "status">,
): InboxRowDraft | undefined {
  return draft === undefined || !picksStand(draft, item) ? undefined : draft;
}

/**
 * The inbox cards' drafts of a plan, or of the agents with none where it is
 * null. Note that the list answered is the very one it was until one of its
 * drafts changes, so the inbox reading it draws again only then, never on a
 * word typed in another box.
 */
export function useInboxDrafts(taskId: string | null): readonly KeptDraft<InboxPlace>[] {
  const last = useRef<readonly KeptDraft<InboxPlace>[]>([]);
  return useSelector(draftsStore, (drafts) => {
    const found = drafts.filter(isInbox).filter((kept) => kept.place.planId === taskId);
    const same =
      found.length === last.current.length && found.every((kept, at) => kept === last.current[at]);
    if (!same) last.current = found;
    return last.current;
  });
}

/** The presses that write any place's draft, or let go of those a predicate names, and a read of the draft the window holds now at the first place one names, for a press that must know what its box held as it was pressed. */
export interface DraftWriter {
  readonly update: (place: DraftPlace, next: (was: Draft) => Draft) => void;
  readonly drop: (drop: (place: DraftPlace) => boolean) => void;
  readonly heldAt: (find: (place: DraftPlace) => boolean) => KeptDraft | undefined;
}

/** The presses that write any place's draft: the same ones for as long as the window stands. */
const DRAFT_WRITER: DraftWriter = {
  update: (place, next) => changeOwned({ place, next }),
  drop: (drop) => changeOwned({ drop }),
  heldAt: (find) => draftsStore.state.find((kept) => find(kept.place)),
};

/** The draft writer, for an owner that reads its drafts on its own, the same one for as long as the window stands. */
export function useDraftWriter(): DraftWriter {
  useStoreOnLeave();
  return DRAFT_WRITER;
}

/** Whether a plan holds a draft: one of its agents', its draft agent's, an inbox card's, or a comment's. */
export function useDescriptionDrafted(taskId: string): boolean {
  return useSelector(draftsStore, (drafts) => draftedPlans(drafts).includes(taskId));
}

/** The started agents whose boxes hold a draft, which their tabs mark with the pencil (`draft-mark.tsx`). */
export function useDraftedAgents(): readonly string[] {
  return useSelector(draftsStore, draftedAgents, { compare: Equal.equals });
}

/**
 * Whether New task holds a draft in a workspace, none before the workspaces
 * are read, which the sidebar's New task row marks with the pencil
 * (`draft-mark.tsx`): the words its card keeps there. Note that it answers
 * a boolean, so the row draws again only as the draft comes or goes, never
 * on each word typed.
 */
export function useNewTaskDrafted(workspaceId: string | undefined): boolean {
  return useSelector(draftsStore, (drafts) =>
    drafts.some(
      ({ place }) =>
        place.kind === DRAFT_PLACE.NEW_TASK && place.workspaceId === (workspaceId ?? null),
    ),
  );
}
