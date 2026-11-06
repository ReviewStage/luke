import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import type {
  TasksWorkspaceParams,
  TasksWorkspaceSentryAnswer,
  TasksWorkspaceSentryDisconnectParams,
  TasksWorkspaceSlackBotAnswer,
  TasksWorkspaceSlackBotChannelParams,
  TasksWorkspaceSlackBotRepositoryParams,
} from "@repo/features/tasks-view";
import {
  type IntegrationsConfigured,
  type SentryInstallationLiveRow,
  type SlackInstallationLiveRow,
  type WorkspaceIntegrations,
  type WorkspaceIntegrationsLiveAnswer,
  workspaceIntegrationsLiveRowsSchema,
  workspaceIntegrationsOfLive,
} from "@repo/features/workspace-integrations-live";
import { carried } from "@repo/gateway";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import type { WireValue } from "@repo/wire";
import { Effect, type Scope } from "effect";
import { type AppHostReads, type AppWorkspaceIntegrations, NO_KEYS_HELD } from "./app-state.js";
import { type HeldAnswers, type HeldSlice, heldSlice } from "./live-collection.js";
import {
  confirmWrite,
  followTakingRows,
  LIVE_GONE,
  restarting,
  type TxWait,
} from "./live-follow.js";

const SENTRY_INSTALLATION = fieldKind((row: SentryInstallationLiveRow) => row.installationId);

interface SlackBotRow extends SlackInstallationLiveRow {
  readonly channelRepositories: Readonly<Record<string, string>>;
}

const SLACK_BOT = fieldKind((row: SlackBotRow) => row.workspaceId);

interface Unsealed {
  readonly failure: string;
  readonly gone?: boolean;
}

export interface WorkspaceIntegrationsDependencies {
  readonly seal: (
    workspaceId: string,
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<WorkspaceIntegrationsLiveAnswer | Unsealed>;
  readonly accountId: () => string | undefined;
  readonly gate: () => boolean;
  readonly pool: EntityPool;
  readonly slackMoved: (workspaceId: string) => Effect.Effect<void>;
  readonly tell: (held: AppWorkspaceIntegrations) => void;
}

export interface HeldWorkspaceIntegrations extends HeldSlice<string> {
  readonly confirmed: (workspaceId: string, txid: string | undefined) => Effect.Effect<void>;
}

function slackBotRowOf(
  rows: typeof workspaceIntegrationsLiveRowsSchema.Type,
): readonly SlackBotRow[] {
  const [installation] = rows.slackInstallation;
  if (installation === undefined) return [];
  const channelRepositories = Object.fromEntries(
    rows.slackChannelRepositories.map((channel) => [channel.channelId, channel.repository]),
  );
  return [{ ...installation, channelRepositories }];
}

function integrationsOf(
  configured: IntegrationsConfigured,
  sentry: HeldRows<SentryInstallationLiveRow>,
  slack: HeldRows<SlackBotRow>,
): WorkspaceIntegrations {
  const bots = slack.rows();
  return workspaceIntegrationsOfLive(configured, {
    sentryInstallations: sentry.rows(),
    slackInstallation: bots,
    slackChannelRepositories: bots.flatMap((bot) =>
      Object.entries(bot.channelRepositories).map(([channelId, repository]) => ({
        channelId,
        repository,
      })),
    ),
  });
}

function followIntegrations(
  dependencies: WorkspaceIntegrationsDependencies,
  workspaceId: string,
  answers: HeldAnswers<AppHostReads[typeof LIVE_READ.WORKSPACE_INTEGRATIONS]>,
  standing: (wait: TxWait | undefined) => void,
): Effect.Effect<void> {
  const userId = dependencies.accountId();
  const seal = (poll: boolean, after?: string) =>
    userId === undefined
      ? Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true })
      : dependencies.seal(workspaceId, userId, poll, after);
  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const first = yield* seal(false);
      if ("failure" in first) {
        if (first.failure !== LIVE_SIGNED_OUT.failure) answers.unanswered();
        return first.gone !== true;
      }
      yield* Effect.addFinalizer(() => Effect.sync(() => standing(undefined)));
      let configured: IntegrationsConfigured = first;
      let wait: TxWait | undefined;
      let answered = false;
      let team: string | null | undefined;
      let refused = false;
      const drawn: Effect.Effect<void> = Effect.sync(() => {
        if (answered) answers.answered(integrationsOf(configured, sentry, slack));
      });
      const read = {
        redraw: () => drawn,
        confirmation: () => {
          const handed = wait;
          return handed === undefined ? undefined : (txid: string) => confirmWrite(handed, txid);
        },
      };
      const sentry = yield* dependencies.pool.stand(SENTRY_INSTALLATION, read);
      const slack = yield* dependencies.pool.stand(SLACK_BOT, read);
      const gone = yield* followTakingRows(
        {
          poll: (after) =>
            Effect.map(seal(true, after), (sealed) => {
              if ("failure" in sealed) {
                refused ||= sealed.gone === true && sealed.failure !== LIVE_SIGNED_OUT.failure;
                return sealed;
              }
              configured = sealed;
              return sealed;
            }),
          onTxWait: (handed) => {
            wait = handed;
            standing(handed);
          },
        },
        first,
        workspaceIntegrationsLiveRowsSchema,
        (rows) =>
          Effect.gen(function* () {
            yield* sentry.answer(rows.sentryInstallations);
            yield* slack.answer(slackBotRowOf(rows));
            const now = rows.slackInstallation[0]?.teamId ?? null;
            const moved = team !== undefined && team !== now;
            team = now;
            answered = true;
            yield* drawn;
            if (moved) yield* dependencies.slackMoved(workspaceId);
          }),
      ).pipe(
        Effect.as(false),
        Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
      );
      if (!gone) return true;
      if (refused) answers.unanswered();
      return false;
    }),
  );
  return restarting(attempt);
}

