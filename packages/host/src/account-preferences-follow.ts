import {
  type AccountPreferencesLiveAnswer,
  type AccountPreferencesLiveRow,
  accountPreferencesLiveRowsSchema,
  accountPreferencesOfLiveRows,
} from "@repo/features/account-preferences-live";
import type { AgentDefaultAnswer } from "@repo/features/agent-view";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import type { ModelChoice } from "@repo/features/models-wire";
import type {
  TasksWorkspaceSlackBotAnswer,
  TasksWorkspaceSlackBotNotificationsParams,
} from "@repo/features/tasks-view";
import { carried } from "@repo/gateway";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  type WriteDeclaration,
} from "@repo/sync";
import type { WireValue } from "@repo/wire";
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

export interface AccountPreferencesPoolRow extends AccountPreferencesLiveRow {
  readonly userId: string;
}

const ACCOUNT_PREFERENCES = fieldKind((row: AccountPreferencesPoolRow) => row.userId);

type PreferencesChange = FieldChange<AccountPreferencesPoolRow>;

interface PreferencesUnanswered {
  readonly failure: string;
}

export interface AccountPreferencesFollowDependencies {
  readonly seal: (
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<AccountPreferencesLiveAnswer | PreferencesUnanswered>;
  readonly gate: () => boolean;
  readonly pool: EntityPool;
  readonly tell: (held: AppAccountPreferences) => void;
}

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
        accountPreferencesLiveRowsSchema,
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

function readerRow(readerId: () => string | undefined): readonly string[] {
  const userId = readerId();
  return userId === undefined ? [] : [userId];
}

export function agentDefaultWritten(
  send: (choice: ModelChoice) => Effect.Effect<AgentDefaultAnswer>,
  readerId: () => string | undefined,
): WriteDeclaration<AccountPreferencesPoolRow, PreferencesChange, ModelChoice, WireValue> {
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
        "choice" in answer
          ? { answer: carried<AgentDefaultAnswer>(answer), txid: answer.txid }
          : { refused: carried<AgentDefaultAnswer>(answer) },
      ),
  };
}

export function slackNotificationsWritten(
  send: (
    write: TasksWorkspaceSlackBotNotificationsParams,
  ) => Effect.Effect<TasksWorkspaceSlackBotAnswer>,
  readerId: () => string | undefined,
): WriteDeclaration<
  AccountPreferencesPoolRow,
  PreferencesChange,
  TasksWorkspaceSlackBotNotificationsParams,
  WireValue
> {
  return {
    kind: ACCOUNT_PREFERENCES,
    keys: () => readerRow(readerId),
    change: (write) => () => ({ slackNotifications: write.notifications }),
    send: (write) =>
      Effect.map(send(write), (answer) =>
        "slackBot" in answer
          ? { answer: carried<TasksWorkspaceSlackBotAnswer>(answer), txid: answer.slackBot.txid }
          : { refused: carried<TasksWorkspaceSlackBotAnswer>(answer) },
      ),
  };
}
