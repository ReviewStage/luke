import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * plan-wire.ts -- a named feature plan and its one saved document, as the Plans tab and the service read them.
 *
 * A plan is its owner's name for it and one current document: a Markdown `body` and an `assumptions` list, each assumption its
 * text (`docs/PLANNING.md`). The
 * document is the whole of what the plan's notetaker writes, through notes
 * the service takes into the plan's fields and formats into the body as the
 * one fixed template (`plan-template.ts`), and it is replaced whole on every
 * save: there is no revision argument and no per-assumption id. The service
 * keeps every save as a revision of the plan under the writer who made it,
 * and a plan carries its newest as `lastEdit`, which is what the window's
 * "Edited by" line reads.
 * A plan may name the GitHub repository it is about, `owner/name` as
 * `github-repositories-wire.ts` spells it, which the service confirms the
 * account reaches through the Luke GitHub App before it keeps it; null is a
 * plan with no repository yet, and every plan from before repositories.
 * A plan may be pinned, which the sidebar lists first, and archived, which
 * the list leaves out unless asked for it (`PLAN_LIST_QUERY`), so a build
 * that knows nothing of archiving never sees an archived plan. Both are the
 * account's, so they follow it to every Mac it signs in on.
 * The owning account and the conversation a plan resumes in are the
 * service's own and never travel here.
 *
 * Every request refuses a key it does not name, as every request frame on
 * this wire does, so a body cannot smuggle an account or a plan id past the
 * bearer and the path that name them. Declared directly with Effect's
 * `Schema.Struct` and exported under its own name.
 */

export const PLAN_BOUNDS = {
  /** The most characters a plan's name may spell. */
  MAX_NAME_CHARS: 200,
  /** A document body past this is not a plan a coding agent can take in one prompt. */
  MAX_BODY_CHARS: 200_000,
  MAX_ASSUMPTIONS: 200,
  MAX_ASSUMPTION_CHARS: 2_000,
} as const;

/** A text settled with its ends trimmed, refused when nothing but whitespace stands, and bounded. */
function trimmedText(maximumChars: number) {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}

export const planAssumptionSchema = EffectSchema.Struct({
  /** The assumption as one plain sentence. */
  text: trimmedText(PLAN_BOUNDS.MAX_ASSUMPTION_CHARS),
});

export type PlanAssumption = typeof planAssumptionSchema.Type;

/** Bounds on a plan's fields; the formatted body is held to `PLAN_BOUNDS.MAX_BODY_CHARS` after formatting. */
export const PLAN_FIELD_BOUNDS = {
  /** One answer may be at most the whole body; the formatted total is what is held to the body bound. */
  MAX_ANSWER_CHARS: PLAN_BOUNDS.MAX_BODY_CHARS,
  /** A rule's statement is its heading, so it is one sentence. */
  MAX_RULE_CHARS: 500,
  /** One part of an example is a clause drawn on one line. */
  MAX_EXAMPLE_PART_CHARS: 1_000,
  /** The most rules, examples of one rule, or open questions. */
  MAX_ITEMS: 200,
} as const;

/** A list that is present only once it holds something. */
function nonEmptyList<S extends EffectSchema.Top>(item: S) {
  return EffectSchema.Array(item).check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(PLAN_FIELD_BOUNDS.MAX_ITEMS),
  );
}

/** An ordinary answer: null while unanswered, otherwise nonblank text. */
const ANSWER = EffectSchema.NullOr(trimmedText(PLAN_FIELD_BOUNDS.MAX_ANSWER_CHARS));

/** One clause of a rule's example, null while unknown. */
export const planExamplePartSchema = EffectSchema.NullOr(
  trimmedText(PLAN_FIELD_BOUNDS.MAX_EXAMPLE_PART_CHARS),
);

const exampleSchema = EffectSchema.Struct({
  given: planExamplePartSchema,
  when: planExamplePartSchema,
  // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
  then: planExamplePartSchema, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
});

const ruleSchema = EffectSchema.Struct({
  statement: trimmedText(PLAN_FIELD_BOUNDS.MAX_RULE_CHARS),
  examples: EffectSchema.NullOr(nonEmptyList(exampleSchema)),
});