export function heldWorkspaceIntegrations(
  dependencies: WorkspaceIntegrationsDependencies,
): Effect.Effect<HeldWorkspaceIntegrations, never, Scope.Scope> {
  return Effect.gen(function* () {
    const waits = new Map<string, TxWait>();
    const slice = yield* heldSlice<typeof LIVE_READ.WORKSPACE_INTEGRATIONS, string>({
      empty: NO_KEYS_HELD,
      path: (workspaceId) => [workspaceId],
      gate: dependencies.gate,
      follow: (workspaceId, answers) =>
        followIntegrations(dependencies, workspaceId, answers, (wait) => {
          if (wait === undefined) waits.delete(workspaceId);
          else waits.set(workspaceId, wait);
        }),
      tell: dependencies.tell,
    });
    return {
      ...slice,
      confirmed: (workspaceId, txid) =>
        Effect.suspend(() => confirmWrite(waits.get(workspaceId), txid)),
    };
  });
}

function sentryAnswered(answer: TasksWorkspaceSentryAnswer): WireValue {
  if (!("sentry" in answer)) return carried<TasksWorkspaceSentryAnswer>(answer);
  const { txid: _txid, ...sentry } = answer.sentry;
  return carried<TasksWorkspaceSentryAnswer>({ sentry });
}

export function slackBotAnswered(answer: TasksWorkspaceSlackBotAnswer): WireValue {
  if (!("slackBot" in answer)) return carried<TasksWorkspaceSlackBotAnswer>(answer);
  const { txid: _txid, ...slackBot } = answer.slackBot;
  return carried<TasksWorkspaceSlackBotAnswer>({ slackBot });
}

function slackBotWritten(answer: TasksWorkspaceSlackBotAnswer) {
  return "slackBot" in answer
    ? { answer: slackBotAnswered(answer), txid: answer.slackBot.txid }
    : { refused: slackBotAnswered(answer) };
}

export function sentryDisconnect(
  send: (params: TasksWorkspaceSentryDisconnectParams) => Effect.Effect<TasksWorkspaceSentryAnswer>,
): WriteDeclaration<
  SentryInstallationLiveRow,
  FieldChange<SentryInstallationLiveRow>,
  TasksWorkspaceSentryDisconnectParams,
  WireValue
> {
  return {
    kind: SENTRY_INSTALLATION,
    keys: (params) => [params.installationId],
    change: () => () => ROW_GONE,
    send: (params) =>
      Effect.map(send(params), (answer) =>
        "sentry" in answer
          ? { answer: sentryAnswered(answer), txid: answer.sentry.txid }
          : { refused: sentryAnswered(answer) },
      ),
  };
}

export function slackBotDisconnect(
  send: (params: TasksWorkspaceParams) => Effect.Effect<TasksWorkspaceSlackBotAnswer>,
): WriteDeclaration<SlackBotRow, FieldChange<SlackBotRow>, TasksWorkspaceParams, WireValue> {
  return {
    kind: SLACK_BOT,
    keys: (params) => [params.workspaceId],
    change: () => () => ROW_GONE,
    send: (params) => Effect.map(send(params), slackBotWritten),
  };
}

export function slackBotRepository(
  send: (
    params: TasksWorkspaceSlackBotRepositoryParams,
  ) => Effect.Effect<TasksWorkspaceSlackBotAnswer>,
): WriteDeclaration<
  SlackBotRow,
  FieldChange<SlackBotRow>,
  TasksWorkspaceSlackBotRepositoryParams,
  WireValue
> {
  return {
    kind: SLACK_BOT,
    keys: (params) => [params.workspaceId],
    change: (params) => () => ({ defaultRepository: params.repository }),
    send: (params) => Effect.map(send(params), slackBotWritten),
  };
}

export function slackBotChannel(
  send: (
    params: TasksWorkspaceSlackBotChannelParams,
  ) => Effect.Effect<TasksWorkspaceSlackBotAnswer>,
  answered: (
    params: TasksWorkspaceSlackBotChannelParams,
    answer: TasksWorkspaceSlackBotAnswer,
  ) => Effect.Effect<void>,
): WriteDeclaration<
  SlackBotRow,
  FieldChange<SlackBotRow>,
  TasksWorkspaceSlackBotChannelParams,
  WireValue
> {
  return {
    kind: SLACK_BOT,
    keys: (params) => [params.workspaceId],
    change: (params) => (row) => {
      const repository = params.member === false ? null : params.repository;
      if (repository === undefined) return {};
      const { [params.channelId]: _left, ...others } = row.channelRepositories;
      return {
        channelRepositories:
          repository === null ? others : { ...others, [params.channelId]: repository },
      };
    },
    send: (params) =>
      Effect.flatMap(send(params), (answer) =>
        Effect.as(answered(params, answer), slackBotWritten(answer)),
      ),
  };
}
