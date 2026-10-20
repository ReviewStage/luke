import {
  CHAPTERS_MODEL_LIST,
  type ChaptersModelId,
  chaptersModelFrom,
} from "@luke/features/chapters-model-choice";
import { CONTEXT_WINDOW, contextWindowSchema } from "@luke/features/coding-agent-wire";
import { LINK_OPEN_LIST, type LinkOpen } from "@luke/features/link-open";
import type { ModelChoice } from "@luke/features/models-wire";
import { CODING_AGENT_DEFAULT_CHOICE } from "@luke/features/models-wire";
import {
  type AccountPreferences,
  accountPreferencesFromStored,
  EXPERIMENT,
  type Experiment,
  type ExperimentChoices,
  experimentChoicesFrom,
  experimentOn,
  NO_EXPERIMENTS,
} from "@luke/settings";
import { WireValueSchema } from "@luke/wire";
import { eq, sql } from "drizzle-orm";
import { type Cause, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { user } from "../schemas/auth.js";
import { accountPreference } from "../schemas/preferences.js";
import { conversations } from "../schemas/storage.js";
import { InstantColumnSchema } from "./columns.js";
import { readTemplateRevisionContent, recordTemplateRevision } from "./plan-template-revisions.js";
import { queueSessionSandboxes, sessionsOf } from "./session-sandbox-cleanup.js";

/**
 * What the account group reads and writes of an account: the erasure, the
 * cross-device snapshot behind `/api/account/preferences`, which is the
 * settings preferences, the coding agents' default model, effort, and
 * context window, the model the account's Generate chapters runs on, and
 * the experiments the account turned on, and the plan template behind
 * `/api/account/plan-template`, a column of the same row that neither path
 * reads of the other, whose every change is kept as a revision
 * (`plan-template-revisions.ts`). Every function here is an effect over the ambient `SqlClient`
 * and names no database of its own; `account-seams.ts` beside it runs them
 * at the web edge and is the only file of the two that reaches the auth
 * session.
 */

type AccountSeamFailure = QueryError | Schema.SchemaError;

/** One account's stored snapshot: the preferences every device shares, the coding agents' default, and when the preferences were last written. */
export interface AccountPreferencesRow {
  /** The settings every device shares, the link choice among them where the account made one. */
  preferences: AccountPreferences;
  /** What a click on Start runs on; the catalog's default until the account chooses. */
  codingAgent: ModelChoice;
  /** What a Generate chapters the account presses runs on; Haiku until the account chooses, and for a stored value no build lists any more. */
  chaptersModel: ChaptersModelId;
  /** Each experiment the account turned on or back off; one it never chose is absent, and off. */
  experiments: ExperimentChoices;
  /**
   * When the preferences part was last written; none on a row only a
   * coding-agent choice or a plan template opened. The desktop reads its presence as a snapshot
   * to apply over its own settings, so it stands for the preferences alone.
   */
  updatedAt: Date | undefined;
}

/**
 * What a write carries: each part present replaces what stood, and a part
 * left out stands as it was, so the desktop's settings sync and the Start
 * menu's choice each write their own part without reading the other first.
 * The experiments part is the one patch: its keys are merged over what
 * stood, so a Mac that knows fewer experiments never erases another's.
 * `preferences` is the shared part, whose `voice` it replaces; the link
 * choice is a part of its own, which a build that predates it never sends.
 */
export interface AccountPreferencesWrite {
  preferences?: AccountPreferences;
  linkOpen?: LinkOpen;
  codingAgent?: ModelChoice;
  chaptersModel?: ChaptersModelId;
  experiments?: ExperimentChoices;
}

/** What an account seam answers: an effect over the ambient client, composed into the request that made it. */
export type AccountSeamEffect<A> = Effect.Effect<A, AccountSeamFailure, DatabaseServices>;

/**
 * The account's erasure is the one delete, and the row's own foreign keys are
 * what carry it: every table naming a user declares `on delete cascade`, so
 * the dependent rows go with the row that names them, in one statement and
 * therefore as one unit. Nothing here enumerates the dependents, because a
 * list here could fall behind a table added later and leave a row standing
 * after the account it belongs to is gone. A workspace the account owns,
 * the first one made for it included, names the account only through its
 * member row, so it stands, and only that row goes with the account.
 */
const deleteUserRow = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) => Database.use((db) => db.delete(user).where(eq(user.id, userId))),
});

const lockUserRow = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) =>
    Database.use((db) =>
      db.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update"),
    ),
});

const findAccountSessions = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ runtimeSessionId: Schema.NullOr(Schema.String) }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ runtimeSessionId: conversations.runtimeSessionId })
        .from(conversations)
        .where(eq(conversations.userId, userId))
        .for("update"),
    ),
});