/**
 * Every section and field of the fixed template, in its order: what the
 * service keeps for a plan, and what the window edits a field of
 * (`plan-template.ts` formats them into the body).
 */
export const planFieldsSchema = EffectSchema.Struct({
  goal: EffectSchema.Struct({ problem: ANSWER, outcome: ANSWER }),
  scope: EffectSchema.Struct({ included: ANSWER, excluded: ANSWER, constraints: ANSWER }),
  rules: EffectSchema.NullOr(nonEmptyList(ruleSchema)),
  implementation: EffectSchema.Struct({
    changeMap: ANSWER,
    contracts: ANSWER,
    patterns: ANSWER,
    order: ANSWER,
  }),
  decisions: ANSWER,
  verification: ANSWER,
  leftToAgent: ANSWER,
  openQuestions: EffectSchema.Array(trimmedText(PLAN_FIELD_BOUNDS.MAX_ANSWER_CHARS)).check(
    EffectSchema.isMaxLength(PLAN_FIELD_BOUNDS.MAX_ITEMS),
  ),
  dataAndMigration: ANSWER,
});

export type PlanFields = typeof planFieldsSchema.Type;

/** Every field a note may be taken under, in the template's order: the fields above, then the assumptions. */
export const PLAN_FIELD = {
  PROBLEM: "problem",
  OUTCOME: "outcome",
  INCLUDED: "included",
  EXCLUDED: "excluded",
  CONSTRAINTS: "constraints",
  RULES: "rules",
  CHANGE_MAP: "changeMap",
  CONTRACTS: "contracts",
  PATTERNS: "patterns",
  ORDER: "order",
  DECISIONS: "decisions",
  VERIFICATION: "verification",
  LEFT_TO_AGENT: "leftToAgent",
  OPEN_QUESTIONS: "openQuestions",
  DATA_AND_MIGRATION: "dataAndMigration",
  ASSUMPTIONS: "assumptions",
} as const;

export type PlanField = (typeof PLAN_FIELD)[keyof typeof PLAN_FIELD];
export type PlanRule = typeof ruleSchema.Type;
export type PlanExample = typeof exampleSchema.Type;

/** The one saved document of a plan, replaced whole by every save. */
export const planDocumentSchema = EffectSchema.Struct({
  /** The fixed template's canonical Markdown, stored exactly as formatted. */
  body: EffectSchema.String.check(EffectSchema.isMaxLength(PLAN_BOUNDS.MAX_BODY_CHARS)),
  assumptions: EffectSchema.Array(planAssumptionSchema).check(
    EffectSchema.isMaxLength(PLAN_BOUNDS.MAX_ASSUMPTIONS),
  ),
});

export type PlanDocument = typeof planDocumentSchema.Type;

/** A plan's repository as a request names it: a full name, or null for none. */
const repositoryChoiceSchema = EffectSchema.NullOr(githubRepositoryFullNameSchema);

/**
 * Starting a plan (POST): its name, and the repository it is about where one
 * is chosen; the document starts as the untouched template.
 */
export const planCreateRequestSchema = EffectSchema.Struct({
  name: trimmedText(PLAN_BOUNDS.MAX_NAME_CHARS),
  repository: EffectSchema.optionalKey(repositoryChoiceSchema),
});

export type PlanCreateRequest = typeof planCreateRequestSchema.Type;

/** Renaming a plan (PATCH): its new name, under the same rules as the name it started with. */
export const planRenameRequestSchema = EffectSchema.Struct({
  name: trimmedText(PLAN_BOUNDS.MAX_NAME_CHARS),
});

export type PlanRenameRequest = typeof planRenameRequestSchema.Type;

/** Whether an update names anything to change: one that names nothing is refused rather than answered unchanged. */
function updateNamesAChange(update: {
  name?: string;
  repository?: string | null;
  pinned?: boolean;
  archived?: boolean;
}): boolean {
  return Object.keys(update).length > 0;
}

/**
 * Changing a plan (PATCH): its name, its repository, whether it is pinned,
 * whether it is archived, or any of them at once. A rename is one of these;
 * a repository is confirmed reachable by the account before it is kept, and
 * null clears it.
 */
