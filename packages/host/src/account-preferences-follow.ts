import {
  ACCOUNT_PREFERENCES_READ,
  type AccountPreferencesLiveAnswer,
  type AccountPreferencesLiveRow,
  accountPreferencesOfLiveRows,
} from "@repo/features/account-preferences-live";
import type {
  AgentDefaultAnswer,
  ChaptersProviderAnswer,
  ChaptersProviderWriteParams,
} from "@repo/features/agent-view";
import { CHAPTERS_MODEL, chaptersModelOn } from "@repo/features/chapters-model-choice";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import type { ModelChoice } from "@repo/features/models-wire";
import type {
  TasksWorkspaceSlackBotAnswer,
  TasksWorkspaceSlackBotNotificationsParams,
} from "@repo/features/tasks-view";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  type WriteDeclaration,
} from "@repo/sync";
import { Effect, type Scope } from "effect";
import { type AppAccountPreferences, type AppHostReads, NO_KEYS_HELD } from "./app-state.js";
import { type HeldAnswers, type HeldSlice, heldSlice } from "./live-collection.js";
import {
  confirmWrite,
  followTakingRows,
  LIVE_GONE,
  restarting,
  type TxWait,
} from "./live-follow.js";

/**
 * account-preferences-follow.ts -- the account's preferences row, held for the signed-in session, followed over the service's held poll into the sync engine's pool by the account, told whole on its app-state slice, and every write to it drawn over it the moment it is asked.
 *
 * Every surface that draws the default agent, the chapters model, or the
 * Slack notifications switch reads them from this one row, which the host
 * follows from the gate opening until the session ends, so a default chosen
 * on another device draws on every open window within the service's
 * coalesce window. The row is one row of the pool (`@repo/sync`), by the
 * account, and stands there whether or not the account ever stored one: an
 * account that stored none is held as a row of nothing chosen, so a write
 * has a row to draw over before the service makes it.
 *
 * The default, the chapters model, and the switch are writes the pool draws
 * over the row at once, standing until the read carries the transaction
 * each committed in, and taken back where the service refused them.
 *
 * A read the service did not answer is told unanswered and asked for again
 * after `LIVE_RESTART`, as a follow that stops is; one refused because the
 * session is no longer the account the follow started for ends unsaid, and
 * the next sign-in follows it again.
 */

/** The account's row as the pool holds it: the live row, under the account it is the row of. */
export interface AccountPreferencesPoolRow extends AccountPreferencesLiveRow {
  readonly userId: string;
}

/** The account's row as the pool holds it, by the account, every write to it a change of its fields. */
const ACCOUNT_PREFERENCES = fieldKind((row: AccountPreferencesPoolRow) => row.userId);

/** A change to the account's row. */
type PreferencesChange = FieldChange<AccountPreferencesPoolRow>;

/** A read the service did not answer, as the client and the gate tell it. */
interface PreferencesUnanswered {
  readonly failure: string;
}

export interface AccountPreferencesFollowDependencies {
  /** The account's preferences sealed for `userId`, its row inline at the poll address where it polls, held past `after` where it names one. */
  readonly seal: (
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<AccountPreferencesLiveAnswer | PreferencesUnanswered>;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /** The sync engine's pool, which the account's row stands in while it is followed. */
  readonly pool: EntityPool;
  readonly tell: (held: AppAccountPreferences) => void;
}

/** The account's row as the read answered it, or a row of nothing chosen where it answered none. */
function poolRowOf(
  userId: string,
  rows: readonly AccountPreferencesLiveRow[],
): AccountPreferencesPoolRow {
  const [row] = rows;
  return {
    userId,
    agentModel: row?.agentModel ?? null,
    agentEffort: row?.agentEffort ?? null,
    agentContextWindow: row?.agentContextWindow ?? null,
    chaptersModel: row?.chaptersModel ?? null,
    slackNotifications: row?.slackNotifications ?? null,
  };
}

/**
 * Follows the account's row until let go, each change told through
 * `answers`: the row as the read last answered it, with every write standing
 * drawn over it. Nothing is told before the read first answers, since a
 * write drawn on no row shows nothing of the account.
 */
function followPreferences(
  dependencies: AccountPreferencesFollowDependencies,
  userId: string,
  answers: HeldAnswers<AppHostReads[typeof LIVE_READ.ACCOUNT_PREFERENCES]>,
): Effect.Effect<void> {
  const seal = (poll: boolean, after?: string) =>
    dependencies.gate()
      ? dependencies.seal(userId, poll, after)
      : Effect.succeed<PreferencesUnanswered>(LIVE_SIGNED_OUT);
  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const first = yield* seal(false);
      if ("failure" in first) {
        if (first.failure === LIVE_SIGNED_OUT.failure) return false;
        answers.unanswered();
        return true;
      }
      let wait: TxWait | undefined;
      let answered = false;
      const drawn: Effect.Effect<void> = Effect.sync(() => {
        if (answered) answers.answered(accountPreferencesOfLiveRows(row.rows()));
      });
      const row: HeldRows<AccountPreferencesPoolRow> = yield* dependencies.pool.stand(
        ACCOUNT_PREFERENCES,
        {
          redraw: () => drawn,
          confirmation: () => {
            const handed = wait;
            return handed === undefined ? undefined : (txid) => confirmWrite(handed, txid);
          },
        },
      );
      const gone = yield* followTakingRows(
        {
          poll: (after) =>
            Effect.map(seal(true, after), (read) =>
              "failure" in read
                ? { failure: read.failure, gone: read.failure === LIVE_SIGNED_OUT.failure }
                : read,
            ),
          onTxWait: (handed) => {
            wait = handed;
          },
        },
        first,
        ACCOUNT_PREFERENCES_READ.rows,
        (rows) =>
          Effect.andThen(
            row.answer([poolRowOf(userId, rows.preferences)]),
            Effect.suspend(() => {
              answered = true;
              return drawn;
            }),
          ),
      ).pipe(
        Effect.as(false),
        Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
      );
      return !gone;
    }),
  );
  return restarting(attempt);
}