/**
 * Erases the user row; every dependent row cascades with it. The eve session
 * each of the account's conversations ran in, a deleted task's too, is
 * queued for its sandbox's deletion in the same transaction, since nothing
 * after it names them. The user's row is locked first, so a conversation
 * opened meanwhile waits on it and finds no account, and every conversation
 * of the account is locked as its session is read, so a session claimed
 * meanwhile waits and finds no row to claim, rather than landing unqueued.
 */
export function deleteAccount(
  userId: string,
): Effect.Effect<void, AccountSeamFailure, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* lockUserRow(userId);
        yield* queueSessionSandboxes(sessionsOf(yield* findAccountSessions(userId)));
        yield* deleteUserRow(userId);
      }),
    ),
  );
}

/** The columns every read and the write's `returning` project, so a row decodes one way whatever wrote it. */
const PREFERENCE_COLUMNS = {
  voice: accountPreference.voice,
  linkOpen: accountPreference.linkOpen,
  codingAgentModel: accountPreference.codingAgentModel,
  codingAgentEffort: accountPreference.codingAgentEffort,
  codingAgentContextWindow: accountPreference.codingAgentContextWindow,
  chaptersModel: accountPreference.chaptersModel,
  experiments: accountPreference.experiments,
  updatedAt: accountPreference.updatedAt,
};

const PreferenceRowSchema = Schema.Struct({
  voice: Schema.NullOr(Schema.String),
  linkOpen: Schema.NullOr(Schema.String),
  codingAgentModel: Schema.NullOr(Schema.String),
  codingAgentEffort: Schema.NullOr(Schema.String),
  codingAgentContextWindow: Schema.NullOr(contextWindowSchema),
  chaptersModel: Schema.NullOr(Schema.String),
  experiments: Schema.NullOr(WireValueSchema),
  updatedAt: Schema.NullOr(InstantColumnSchema),
});

type PreferenceRow = typeof PreferenceRowSchema.Type;

/**
 * The row as the group answers it. A coding-agent default stands only with
 * both halves written; one half alone is no choice the catalog could have
 * accepted, so it reads as the default beside a whole one. The context
 * window is named only where it is the standard one, as the wire names it.
 */
function snapshotOf(row: PreferenceRow): AccountPreferencesRow {
  const standard = row.codingAgentContextWindow === CONTEXT_WINDOW.STANDARD;
  const codingAgent: ModelChoice =
    row.codingAgentModel !== null && row.codingAgentEffort !== null
      ? {
          model: row.codingAgentModel,
          effort: row.codingAgentEffort,
          ...(standard ? { contextWindow: CONTEXT_WINDOW.STANDARD } : undefined),
        }
      : CODING_AGENT_DEFAULT_CHOICE;
  return {
    preferences:
      accountPreferencesFromStored({
        ...(row.voice ? { voice: row.voice } : undefined),
        ...(row.linkOpen ? { linkOpen: row.linkOpen } : undefined),
      }) ?? {},
    codingAgent,
    // Note that a stored model no build lists any more reads as Haiku, as a row never written does.
    chaptersModel: chaptersModelFrom(row.chaptersModel),
    // Note that a stored key no build lists any more reads as nothing, because the experiment it named graduated or went.
    experiments: experimentChoicesFrom(row.experiments ?? undefined) ?? NO_EXPERIMENTS,
    updatedAt: row.updatedAt ?? undefined,
  };
}

const findPreference = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: PreferenceRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(PREFERENCE_COLUMNS)
        .from(accountPreference)
        .where(eq(accountPreference.userId, userId))
        .limit(1),
    ),
});

/** One account's stored snapshot, or nothing for an account that has stored none. */
export function readAccountPreferences(
  userId: string,
): Effect.Effect<AccountPreferencesRow | undefined, AccountSeamFailure, DatabaseServices> {
  return Effect.map(
    findPreference(userId),
    Option.match({ onNone: () => undefined, onSome: snapshotOf }),
  );
}

/**
 * Whether the account has turned the experiment on: what a server-side gate
 * asks before it offers an experimental feature to the account. An account
 * that stored no snapshot, or never chose the experiment, reads as off.
 */
export function accountExperimentOn(
  userId: string,
  experiment: Experiment,
): Effect.Effect<boolean, AccountSeamFailure, DatabaseServices> {
  return Effect.map(
    readAccountPreferences(userId),
    (row) => row !== undefined && experimentOn(row.experiments, experiment),
  );
}