export const planUpdateRequestSchema = EffectSchema.Struct({
  name: EffectSchema.optionalKey(trimmedText(PLAN_BOUNDS.MAX_NAME_CHARS)),
  repository: EffectSchema.optionalKey(repositoryChoiceSchema),
  pinned: EffectSchema.optionalKey(EffectSchema.Boolean),
  archived: EffectSchema.optionalKey(EffectSchema.Boolean),
}).check(EffectSchema.makeFilter(updateNamesAChange));

export type PlanUpdateRequest = typeof planUpdateRequestSchema.Type;

/**
 * A repository the account pinned in the sidebar, and the instant it was
 * pinned: a pinned repository's group of plans stands above the others,
 * newest pinned first. A pin is the account's, so it follows it to every
 * Mac it signs in on, as a plan's pin does, and it names the repository and
 * nothing more, so pinning one asks GitHub nothing.
 */
export const repositoryPinSchema = EffectSchema.Struct({
  repository: githubRepositoryFullNameSchema,
  pinnedAt: countedNumber,
});

export type RepositoryPin = typeof repositoryPinSchema.Type;

export const REPOSITORY_PIN_BOUNDS = {
  /** The most repositories one account may hold pinned; a pin past it is refused, and nothing is written. */
  MAX_PINS: 50,
} as const;

/** The account's pinned repositories, newest pinned first (GET, and every PUT's answer). */
export const repositoryPinsAnswerSchema = EffectSchema.Struct({
  pins: EffectSchema.Array(repositoryPinSchema),
});

/** Pinning a repository, or unpinning it (PUT): asking twice for either moves nothing, and a pin keeps the instant it was first made. */
export const repositoryPinRequestSchema = EffectSchema.Struct({
  repository: githubRepositoryFullNameSchema,
  pinned: EffectSchema.Boolean,
});

/**
 * The plan list's query (GET): `archived=include` lists the archived plans
 * among the rest, each carrying its `archivedAt`. Without it they are left
 * out, which is what a build from before archiving asks.
 */
export const PLAN_LIST_QUERY = {
  ARCHIVED: "archived",
} as const;

/** What the list's `archived` query may say. */
export const PLAN_LIST_ARCHIVED = {
  INCLUDE: "include",
} as const;

const planSummaryFields = {
  id: wireUuidSchema,
  name: trimmedText(PLAN_BOUNDS.MAX_NAME_CHARS),
  /** Epoch milliseconds the plan was started. */
  createdAt: countedNumber,
  /** Epoch milliseconds the document was last saved; the start, before any save. */
  updatedAt: countedNumber,
  /** The GitHub repository the plan is about, `owner/name`; null before one is chosen. */
  repository: repositoryChoiceSchema,
  /**
   * The start again, answered only for a desktop through v0.7.1, which
   * refuses a summary without it; the list once ordered by the last open.
   * Optional here so no later build needs it, and nothing reads it. It goes
   * once a release that decodes it as optional has shipped and v0.7.1 is no
   * longer supported.
   */
  openedAt: EffectSchema.optionalKey(countedNumber),
  /** Epoch milliseconds the plan was pinned; absent while it is not, and from a service before pinning. */
  pinnedAt: EffectSchema.optionalKey(countedNumber),
  /** Epoch milliseconds the plan was archived; absent while it is not, and from a service before archiving. */
  archivedAt: EffectSchema.optionalKey(countedNumber),
};

/** One row of the plan list: everything but the document. */
export const planSummarySchema = EffectSchema.Struct(planSummaryFields);

export type PlanSummary = typeof planSummarySchema.Type;

/** The most saves by coding agents a plan answers, newest last; the same bound the service keeps. */
const MAX_AGENT_EDITS = 50;

/** One save a coding agent made on the plan, as the window reads it: the agent, how it is named now, and when. */
export const agentEditLineSchema = EffectSchema.Struct({
  agentId: wireUuidSchema,
  /** The agent as its row names it now: its title where it has one, else its model. */
  label: trimmedText(PLAN_BOUNDS.MAX_NAME_CHARS),
  /** Epoch milliseconds of the save. */
  at: countedNumber,
});

/**
 * Who wrote a revision of a plan: the developer, the notetaker on a call
 * (whom the developer knows as Luke), a coding agent, or, for the one
 * revision a plan from before history starts with, nobody the service can
 * name.
 */