/**
 * The lifetime over the account's row (`heldSlice`), keyed by the account,
 * told whole on its slice: as its follow last told it, kept where a later
 * read does not answer, and failed where it never answered. The host holds
 * it for the signed-in session (`accountReads`), so no window holds it.
 */
export function heldAccountPreferences(
  dependencies: AccountPreferencesFollowDependencies,
): Effect.Effect<HeldSlice<string>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.ACCOUNT_PREFERENCES, string>({
    empty: NO_KEYS_HELD,
    path: (userId) => [userId],
    gate: dependencies.gate,
    follow: (userId, answers) => followPreferences(dependencies, userId, answers),
    tell: dependencies.tell,
  });
}

/** The account's row a write changes: the account signed in, or none while nobody is. */
function readerRow(readerId: () => string | undefined): readonly string[] {
  const userId = readerId();
  return userId === undefined ? [] : [userId];
}

/** The account's default drawn at once over its row, sent as `send` asks, standing until the read carries the transaction it committed in. */
export function agentDefaultWritten(
  send: (choice: ModelChoice) => Effect.Effect<AgentDefaultAnswer>,
  readerId: () => string | undefined,
): WriteDeclaration<AccountPreferencesPoolRow, PreferencesChange, ModelChoice, AgentDefaultAnswer> {
  return {
    kind: ACCOUNT_PREFERENCES,
    keys: () => readerRow(readerId),
    change: (choice) => () => ({
      agentModel: choice.model,
      agentEffort: choice.effort,
      agentContextWindow: choice.contextWindow ?? null,
    }),
    send: (choice) =>
      Effect.map(send(choice), (answer) =>
        "choice" in answer ? { answer, txid: answer.txid } : { refused: answer },
      ),
  };
}

/** Whose API key the account's chapters run on, kept as its chapters model, its provider's model of Haiku's tier, drawn at once over its row, sent as `send` asks, standing until the read carries the transaction it committed in. */
export function chaptersProviderWritten(
  send: (
    provider: ChaptersProviderWriteParams["provider"],
  ) => Effect.Effect<ChaptersProviderAnswer>,
  readerId: () => string | undefined,
): WriteDeclaration<
  AccountPreferencesPoolRow,
  PreferencesChange,
  ChaptersProviderWriteParams,
  ChaptersProviderAnswer
> {
  return {
    kind: ACCOUNT_PREFERENCES,
    keys: () => readerRow(readerId),
    change: (write) => () => ({
      chaptersModel: chaptersModelOn(write.provider, CHAPTERS_MODEL.HAIKU),
    }),
    send: (write) =>
      Effect.map(send(write.provider), (answer) =>
        "provider" in answer ? { answer, txid: answer.txid } : { refused: answer },
      ),
  };
}

/** The account's Slack notifications switch drawn at once over its row, sent as `send` asks, standing until the read carries the transaction it committed in. */
export function slackNotificationsWritten(
  send: (
    write: TasksWorkspaceSlackBotNotificationsParams,
  ) => Effect.Effect<TasksWorkspaceSlackBotAnswer>,
  readerId: () => string | undefined,
): WriteDeclaration<
  AccountPreferencesPoolRow,
  PreferencesChange,
  TasksWorkspaceSlackBotNotificationsParams,
  TasksWorkspaceSlackBotAnswer
> {
  return {
    kind: ACCOUNT_PREFERENCES,
    keys: () => readerRow(readerId),
    change: (write) => () => ({ slackNotifications: write.notifications }),
    send: (write) =>
      Effect.map(send(write), (answer) =>
        "slackBot" in answer ? { answer, txid: answer.slackBot.txid } : { refused: answer },
      ),
  };
}