/**
 * Whether Chat is on for the account: the one read every server-side gate of
 * Chat asks, for the account that owns the agent or the plan, before it
 * offers a chat tool, reads the chat into a turn, wakes Luke, or answers a
 * chat route. Off unless the account turned the experiment on.
 */
export function chatEnabledFor(
  userId: string,
): Effect.Effect<boolean, AccountSeamFailure, DatabaseServices> {
  return accountExperimentOn(userId, EXPERIMENT.CHAT);
}

const PreferenceWriteSchema = Schema.Struct({
  userId: Schema.String,
  voice: Schema.optionalKey(Schema.NullOr(Schema.String)),
  linkOpen: Schema.optionalKey(Schema.Literals(LINK_OPEN_LIST)),
  codingAgent: Schema.optionalKey(
    Schema.Struct({
      model: Schema.String,
      effort: Schema.String,
      contextWindow: Schema.optionalKey(contextWindowSchema),
    }),
  ),
  chaptersModel: Schema.optionalKey(Schema.Literals(CHAPTERS_MODEL_LIST)),
  experiments: Schema.optionalKey(Schema.Record(Schema.String, Schema.Boolean)),
  updatedAt: Schema.Date,
});

type PreferenceWrite = typeof PreferenceWriteSchema.Type;

/** The columns a write replaces: each part the write carries, the instant with the shared preferences part alone. */
function writtenColumns(write: PreferenceWrite) {
  return {
    ...(write.experiments === undefined ? undefined : { experiments: write.experiments }),
    ...(write.linkOpen === undefined ? undefined : { linkOpen: write.linkOpen }),
    ...(write.chaptersModel === undefined ? undefined : { chaptersModel: write.chaptersModel }),
    ...(write.voice === undefined ? undefined : { voice: write.voice, updatedAt: write.updatedAt }),
    ...(write.codingAgent === undefined
      ? undefined
      : {
          codingAgentModel: write.codingAgent.model,
          codingAgentEffort: write.codingAgent.effort,
          codingAgentContextWindow: write.codingAgent.contextWindow ?? null,
        }),
  };
}

/**
 * Note that the conflicting update sets the values the insert carried rather
 * than reading them back out of `excluded`, because a single-row insert's
 * `excluded` row is exactly those values; a part the write leaves out is
 * not among them, so the column it stands in keeps what it held.
 */
const upsertPreference = SqlSchema.findOne({
  Request: PreferenceWriteSchema,
  Result: PreferenceRowSchema,
  execute: (write) => {
    const columns = writtenColumns(write);
    // The experiments are the one part merged rather than replaced: the patch's keys over what stood.
    const merged =
      write.experiments === undefined
        ? columns
        : {
            ...columns,
            experiments: sql`coalesce(${accountPreference.experiments}, '{}'::jsonb) || ${JSON.stringify(write.experiments)}::jsonb`,
          };
    return Database.use((db) =>
      db
        .insert(accountPreference)
        .values({ userId: write.userId, ...columns })
        .onConflictDoUpdate({ target: accountPreference.userId, set: merged })
        .returning(PREFERENCE_COLUMNS),
    );
  },
});

/**
 * Writes each part the write carries over what stood — the preferences
 * whole, the coding-agent default whole, the chapters model, the experiments key by key — and answers the snapshot as it
 * now stands. The instant moves with the shared preferences part alone,
 * so a coding-agent choice, a chapters model, or a link choice never reads to a Mac as a
 * settings snapshot it has to take.
 */
export function writeAccountPreferences(
  userId: string,
  write: AccountPreferencesWrite,
): Effect.Effect<AccountPreferencesRow, AccountSeamFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const updatedAt = yield* DateTime.nowAsDate;
    const stored: PreferenceWrite = {
      userId,
      updatedAt,
      ...(write.preferences === undefined ? undefined : { voice: write.preferences.voice ?? null }),
      ...(write.linkOpen === undefined ? undefined : { linkOpen: write.linkOpen }),
      ...(write.codingAgent === undefined ? undefined : { codingAgent: write.codingAgent }),
      ...(write.chaptersModel === undefined ? undefined : { chaptersModel: write.chaptersModel }),
      ...(write.experiments === undefined ? undefined : { experiments: write.experiments }),
    };
    const row = yield* upsertPreference(stored).pipe(
      // An upsert that returned no row is the database breaking its own contract, not an outcome.
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    return snapshotOf(row);
  });
}

/* ----- The plan template ----- */

/** The template column alone, so a read of it reaches nothing of the preferences beside it. */
const PLAN_TEMPLATE_COLUMNS = { planTemplate: accountPreference.planTemplate };

const PlanTemplateRowSchema = Schema.Struct({ planTemplate: Schema.NullOr(Schema.String) });