export const PLAN_ACTOR = {
  DEVELOPER: "developer",
  NOTETAKER: "notetaker",
  AGENT: "agent",
  EARLIER: "earlier",
} as const;

export type PlanActor = (typeof PLAN_ACTOR)[keyof typeof PLAN_ACTOR];

/** The newest revision of a plan, as its "Edited by" line reads it. */
export const planLastEditSchema = EffectSchema.Struct({
  actor: EffectSchema.Literals(Object.values(PLAN_ACTOR)),
  /** The coding agent as its row names it now; present only where a coding agent wrote it. */
  label: EffectSchema.optionalKey(trimmedText(PLAN_BOUNDS.MAX_NAME_CHARS)),
  /** Epoch milliseconds of the revision's latest save. */
  at: countedNumber,
  /** Whether the revision was written on one of the plan's calls. */
  duringCall: EffectSchema.Boolean,
});

export type PlanLastEdit = typeof planLastEditSchema.Type;

/** The save that last changed one field of a plan, as the section's "Edited by" line reads it. */
export const planFieldEditSchema = EffectSchema.Struct({
  field: EffectSchema.Literals(Object.values(PLAN_FIELD)),
  ...planLastEditSchema.fields,
});

export type PlanFieldEdit = typeof planFieldEditSchema.Type;

/** One plan with its saved document, its newest revision, who last changed each field, and the saves coding agents made on it, oldest first. */
export const planSchema = EffectSchema.Struct({
  ...planSummaryFields,
  document: planDocumentSchema,
  /** Optional on the wire so a plan from a service without the journal still reads; none is no edits. */
  agentEdits: EffectSchema.optionalKey(
    EffectSchema.Array(agentEditLineSchema).check(EffectSchema.isMaxLength(MAX_AGENT_EDITS)),
  ),
  /** Absent for a plan nobody has written since history began, and from a service before it. */
  lastEdit: EffectSchema.optionalKey(planLastEditSchema),
  /** The fields the body was formatted from, which the window edits a field of; absent from a service before editing. */
  fields: EffectSchema.optionalKey(planFieldsSchema),
  /**
   * The save that last changed each field, for the fields a save has changed
   * since the service began keeping it; absent from a service before it.
   */
  fieldEdits: EffectSchema.optionalKey(
    EffectSchema.Array(planFieldEditSchema).check(
      EffectSchema.isMaxLength(Object.values(PLAN_FIELD).length),
    ),
  ),
});

export type Plan = typeof planSchema.Type;

/** The plan list (GET): every plan the account owns, newest started first, the archived ones only where the query asks for them. */
export const planListAnswerSchema = EffectSchema.Struct({
  plans: EffectSchema.Array(planSummarySchema),
});

/** A started, opened, or changed plan (POST, GET, PATCH), with its document as saved. */
export const planAnswerSchema = EffectSchema.Struct({ plan: planSchema });

/** A deleted plan (DELETE): its row, its document, and its association are gone. */
export const planDeleteAnswerSchema = EffectSchema.Struct({ deleted: EffectSchema.Literal(true) });

/** How a plan's history is read: the newest revisions first, a page at a time. */
export const PLAN_HISTORY_BOUNDS = {
  /** The most revisions one read of the history carries. */
  PAGE: 50,
} as const;

/** A revision's number within its plan, from one. */
export const planRevisionSeqSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1));

/**
 * One revision as the History tab lists it: its number, who wrote it and
 * when it last moved, when it began, how many changes its saves made, and,
 * for the developer's restore of an earlier revision, which one it brought
 * back and that revision's latest save.
 */
export const planRevisionLineSchema = EffectSchema.Struct({
  seq: planRevisionSeqSchema,
  lastEdit: planLastEditSchema,
  /** Epoch milliseconds of the revision's first save. */
  startedAt: countedNumber,
  changes: countedNumber,
  restoredFrom: EffectSchema.optionalKey(
    EffectSchema.Struct({ seq: planRevisionSeqSchema, at: countedNumber }),
  ),
});

export type PlanRevisionLine = typeof planRevisionLineSchema.Type;

