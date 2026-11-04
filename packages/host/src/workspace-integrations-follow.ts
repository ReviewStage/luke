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

/**
 * workspace-integrations-follow.ts -- each workspace's own integrations the windows hold, its Sentry installations and its Slack bot, followed over the service's held poll into the sync engine's pool, told whole on their app-state slice, and every write to them drawn the moment it is asked.
 *
 * Settings › Workspace and an automation's editor hold a workspace's
 * integrations, and the host follows them while any window holds them and
 * a while after (`heldSlice`), so an install finished on Sentry or Slack, a
 * teammate's disconnect, Sentry's own uninstall, or a repository named
 * draws on every open surface within the service's coalesce window, with no
 * focus. Whether this deployment holds each integration rides beside the
 * rows on every answer, since no statement reads it.
 *
 * Each active Sentry installation is one row of the pool, by Sentry's id
 * for it, which no other installation shares. The Slack bot is one row by
 * its workspace, its channels' repositories folded into it: a channel's
 * repository is keyed by the workspace and Slack's id for the channel,
 * since two workspaces may connect one Slack team, so it stands in the row
 * of the one workspace it is named in rather than under a key of its own,
 * and leaves with it, as its row does with a disconnect.
 *
 * A disconnect, a default repository, and a channel's repository are each
 * a write the pool draws over its row at once, standing until the read
 * carries its transaction, so no answer from before it puts the row back,
 * and taken back where the service refused it. A connect asks Slack which
 * team the bot answers for, so its row is known only once the service
 * answers; it answers once the read carries it (`confirmed`), so the
 * window draws the team as the answer lands.
 *
 * A read the service did not answer is told unanswered and asked for again
 * after `LIVE_RESTART`, as a follow that stops is. One of a workspace the
 * account is no member of is told unanswered and ends; one refused because
 * the session is no longer the account the follow started for ends unsaid,
 * and the next sign-in follows it again.
 */

/** An active Sentry installation as the pool holds it, by Sentry's id for it. */
const SENTRY_INSTALLATION = fieldKind((row: SentryInstallationLiveRow) => row.installationId);

/** A workspace's Slack bot as the pool holds it: its installation's row, with each channel's repository by Slack's id for the channel. */
interface SlackBotRow extends SlackInstallationLiveRow {
  readonly channelRepositories: Readonly<Record<string, string>>;
}

/** A workspace's Slack bot as the pool holds it, by the workspace, every write to it a change of its fields or its deletion. */
const SLACK_BOT = fieldKind((row: SlackBotRow) => row.workspaceId);

/** A seal the service did not answer, `gone` where the read names nothing the account reaches any more. */
interface Unsealed {
  readonly failure: string;
  readonly gone?: boolean;
}