const findPlanTemplate = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: PlanTemplateRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(PLAN_TEMPLATE_COLUMNS)
        .from(accountPreference)
        .where(eq(accountPreference.userId, userId))
        .limit(1),
    ),
});

/** The account's own template, or null where it holds the default: no row, or a reset. */
export function readPlanTemplate(
  userId: string,
): Effect.Effect<string | null, AccountSeamFailure, DatabaseServices> {
  return Effect.map(
    findPlanTemplate(userId),
    Option.match({ onNone: () => null, onSome: (row) => row.planTemplate }),
  );
}

const PlanTemplateWriteSchema = Schema.Struct({
  userId: Schema.String,
  planTemplate: Schema.NullOr(Schema.String),
});

/** Opens the account's preference row where it has none, so the template's write has a row to lock. */
const openPreferenceRow = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) =>
    Database.use((db) => db.insert(accountPreference).values({ userId }).onConflictDoNothing()),
});

/** The template the account holds, its row locked until the transaction ends. */
const lockPlanTemplate = SqlSchema.findOne({
  Request: Schema.String,
  Result: PlanTemplateRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(PLAN_TEMPLATE_COLUMNS)
        .from(accountPreference)
        .where(eq(accountPreference.userId, userId))
        .for("update"),
    ),
});

/**
 * Note that the write sets the template column and nothing else, not even
 * `updated_at`, because that instant tells a Mac the preferences part was
 * written and a template is no part of it. A row the template opens holds
 * no preferences, so it answers none.
 */
const updatePlanTemplate = SqlSchema.findOne({
  Request: PlanTemplateWriteSchema,
  Result: PlanTemplateRowSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountPreference)
        .set({ planTemplate: write.planTemplate })
        .where(eq(accountPreference.userId, write.userId))
        .returning(PLAN_TEMPLATE_COLUMNS),
    ),
});

/**
 * Runs `body` on the template the account holds, in one transaction with
 * its preference row locked, opened first where the account has none, so
 * two writes never take one revision's number and the template and its
 * history never disagree.
 */
function underTemplateLock<A>(
  userId: string,
  body: (
    before: string | null,
  ) => Effect.Effect<A, AccountSeamFailure | Cause.NoSuchElementError, DatabaseServices>,
): Effect.Effect<A, AccountSeamFailure, DatabaseServices> {
  const locked = Effect.gen(function* () {
    yield* openPreferenceRow(userId);
    const { planTemplate: before } = yield* lockPlanTemplate(userId);
    return yield* body(before);
  }).pipe(
    // A row the lock or the write found missing is the database breaking its own contract, not an outcome.
    Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
  );
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(locked));
}

/**
 * The template written over `before`, under the lock, and kept as a
 * revision (`plan-template-revisions.ts`). Note that a write of what stands
 * keeps nothing, but a restore of it is still kept, because the developer
 * asked for that revision back and the history says so.
 */
function writtenUnderLock(
  userId: string,
  before: string | null,
  template: string | null,
  restoredFrom?: number,
): Effect.Effect<string | null, AccountSeamFailure | Cause.NoSuchElementError, DatabaseServices> {
  return Effect.gen(function* () {
    if (before === template && restoredFrom === undefined) return before;
    const { planTemplate: after } = yield* updatePlanTemplate({ userId, planTemplate: template });
    yield* recordTemplateRevision({
      userId,
      before,
      after,
      ...(restoredFrom === undefined ? undefined : { restoredFrom }),
    });
    return after;
  });
}

/** Keeps the account's template verbatim, or null for the default, kept as a revision where it changed, and answers what is then kept. */
export function writePlanTemplate(
  userId: string,
  template: string | null,
): Effect.Effect<string | null, AccountSeamFailure, DatabaseServices> {
  return underTemplateLock(userId, (before) => writtenUnderLock(userId, before, template));
}

/**
 * Puts one revision of the account's template back as the template, a
 * revision of its own that names it, and answers what is then kept; nothing
 * where the account has no such revision. The revision is read under the
 * lock, so a write that moves it on meanwhile is either all before the read
 * or all after the restore.
 */
export function restorePlanTemplate(
  userId: string,
  seq: number,
): Effect.Effect<Option.Option<string | null>, AccountSeamFailure, DatabaseServices> {
  return underTemplateLock(userId, (before) =>
    Effect.flatMap(readTemplateRevisionContent(userId, seq), (content) =>
      Option.match(content, {
        onNone: () => Effect.succeed(Option.none<string | null>()),
        onSome: (template) =>
          Effect.map(writtenUnderLock(userId, before, template, seq), Option.some),
      }),
    ),
  );
}