/**
 * A page of a plan's history (GET `/api/plans/{id}/revisions`), the newest
 * first, before the revision the `before` query names where it names one;
 * `earlier` is what the next older page is read before, absent on the oldest.
 */
export const planRevisionsAnswerSchema = EffectSchema.Struct({
  revisions: EffectSchema.Array(planRevisionLineSchema).check(
    EffectSchema.isMaxLength(PLAN_HISTORY_BOUNDS.PAGE),
  ),
  earlier: EffectSchema.optionalKey(planRevisionSeqSchema),
});

export type PlanRevisionsAnswer = typeof planRevisionsAnswerSchema.Type;

/**
 * One revision's content (GET `/api/plans/{id}/revisions/{seq}`): the plan
 * as it stood after the revision and as it stood before it, null for the
 * first, each formatted under the plan's name as it stands now, so a rename
 * since is no difference between them.
 */
export const planRevisionAnswerSchema = EffectSchema.Struct({
  revision: EffectSchema.Struct({
    seq: planRevisionSeqSchema,
    document: planDocumentSchema,
    previous: EffectSchema.NullOr(planDocumentSchema),
  }),
});

export type PlanRevisionAnswer = typeof planRevisionAnswerSchema.Type;

/** The most lines one code reference points at; a reference is a passage, not a file. */
const CODE_REF_MAX_LINES = 200;

/** The most characters of a path one code reference names: macOS's own bound. */
export const CODE_PATH_MAX_CHARS = 1_024;

const codeLineSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1));

/** Whether a reference names both of its lines or neither, in order and within the bound. */
function codeRangeIsReadable(ref: { startLine?: number; endLine?: number }): boolean {
  if (ref.startLine === undefined || ref.endLine === undefined) {
    return ref.startLine === ref.endLine;
  }
  return ref.endLine >= ref.startLine && ref.endLine - ref.startLine < CODE_REF_MAX_LINES;
}

/**
 * A place in the plan's repository: a file, named relative to the checkout
 * root, and the lines pointed at, or the file whole with none. Luke names one
 * through the planning model's `show_code`.
 */
export const codeRefSchema = EffectSchema.Struct({
  path: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS),
  ),
  startLine: EffectSchema.optionalKey(codeLineSchema),
  endLine: EffectSchema.optionalKey(codeLineSchema),
}).check(EffectSchema.makeFilter(codeRangeIsReadable));

export type CodeRef = typeof codeRefSchema.Type;

export const SHOWN_CODE_BOUNDS = {
  /** The most lines one showing carries: the lines pointed at, with the file around them. */
  WINDOW_LINES: 200,
  /** The most characters of one line that travel; a longer line is cut there. */
  MAX_LINE_CHARS: 400,
  /** The most characters of the note Luke writes beside the lines: a sentence or two. */
  NOTE_CHARS: 280,
} as const;

/** What Luke says the lines are for, in a sentence or two of his own words, for the developer reading them. */
export const codeNoteSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(SHOWN_CODE_BOUNDS.NOTE_CHARS),
);

/**
 * Code on screen during a planning call, with its lines: the place named,
 * the repository the service read it from, the window of the file it
 * holds around the lines pointed at, and Luke's note on why he showed it,
 * which code shown before notes were asked for does not carry. The service reads the lines from the
 * planning session's checkout of the repository as `show_code` runs, and
 * they travel in the call's own journal and on the `plan.code` frame; the Mac
 * reads nothing of its own.
 */
export const shownCodeSchema = EffectSchema.Struct({
  ref: codeRefSchema,
  /** The repository the lines were read from, `owner/name`. */
  repository: githubRepositoryFullNameSchema,
  /** The file's line the first carried line is. */
  firstLine: codeLineSchema,
  /** How many lines the whole file has. */
  lineCount: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
  lines: EffectSchema.Array(
    EffectSchema.String.check(EffectSchema.isMaxLength(SHOWN_CODE_BOUNDS.MAX_LINE_CHARS)),
  ).check(EffectSchema.isMaxLength(SHOWN_CODE_BOUNDS.WINDOW_LINES)),
  note: EffectSchema.optionalKey(codeNoteSchema),
});

export type ShownCode = typeof shownCodeSchema.Type;