export interface WorkspaceIntegrationsDependencies {
  /** One workspace's integrations sealed for `userId`, their rows inline at the poll address where it polls, held past `after` where it names one. */
  readonly seal: (
    workspaceId: string,
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<WorkspaceIntegrationsLiveAnswer | Unsealed>;
  /** The account signed in, which every seal names; none while nobody is. */
  readonly accountId: () => string | undefined;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /** The sync engine's pool, which each held workspace's integrations stand in while it is followed. */
  readonly pool: EntityPool;
  /** Hears that a held workspace's Slack bot was connected or disconnected after its read first answered, as Slack's channels are asked again on. */
  readonly slackMoved: (workspaceId: string) => Effect.Effect<void>;
  readonly tell: (held: AppWorkspaceIntegrations) => void;
}

/** The workspaces' integrations the windows hold, and what the host does for them. */
export interface HeldWorkspaceIntegrations extends HeldSlice<string> {
  /**
   * A write to `workspaceId`'s integrations that no row stood for before the
   * service answered, as a connect, confirmed once its transaction reaches
   * the read the windows hold; at once where it wrote nothing, or where no
   * window holds the read.
   */
  readonly confirmed: (workspaceId: string, txid: string | undefined) => Effect.Effect<void>;
}

/** The Slack bot's row as its two statements deliver it, its channels' repositories folded in; none while it is not connected. */
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

/** The workspace's integrations as the reads hold them now, every write standing drawn over them. */
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

/**
 * Follows one workspace's integrations until let go, each change told
 * through `answers`: the rows as the read last answered them, with every
 * write standing drawn over them. Nothing is told before the read first
 * answers, since a write drawn on no rows shows nothing of the workspace.
 * `standing` hears the follow's wait for a write's transaction, as each
 * answer hands it on, and none once the follow is let go.
 */
function followIntegrations(
  dependencies: WorkspaceIntegrationsDependencies,
  workspaceId: string,
  answers: HeldAnswers<AppHostReads[typeof LIVE_READ.WORKSPACE_INTEGRATIONS]>,
  standing: (wait: TxWait | undefined) => void,
): Effect.Effect<void> {
  // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
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
      /** The team the bot was connected to as the read last answered it, none while it was not; unknown before the first answer. */
      let team: string | null | undefined;
      /** Whether a poll ended the follow for good, the account no longer reaching the workspace, so the follow is told unanswered. */
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
            // Note that only a move after the first answer asks Slack's channels again, since a window holding them asks as it holds them.
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

/**
 * The held lifetime over every workspace's integrations the windows hold
 * (`heldSlice`), keyed by the workspace, told whole on their slice: each
 * workspace's read as its follow last told it, kept where a later read does
 * not answer, and failed where it never answered.
 */
export function heldWorkspaceIntegrations(
  dependencies: WorkspaceIntegrationsDependencies,
): Effect.Effect<HeldWorkspaceIntegrations, never, Scope.Scope> {
  return Effect.gen(function* () {
    /** Each standing follow's wait for a write's transaction, by the workspace. */
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

/** The window's answer carried as it crosses back, with no transaction, which is the host's to wait on and never the window's. */
function sentryAnswered(answer: TasksWorkspaceSentryAnswer): WireValue {
  if (!("sentry" in answer)) return carried<TasksWorkspaceSentryAnswer>(answer);
  const { txid: _txid, ...sentry } = answer.sentry;
  return carried<TasksWorkspaceSentryAnswer>({ sentry });
}

/** The window's answer carried as it crosses back, with no transaction, as a Sentry answer is. */
export function slackBotAnswered(answer: TasksWorkspaceSlackBotAnswer): WireValue {
  if (!("slackBot" in answer)) return carried<TasksWorkspaceSlackBotAnswer>(answer);
  const { txid: _txid, ...slackBot } = answer.slackBot;
  return carried<TasksWorkspaceSlackBotAnswer>({ slackBot });
}

/** A Slack write's answer as the pool reads it: taken, standing until its transaction, or refused, which takes back what it drew. */
function slackBotWritten(answer: TasksWorkspaceSlackBotAnswer) {
  return "slackBot" in answer
    ? { answer: slackBotAnswered(answer), txid: answer.slackBot.txid }
    : { refused: slackBotAnswered(answer) };
}

/**
 * One Sentry installation disconnected, gone at once from every held read
 * of its workspace, sent as `send` asks. Note that a disconnect the service
 * took waits on the transaction it marked the installation in; one of an
 * installation already gone marked none, so it settles on its own answer,
 * and a refusal puts the installation back.
 */
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

/** The workspace's Slack bot disconnected, gone at once from every held read of the workspace, its channels' repositories with it; a refusal puts it back. */
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

/** The workspace's default repository for Slack starts named or cleared, drawn at once over the bot's row; a refusal puts the one before back. */
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

/**
 * One channel's repository named or cleared, or the bot taken out of it,
 * which forgets its repository, drawn at once over the bot's row. Putting
 * the bot in a channel changes no row, so it draws nothing here: whether
 * the bot is in a channel is Slack's own, which `answered` lays from the
 * service's answer. A refusal puts the repository back.
 */
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