/** One window of a file: its first and last line, both counted from one. */
export interface CodeWindow {
  readonly first: number;
  readonly last: number;
}

/**
 * The window of a file of `lineCount` lines the screen holds for `ref`: the
 * lines pointed at centred where the file allows, and the file's head for a
 * reference with none.
 */
export function codeWindow(ref: CodeRef, lineCount: number): CodeWindow {
  const { WINDOW_LINES } = SHOWN_CODE_BOUNDS;
  const latest = Math.max(1, lineCount - WINDOW_LINES + 1);
  if (ref.startLine === undefined || ref.endLine === undefined) {
    return { first: 1, last: Math.min(lineCount, WINDOW_LINES) };
  }
  const pointed = ref.endLine - ref.startLine + 1;
  const margin = Math.max(0, Math.floor((WINDOW_LINES - pointed) / 2));
  const first = Math.min(Math.max(1, ref.startLine - margin), latest);
  return { first, last: Math.min(lineCount, first + WINDOW_LINES - 1) };
}

export const PLAN_FILE_BOUNDS = {
  /** The most lines one read of a file for the File tab carries; a longer file is read a window at a time as it is scrolled. */
  WINDOW_LINES: 500,
} as const;

/**
 * Why a file of the plan's repository was not read for the File tab: a
 * secret file, no regular file at the path, a file too large or not text,
 * a plan with no repository, a repository the Luke GitHub App does not
 * reach for the account, an account that must sign in with GitHub again,
 * or GitHub not answering just now.
 */
export const PLAN_FILE_REFUSAL = {
  SECRET: "secret",
  MISSING: "missing",
  NOT_TEXT: "not-text",
  NO_REPOSITORY: "no-repository",
  NOT_REACHABLE: "not-reachable",
  SIGN_IN_REQUIRED: "sign-in-required",
  UNAVAILABLE: "unavailable",
} as const;

export type PlanFileRefusal = (typeof PLAN_FILE_REFUSAL)[keyof typeof PLAN_FILE_REFUSAL];

/** Whether a window names its lines in order and within the bound. */
function fileWindowIsReadable(window: { firstLine: number; lastLine: number }): boolean {
  return (
    window.lastLine >= window.firstLine &&
    window.lastLine - window.firstLine < PLAN_FILE_BOUNDS.WINDOW_LINES
  );
}

/** One window of a file of the plan's repository, as the File tab asks it (GET `/api/plans/{id}/file`): the path, and its first and last line. */
export const planFileRequestSchema = EffectSchema.Struct({
  path: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(CODE_PATH_MAX_CHARS),
  ),
  firstLine: codeLineSchema,
  lastLine: codeLineSchema,
}).check(EffectSchema.makeFilter(fileWindowIsReadable));

export type PlanFileRequest = typeof planFileRequestSchema.Type;

/**
 * A window of a file of the plan's repository as it stands now on its
 * default branch, read through the Luke GitHub App: the path, the
 * repository, the line the first carried line is, how many lines the whole
 * file has, and the lines, each cut as `show_code` cuts it. A window past
 * the file's end carries no lines.
 */
export const planFileWindowSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  repository: githubRepositoryFullNameSchema,
  firstLine: codeLineSchema,
  lineCount: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
  lines: EffectSchema.Array(
    EffectSchema.String.check(EffectSchema.isMaxLength(SHOWN_CODE_BOUNDS.MAX_LINE_CHARS)),
  ).check(EffectSchema.isMaxLength(PLAN_FILE_BOUNDS.WINDOW_LINES)),
});

export type PlanFileWindow = typeof planFileWindowSchema.Type;

/**
 * Why the File tab's file is not shown, and, where GitHub found nothing at
 * the path, the branch it was read on: the snippet came from the planning
 * session's checkout, which may hold a file that branch does not.
 */
export const planFileRefusalSchema = EffectSchema.Struct({
  refusal: EffectSchema.Literals(Object.values(PLAN_FILE_REFUSAL)),
  branch: EffectSchema.optionalKey(EffectSchema.String),
});

/** The File tab's read answered: the window, or why the file is not shown. */
export const planFileAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ file: planFileWindowSchema }),
  planFileRefusalSchema,
]);

export type PlanFileAnswer = typeof planFileAnswerSchema.Type;
