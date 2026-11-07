/**
 * compose-workspaces.ts -- the account's workspaces, their people, invitations, integrations, and token repositories, GitHub's connection, and the admin dashboard's asks, read from and written to the service.
 *
 * The workspaces the account is a member of are carried on the tasks' view
 * beside the tasks (`TasksForWorkspaces`) and followed apart from them over
 * Neon Realtime, so the tasks never wait on them: from the account gate
 * opening, at a launch or a sign-in, until a sign-out, each change drawn as
 * it lands, a teammate's and the browser's among them. Whether the account's
 * GitHub is connected is read once beside them, and again when the panel
 * comes forward, at most once a minute, since it is measured against the
 * clock and cannot be followed. A workspace made, renamed, or given a photo,
 * a GitHub organization connected or disconnected, a removal of a member, a
 * member's role changed, a handover, and a leave are carried to the service
 * on the developer's word, and a connection's install address is answered
 * to the caller that asked and held nowhere here. Each workspace's people,
 * invitations, integrations, Slack channels, and token repositories are held
 * for the windows that draw them and told on the app state.
 *
 * Behind a closed account gate, or on a run that sends nothing, nothing is
 * read.
 */
import {
  type HostedAdminClient,
  type HostedGitHubConnectionClient,
  type HostedWorkspaceClient,
  WORKSPACE_CALL_FAILURE,
  type WorkspaceCallFailure,
  type WorkspaceCallResult,
} from "@repo/features";
import { ADMIN_UNANSWERED } from "@repo/features/admin-wire";
import {
  PRODUCT_EVENT,
  PRODUCT_SETTING_VALUE,
  type RecordProductEvent,
} from "@repo/features/analytics";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import type {
  SlackBotChannel,
  SlackListedChannel,
  WorkspaceSlackBot,
} from "@repo/features/slack-bot-wire";
import {
  GITHUB_DISCONNECT_FAILURE,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TasksView,
  type TasksWorkspaceAnswer,
  type TasksWorkspaceExperimentSetParams,
  type TasksWorkspaceInvitationsAnswer,
  type TasksWorkspaceMemberRemoveParams,
  type TasksWorkspaceMemberRoleParams,
  type TasksWorkspaceMembersAnswer,
  type TasksWorkspaceRenameParams,
  type TasksWorkspaceSentryAnswer,
  type TasksWorkspaceSlackBotAnswer,
  type TasksWorkspaceSlugSetParams,
  type TasksWorkspaceTokenRepositoriesAnswer,
  type TasksWorkspaceTokenRepositorySetParams,
} from "@repo/features/tasks-view";
import { WORKSPACE_INTEGRATIONS_READ } from "@repo/features/workspace-integrations-live";
import {
  WORKSPACE_INVITATIONS_READ,
  WORKSPACE_MEMBERS_READ,
  WORKSPACES_READ,
} from "@repo/features/workspace-live";
import {
  WORKSPACE_SLUG_PROBLEM,
  type Workspace,
  type WorkspaceMember,
} from "@repo/features/workspace-wire";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD } from "@repo/gateway";
import {
  EXPERIMENT_COUNTED_AS,
  EXPERIMENT_SCOPE_COUNTED_AS,
  experimentScope,
  isExperiment,
} from "@repo/settings";
import { declaredWrite, type EntityPool } from "@repo/sync";
import {
  Clock,
  Duration,
  Effect,
  Exit,
  FiberHandle,
  FiberMap,
  Option,
  Scope,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { slackNotificationsWritten } from "./account-preferences-follow.js";
import {
  ALREADY_INVITED_REFUSAL,
  GITHUB_LAST_SIGN_IN_REFUSAL,
  WORKSPACE_NOT_PERMITTED_REFUSAL,
  WORKSPACE_SLUG_REFUSAL,
} from "./acts.js";
import { type AppTokenRepositories, type AppWorkspacePhotos, NO_KEYS_HELD } from "./app-state.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { type TASKS_ACTS, type WORKSPACE_ACTS, WORKSPACE_FOLLOWS } from "./contract/index.js";
import { type EntityStore, KEPT_READ } from "./entity-store.js";
import type { HostMethodTable } from "./gateway-door.js";
import { heldFetch } from "./held-fetch.js";
import { ActRefused, type HostActTable, liveTold } from "./host-acts.js";
import type { HostKernel } from "./host-kernel.js";
import type { KeptContent } from "./kept-content.js";
import { FOLLOW_BACKOFF, LIVE_GONE, LiveBroken } from "./live-follow.js";
import type { RunMode } from "./run-mode.js";
import { type TokenRepositoryWrites, tokenRepositoryWrites } from "./token-repository-writes.js";
import type { WindowFocus } from "./window-focus.js";
import {
  heldWorkspaceIntegrations,
  sentryDisconnect,
  slackBotAnswered,
  slackBotChannel,
  slackBotDisconnect,
  slackBotRepository,
} from "./workspace-integrations-follow.js";
import { workspaceInvitationsReads } from "./workspace-invitations-read.js";
import {
  type MemberMoved,
  type MemberWritten,
  workspaceMembersReads,
} from "./workspace-members-read.js";
import {
  type AskedOver,
  type WorkspaceRows,
  type WorkspaceWritten,
  workspaceRows,
  workspaceWrite,
} from "./workspace-rows.js";
import { workspacesMoves } from "./workspaces-follow.js";

/**
 * How long a read of whether the account's GitHub is connected stands
 * before a refresh or the panel coming forward reads it again. Note that a
 * connection made in the browser reaches this Mac only on a read, and a
 * panel brought forward over and over is not a reason to read each time.
 */
const GITHUB_READ_EVERY = Duration.minutes(1);

/** A GitHub page asked behind a closed gate, or of a service that did not answer, which opens nothing. */
const GITHUB_PAGE_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/** A workspace call behind a closed gate, which never reaches the service. */
const WORKSPACE_UNANSWERED = { failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;

/** The sentence a workspace act is refused in for a failure that says why, each other failure refused in the act's own. */
const WORKSPACE_REFUSAL: Partial<Record<WorkspaceCallFailure, string>> = {
  [WORKSPACE_CALL_FAILURE.NOT_PERMITTED]: WORKSPACE_NOT_PERMITTED_REFUSAL,
  [WORKSPACE_CALL_FAILURE.ALREADY_INVITED]: ALREADY_INVITED_REFUSAL,
  [WORKSPACE_CALL_FAILURE.SLUG_MALFORMED]: WORKSPACE_SLUG_REFUSAL[WORKSPACE_SLUG_PROBLEM.MALFORMED],
  [WORKSPACE_CALL_FAILURE.SLUG_RESERVED]: WORKSPACE_SLUG_REFUSAL[WORKSPACE_SLUG_PROBLEM.RESERVED],
  [WORKSPACE_CALL_FAILURE.SLUG_TAKEN]: WORKSPACE_SLUG_REFUSAL[WORKSPACE_SLUG_PROBLEM.TAKEN],
};

/** The acts of `TASKS_ACTS` this composer answers: GitHub's connection and the admin dashboard's asks. */
const WORKSPACES_TASKS_ACT = {
  GITHUB_CONNECT: "GITHUB_CONNECT",
  GITHUB_DISCONNECT: "GITHUB_DISCONNECT",
  ADMIN_READ: "ADMIN_READ",
  ADMIN_FAVORITE: "ADMIN_FAVORITE",
} as const satisfies Readonly<Record<string, keyof typeof TASKS_ACTS>>;

export type WorkspacesTasksAct = (typeof WORKSPACES_TASKS_ACT)[keyof typeof WORKSPACES_TASKS_ACT];

/** The service's side of the workspaces, GitHub's connection, and the admin dashboard, as this concern asks it. */
export interface WorkspacesClient {
  /** The account's workspaces, the ones it may join, and their members. */
  workspaces: Pick<
    HostedWorkspaceClient,
    | "liveRead"
    | "create"
    | "rename"
    | "setSlug"
    | "setExperiment"
    | "setPhoto"
    | "githubConnect"
    | "githubDisconnect"
    | "sentryInstall"
    | "sentryDisconnect"
    | "slackBot"
    | "slackBotConnect"
    | "slackBotDisconnect"
    | "slackBotNotifications"
    | "slackBotRepository"
    | "slackBotChannel"
    | "photo"
    | "removeMember"
    | "tokenRepositories"
    | "setTokenRepository"
    | "environment"
    | "putVariable"
    | "deleteVariable"
    | "changeRole"
    | "transfer"
    | "leave"
    | "invite"
    | "cancelInvitation"
  >;
  /** Whether the account has GitHub connected, and the pages that connect and disconnect it. */
  github: Pick<HostedGitHubConnectionClient, "status" | "connect" | "disconnect">;
  /** The admin dashboard's reads and its star, under the account's session; the service's gate decides each. */
  admin: Pick<HostedAdminClient, "read" | "favorite">;
}

/** The task open as a leave was asked: the workspace it is in, and its close, which closes it only while it is still the one open. */
export interface OpenTaskLeaving {
  readonly workspaceId: string | undefined;
  readonly close: Effect.Effect<void>;
}

/** The parts of the tasks' view the workspaces are drawn on, and what a workspace's move asks of the tasks (`compose-tasks.ts`). */
export interface TasksForWorkspaces {
  /** The view as it stands now, whose workspaces are read as the follow and the photos move. */
  view: () => Pick<TasksView, "workspaces" | "workspacesStatus">;
  /** Draws the workspaces, how far their read got, or GitHub's connection on the view, and tells every window. */
  draw: (next: Partial<Pick<TasksView, "workspaces" | "workspacesStatus" | "github">>) => void;
  /** The repository lists of the workspaces named asked again, and every workspace's, which a change in any of them moves too. */
  repositoriesMovedIn: (workspaceIds: ReadonlySet<string>) => Effect.Effect<void>;
  /** The task open now, read as a leave is asked. */
  openTaskLeaving: () => OpenTaskLeaving;
}

export interface WorkspacesDependencies {
  kernel: Pick<HostKernel, "emit" | "now"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: WorkspacesClient;
  /** The account signed in now, by its id, which every live read names; none where nobody is. */
  accountId: () => string | undefined;
  /** The member signed in, by id and name, whose change an experiment's write draws before the service answers; none where nobody is. */
  member: () => { readonly userId: string; readonly name: string } | undefined;
  /** The content this host keeps, all let go as a workspace leaves the list (`kept-content.ts`). */
  kept: Pick<KeptContent, "clear">;
  /** The windows coming forward, raised here as the panel comes forward and heard by every read asked again on it. */
  focus: WindowFocus;
  /** The sync engine's pool, which the workspaces, their people, invitations, and integrations stand in. */
  pool: EntityPool;
  /** The signed-in account's lists kept on disk, which the gate opening draws before the service answers and each answer keeps; none where nothing keeps them. */
  entities: () => EntityStore | undefined;
  /** GitHub's standing as an integration asked again, as a GitHub disconnect that answered asks; done once each ask has landed (`compose-integrations.ts`). */
  githubMoved: Effect.Effect<void>;
  /** Counts a product event, as a workspace experiment an admin turned on or off is counted once the service takes it. */
  recordProductEvent: RecordProductEvent;
  /** The tasks' view the workspaces are drawn on, and the tasks a workspace's move reaches. */
  tasks: TasksForWorkspaces;
}

export interface WorkspacesComposer extends Composer {
  /** The workspaces' plain acts, and GitHub's connection's and the admin dashboard's, answered directly as the panel's port asks them. */
  readonly acts: HostActTable<typeof WORKSPACE_ACTS> &
    HostActTable<typeof WORKSPACE_FOLLOWS> &
    Pick<HostActTable<typeof TASKS_ACTS>, WorkspacesTasksAct>;
  /** Follows the workspaces, and every read a window holds anew, as the account gate opening asks; GitHub's connection is read beside them where the last read is stale. */
  open: Effect.Effect<void>;
  /** Drops everything held, for a sign-out. */
  reset: Effect.Effect<void>;
  /** The Tasks tab's Try again: the workspaces followed where nothing follows them, and GitHub's connection read where the last read is stale. */
  refreshed: Effect.Effect<void>;
}

/** What every builder below reaches: its dependencies, the service over the host's own HTTP client, and whether the gate stands open. */
interface WorkspacesReach {
  readonly dependencies: WorkspacesDependencies;
  /** One ask of the service, over the host's own HTTP client. */
  readonly served: <Answer, Failure>(
    call: Effect.Effect<Answer, Failure, HttpClient.HttpClient>,
  ) => Effect.Effect<Answer, Failure>;
  readonly gate: () => boolean;
}

/** A workspace's read sealed or polled, as a held read's follow reads it: its answer, or why not and whether it is gone for good. */
type WorkspaceSealed<Answer> = (
  poll: boolean,
  after?: string,
) => Effect.Effect<Answer | { readonly failure: string; readonly gone: boolean }>;

/** A workspace act refused for `failure`: in words that say why where the failure says it, and in the act's own sentence otherwise. */
function workspaceRefused(failure: WorkspaceCallFailure): Effect.Effect<never, ActRefused> {
  const sentence = WORKSPACE_REFUSAL[failure];
  return Effect.fail(new ActRefused(sentence === undefined ? {} : { sentence }));
}

/** Whether a live read's seal failed, rather than answered. */
function isFailed<Answer>(
  sealed: Answer | { readonly failure: string },
): sealed is { readonly failure: string } {
  return typeof sealed === "object" && sealed !== null && "failure" in sealed;
}

/**
 * A workspace answer as its act answers the panel: the value under `field`,
 * or refused for the failure it carries (`workspaceRefused`), as the act
 * port refused it before the act was declared.
 */
function workspaceAnswered<const Field extends string>(field: Field) {
  return <Value>(
    answer: { readonly [Key in Field]: Value } | { readonly failure: WorkspaceCallFailure },
  ): Effect.Effect<Value, ActRefused> =>
    // SAFETY: an answer that carries no failure is the value under `field`, by its type.
    "failure" in answer
      ? workspaceRefused(answer.failure)
      : Effect.succeed((answer as { readonly [Key in Field]: Value })[field]);
}

/** A channel of a workspace's Slack team as the held list keeps it, with no repository, which is the workspace's held integrations'. */
function listedChannel({
  repository: _repository,
  ...channel
}: SlackBotChannel): SlackListedChannel {
  return channel;
}

/** A workspace's Slack bot as the window hears it from the service's answer, or why there is none. */
function slackBotOf(answer: WorkspaceCallResult<WorkspaceSlackBot>): TasksWorkspaceSlackBotAnswer {
  return answer.ok ? { slackBot: answer.answer } : { failure: answer.failure };
}

/** What a member write's answer says of each of `userIds`: the role it answers them with, or gone where it names them no more. */
function membersMoved(
  answered: readonly WorkspaceMember[],
  userIds: readonly (string | undefined)[],
): MemberMoved[] {
  return userIds.flatMap((userId) => {
    if (userId === undefined) return [];
    const member = answered.find((each) => each.userId === userId);
    return [member === undefined ? { userId, gone: true } : { userId, role: member.role }];
  });
}

/**
 * One workspace's read sealed for following, or polled past `after`, for
 * the account the follow starts for, which every seal names, so one under
 * another's session is refused as signed out. A workspace the account no
 * longer reaches as the read asks is `gone`, and followed no longer, until
 * every window lets it go and one holds it anew.
 */
function workspaceSeal<Answer>(
  { dependencies, served, gate }: WorkspacesReach,
  seal: (
    userId: string,
    poll: boolean,
    after: string | undefined,
  ) => Effect.Effect<Answer | { readonly failure: string }, never, HttpClient.HttpClient>,
): WorkspaceSealed<Answer> {
  const userId = dependencies.accountId();
  return (poll, after) =>
    gate() && userId !== undefined
      ? Effect.map(served(seal(userId, poll, after)), (sealed) => {
          if (!isFailed(sealed)) return sealed;
          return {
            failure: sealed.failure,
            gone:
              sealed.failure === LIVE_SIGNED_OUT.failure ||
              sealed.failure === WORKSPACE_CALL_FAILURE.NOT_FOUND ||
              sealed.failure === WORKSPACE_CALL_FAILURE.NOT_PERMITTED,
          };
        })
      : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true });
}

/**
 * Each listed workspace's photo, by the workspace, told on the app state
 * every window draws its tiles from (`LIVE_READ.WORKSPACE_PHOTOS`): its
 * bytes as a `data:` URL under the version the workspaces carry, fetched
 * once per version as the version the view lists moves, a newer version's
 * fetch taking the place of one still out, and let go where a workspace
 * lists another version, none, or leaves the list. A fetch that did not
 * land is asked again as the workspaces next move.
 */
function workspacePhotos({ dependencies, served, gate }: WorkspacesReach) {
  return Effect.gen(function* () {
    const { kernel, client, tasks } = dependencies;
    let photos: AppWorkspacePhotos = NO_KEYS_HELD;
    /** Each workspace's photo fetch out, by the workspace. */
    const photoFetches = yield* FiberMap.make<string>();
    /** The version each photo fetch out asks for, by the workspace. */
    const photosAsked = new Map<string, string>();
    const tellPhotos = (next: AppWorkspacePhotos) => {
      photos = next;
      kernel.emit(GATEWAY_EVENT.WORKSPACE_PHOTOS_CHANGED, carried(photos));
    };
    /** `workspaceId`'s photo at `version` fetched and laid; nothing is laid where it did not land. */
    const photoFetched = (workspaceId: string, version: string) =>
      Effect.gen(function* () {
        const photo = yield* served(client.workspaces.photo(workspaceId));
        if (photosAsked.get(workspaceId) === version) photosAsked.delete(workspaceId);
        if (!photo.ok) return;
        const url = `data:${photo.answer.contentType};base64,${photo.answer.base64}`;
        tellPhotos({ ...photos, [workspaceId]: { rows: { version, url } } });
      });
    /** The photos of the workspaces the view lists now: each version neither held nor asked for fetched, and each no workspace lists at its version let go. */
    const photosListed = Effect.suspend(() => {
      if (!gate()) return Effect.void;
      const listed = new Map<string, string>();
      for (const each of tasks.view().workspaces) {
        if (each.photoVersion !== undefined) listed.set(each.id, each.photoVersion);
      }
      const held = Object.entries(photos).filter(
        ([workspaceId, read]) => listed.get(workspaceId) === read.rows?.version,
      );
      if (held.length !== Object.keys(photos).length) tellPhotos(Object.fromEntries(held));
      return Effect.gen(function* () {
        for (const workspaceId of [...photosAsked.keys()]) {
          if (listed.has(workspaceId)) continue;
          photosAsked.delete(workspaceId);
          yield* FiberMap.remove(photoFetches, workspaceId);
        }
        for (const [workspaceId, version] of listed) {
          if (photos[workspaceId]?.rows?.version === version) continue;
          if (photosAsked.get(workspaceId) === version) continue;
          photosAsked.set(workspaceId, version);
          yield* FiberMap.run(photoFetches, workspaceId, photoFetched(workspaceId, version));
        }
      });
    });
    const reset = Effect.gen(function* () {
      yield* FiberMap.clear(photoFetches);
      photosAsked.clear();
      tellPhotos(NO_KEYS_HELD);
    });
    return { photosListed, reset };
  });
}

/**
 * The workspaces one answer of the follow lists, drawn: a list of none said
 * failed and broken off; otherwise taken whole, kept on disk, and the
 * repository lists of each workspace whose GitHub installations moved asked
 * again.
 */
function workspacesAnswered(
  { dependencies }: WorkspacesReach,
  rows: WorkspaceRows,
  workspaces: readonly Workspace[],
) {
  return Effect.gen(function* () {
    const { tasks, kept } = dependencies;
    // Note that a list of none is said before anything is drawn or let go, so the last good list and its kept content stay.
    if (workspaces.length === 0) {
      tasks.draw({ workspacesStatus: TASKS_READ.FAILED });
      return yield* new LiveBroken({ reason: "the account holds no workspace" });
    }
    const view = tasks.view();
    const drawn = new Set(view.workspaces.map((each) => each.id));
    const installed = new Map(
      view.workspaces.map((each) => [each.id, JSON.stringify(each.githubInstallations ?? [])]),
    );
    // Note that a workspace whose GitHub installations moved reaches other repositories now, so its list is asked again.
    const reinstalled = new Set(
      workspaces
        .filter((each) => {
          const was = installed.get(each.id);
          return was !== undefined && was !== JSON.stringify(each.githubInstallations ?? []);
        })
        .map((each) => each.id),
    );
    const listed = new Set(workspaces.map((each) => each.id));
    // Note that a workspace leaving the list lets go of all content kept, since what was read in it is no longer the account's to read.
    if ([...drawn].some((id) => !listed.has(id))) yield* kept.clear;
    yield* rows.answer(workspaces);
    if (tasks.view().workspacesStatus !== TASKS_READ.READY) {
      tasks.draw({ workspacesStatus: TASKS_READ.READY });
    }
    yield* dependencies.entities()?.keep(KEPT_READ.WORKSPACES, workspaces) ?? Effect.void;
    if (reinstalled.size > 0) yield* tasks.repositoriesMovedIn(reinstalled);
  });
}

/**
 * Follows the account's workspaces over Realtime where nothing follows
 * them yet (`workspaces-follow.ts`), polled while Realtime fails them, and
 * draws each change as it lands, a teammate's and the browser's among
 * them. Note that there is no other read of them: a seal the service did
 * not answer, or a follow that stopped, is sealed again on
 * `FOLLOW_BACKOFF` while the gate stands open, and what was drawn stays meanwhile.
 * Every account holds its own workspace, which this read makes where none
 * stands, so a list of none is a failed read: said as failed, so each
 * surface shows its failure and reports it, and sealed again on the backoff.
 */
function workspacesFollowed(
  reach: WorkspacesReach,
  rows: () => WorkspaceRows,
  workspacesFollow: FiberHandle.FiberHandle<void>,
) {
  const { dependencies, served, gate } = reach;
  const { client, tasks } = dependencies;
  return Effect.gen(function* () {
    // Note that a list that answered none is sealed again at once on Retry, rather than after the backoff.
    const failed = tasks.view().workspacesStatus === TASKS_READ.FAILED;
    if (tasks.view().workspacesStatus !== TASKS_READ.READY) {
      tasks.draw({ workspacesStatus: TASKS_READ.READING });
    }
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
    const userId = dependencies.accountId();
    const seal = (poll: boolean, after?: string) =>
      userId === undefined
        ? Effect.succeed(LIVE_SIGNED_OUT)
        : served(
            client.workspaces.liveRead(WORKSPACES_READ, { userId }, poll ? { after } : undefined),
          );
    /** One seal followed until it stops, which fails it so the backoff seals it again. */
    const attempt = Effect.gen(function* () {
      const sealed = yield* seal(false);
      if ("failure" in sealed) return yield* Effect.fail(sealed.failure);
      const moves = workspacesMoves({ poll: (after) => seal(true, after) }, sealed);
      // A follow gone mid-way was refused as signed out by a poll, which no read mends either.
      const gone = yield* Stream.runForEach(moves, (workspaces) =>
        workspacesAnswered(reach, rows(), workspaces),
      ).pipe(
        Effect.as(false),
        Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
      );
      return yield* Effect.fail(gone ? LIVE_SIGNED_OUT.failure : WORKSPACE_CALL_FAILURE.UNANSWERED);
    });
    // A session that is no longer the account's is signed out, which no seal mends.
    const retried = attempt.pipe(
      Effect.retry({
        schedule: FOLLOW_BACKOFF,
        while: (why) => why !== LIVE_SIGNED_OUT.failure && gate(),
      }),
      Effect.ignore,
    );
    yield* FiberHandle.run(workspacesFollow, retried, { onlyIfMissing: !failed });
  });
}

/**
 * The account's workspaces in the sync engine's pool (`workspace-rows.ts`),
 * drawn on the view with every write standing over them, from a launch or a
 * sign-in until a sign-out closes their scope, so a rename still out for the
 * account signed out draws on nothing the next account sees; and their
 * follow, from the account gate opening until a sign-out.
 */
function workspaceList(reach: WorkspacesReach) {
  return Effect.gen(function* () {
    const { dependencies } = reach;
    const { tasks } = dependencies;
    const photos = yield* workspacePhotos(reach);
    /** The one follow of the account's workspaces, from the account gate opening, at a launch or a sign-in, until a sign-out. */
    const workspacesFollow = yield* FiberHandle.make<void>();
    const openWorkspaces = Effect.gen(function* () {
      const scope = yield* Scope.make();
      const rows = yield* Scope.provide(scope)(
        workspaceRows({
          pool: dependencies.pool,
          draw: (workspaces) =>
            Effect.andThen(
              Effect.sync(() => tasks.draw({ workspaces })),
              photos.photosListed,
            ),
        }),
      );
      return { scope, rows };
    });
    let list = yield* openWorkspaces;
    yield* Effect.addFinalizer(() => Scope.close(list.scope, Exit.void));

    const followed = workspacesFollowed(reach, () => list.rows, workspacesFollow);

    /** The workspaces as the entity store kept them, drawn as the service last answered them, only where nothing has answered them since. */
    const drawnFromDisk = Effect.gen(function* () {
      const workspaces = dependencies.entities()?.stored(KEPT_READ.WORKSPACES);
      // Note that a list of none, as a build before #6753 could keep, is no list: the follow's first answer draws one.
      if (
        workspaces !== undefined &&
        workspaces.length > 0 &&
        tasks.view().workspacesStatus !== TASKS_READ.READY
      ) {
        yield* list.rows.answer(workspaces);
        tasks.draw({ workspacesStatus: TASKS_READ.READY });
      }
    });

    return {
      /** The session's workspaces, which a write is drawn and sent through. */
      rows: () => list.rows,
      followed,
      drawnFromDisk,
      photosReset: photos.reset,
      /** The follow let go and the session's workspaces closed, a new session's opened in their place. */
      reset: Effect.gen(function* () {
        yield* FiberHandle.clear(workspacesFollow);
        yield* Scope.close(list.scope, Exit.void);
        list = yield* openWorkspaces;
      }),
    };
  });
}

/**
 * Each workspace's people the windows draw, and the few drawn latest, told
 * on the app state every window draws (`LIVE_READ.WORKSPACE_MEMBERS`):
 * followed from the first window's hold, so a surface drawn again draws
 * them from where they stand, in the sync engine's pool, where a member
 * write is drawn over them until the read carries it
 * (`workspace-members-read.ts`). A workspace the account no longer
 * reaches is followed no longer, until every window lets it go and one
 * holds it anew. Its pending invitations an owner's or an admin's windows
 * draw are held on the same terms, built again as each expires
 * (`workspace-invitations-read.ts`), as `LIVE_READ.WORKSPACE_INVITATIONS`.
 */
function workspacePeople(reach: WorkspacesReach) {
  return Effect.gen(function* () {
    const { dependencies, gate } = reach;
    const { kernel, client } = dependencies;
    const membersReads = yield* workspaceMembersReads({
      gate,
      seal: (workspaceId) =>
        workspaceSeal(reach, (userId, poll, after) =>
          client.workspaces.liveRead(
            WORKSPACE_MEMBERS_READ,
            { userId, workspaceId },
            poll ? { after } : undefined,
          ),
        ),
      tell: liveTold(kernel.emit, WORKSPACE_FOLLOWS.WORKSPACE_MEMBERS_FOLLOW),
      pool: dependencies.pool,
      entities: dependencies.entities,
    });
    const invitationsReads = yield* workspaceInvitationsReads({
      gate,
      seal: (workspaceId) =>
        workspaceSeal(reach, (userId, poll, after) =>
          client.workspaces.liveRead(
            WORKSPACE_INVITATIONS_READ,
            { userId, workspaceId },
            poll ? { after } : undefined,
          ),
        ),
      tell: liveTold(kernel.emit, WORKSPACE_FOLLOWS.WORKSPACE_INVITATIONS_FOLLOW),
      pool: dependencies.pool,
      entities: dependencies.entities,
    });
    return { membersReads, invitationsReads };
  });
}

/**
 * Each workspace's token repositories the windows draw, told on the app
 * state every window draws (`LIVE_READ.TOKEN_REPOSITORIES`): asked of the
 * service as a window first holds them, again as a window comes forward
 * and on Try again, and laid from each addition's or removal's own
 * answer, since nothing wakes them as a live read is woken.
 */
function workspaceTokenRepositories({ dependencies, served, gate }: WorkspacesReach) {
  return Effect.gen(function* () {
    const { kernel, client, tasks } = dependencies;
    /** The token repositories as the fetch last told them, which every addition or removal standing is drawn over as they are told. */
    let tokenRepositoriesFetched: AppTokenRepositories = NO_KEYS_HELD;
    const toldTokenRepositories = liveTold(
      kernel.emit,
      WORKSPACE_FOLLOWS.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW,
    );
    const tellTokenRepositories = (): void =>
      toldTokenRepositories(tokenRepositoryWritten.drawn(tokenRepositoriesFetched));
    const tokenRepositories = yield* heldFetch<typeof LIVE_READ.TOKEN_REPOSITORIES, string>({
      empty: NO_KEYS_HELD,
      path: (workspaceId) => [workspaceId],
      gate,
      focus: dependencies.focus,
      fetch: (workspaceId) =>
        Effect.map(served(client.workspaces.tokenRepositories(workspaceId)), (listed) =>
          listed.ok ? Option.some(listed.answer) : Option.none(),
        ),
      tell: (held: AppTokenRepositories) => {
        tokenRepositoriesFetched = held;
        tellTokenRepositories();
      },
    });
    /**
     * Each token repository added or removed, drawn over its workspace's
     * list at once and kept until the service answers the list
     * (`token-repository-writes.ts`).
     */
    const tokenRepositoryWritten: TokenRepositoryWrites = yield* tokenRepositoryWrites({
      pool: dependencies.pool,
      fetched: () => tokenRepositoriesFetched,
      tell: Effect.sync(() => tellTokenRepositories()),
      // Note that the workspace reaches other repositories once the service took the change, so its lists are woken with the answer, and only for the session it was asked in.
      answered: (workspaceId, repositories) =>
        Effect.andThen(
          tokenRepositories.answered(workspaceId, repositories),
          tasks.repositoriesMovedIn(new Set([workspaceId])),
        ),
    });
    /** A token repository added or removed, sent where the gate stands open. */
    const tokenRepositorySet = tokenRepositoryWritten.set<TasksWorkspaceTokenRepositoriesAnswer>(
      ({ workspaceId, repository, added }) =>
        gate()
          ? Effect.gen(function* () {
              const changed = yield* served(
                client.workspaces.setTokenRepository(workspaceId, repository, added),
              );
              if (!changed.ok) {
                return {
                  refused: {
                    failure: changed.failure,
                  },
                };
              }
              return {
                answer: {
                  repositories: changed.answer,
                },
                repositories: changed.answer,
              };
            })
          : Effect.succeed({
              refused: WORKSPACE_UNANSWERED,
            }),
      WORKSPACE_UNANSWERED,
    );
    return { tokenRepositories, tokenRepositoryWritten, tokenRepositorySet };
  });
}

/**
 * Each workspace's own integrations the windows draw, and the few drawn
 * latest, its Sentry installations and its Slack bot, told on the app state
 * every window draws (`LIVE_READ.WORKSPACE_INTEGRATIONS`): followed from
 * the first window's hold into the sync engine's pool, every write to them
 * drawn there the moment it is asked (`workspace-integrations-follow.ts`).
 * A workspace the account no longer reaches is followed no longer, until
 * every window lets it go and one holds it anew.
 *
 * The channels of each workspace's Slack team an owner's or an admin's
 * window lists, and the few listed latest, as Slack last listed them, are
 * told on the app state every window draws (`LIVE_READ.SLACK_CHANNELS`).
 * They are Slack's own, which no row carries, so the host asks for them
 * (`held-fetch.ts`): as a window holds them, as one comes forward, as the
 * workspace's bot is connected or disconnected, and on Try again; a
 * channel write lays the channels its answer carries. Each channel's
 * repository is the workspace's held integrations', so none is kept here,
 * and an ask that did not land keeps the channels last listed.
 */
function workspaceIntegrations({ dependencies, served, gate }: WorkspacesReach) {
  return Effect.gen(function* () {
    const { kernel, client } = dependencies;
    const slackChannels = yield* heldFetch<typeof LIVE_READ.SLACK_CHANNELS, string>({
      empty: NO_KEYS_HELD,
      path: (workspaceId) => [workspaceId],
      gate,
      focus: dependencies.focus,
      fetch: (workspaceId) =>
        gate()
          ? Effect.map(served(client.workspaces.slackBot(workspaceId)), (read) => {
              if (!read.ok) return Option.none();
              // Note that a bot not connected is in no channel, and one whose channels Slack did not list keeps those it last listed.
              if (read.answer.team === undefined) return Option.some([]);
              return Option.fromNullishOr(read.answer.channels).pipe(
                Option.map((channels) => channels.map(listedChannel)),
              );
            })
          : Effect.succeed(Option.none()),
      tell: liveTold(kernel.emit, WORKSPACE_FOLLOWS.WORKSPACE_SLACK_CHANNELS_FOLLOW),
    });
    const integrations = yield* heldWorkspaceIntegrations({
      seal: (workspaceId, userId, poll, after) =>
        gate()
          ? Effect.map(
              served(
                client.workspaces.liveRead(
                  WORKSPACE_INTEGRATIONS_READ,
                  { userId, workspaceId },
                  poll ? { after } : undefined,
                ),
              ),
              (sealed) => {
                if (!isFailed(sealed)) return sealed;
                return {
                  failure: sealed.failure,
                  gone:
                    sealed.failure === LIVE_SIGNED_OUT.failure ||
                    sealed.failure === WORKSPACE_CALL_FAILURE.NOT_FOUND,
                };
              },
            )
          : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
      accountId: dependencies.accountId,
      gate,
      pool: dependencies.pool,
      slackMoved: (workspaceId) => slackChannels.wake((held) => held === workspaceId),
      tell: liveTold(kernel.emit, WORKSPACE_FOLLOWS.WORKSPACE_INTEGRATIONS_FOLLOW),
    });
    return { slackChannels, integrations };
  });
}

/**
 * Whether the account's GitHub is connected, drawn on the view: read as the
 * gate opens, and again where the last read is older than its bound
 * (`GITHUB_READ_EVERY`). When it was last asked, none since a sign-out; and
 * the latest read started, which a sign-out and a disconnection also move
 * past, so a read that answers after either is dropped.
 */
function githubStanding({ dependencies, served, gate }: WorkspacesReach) {
  return Effect.gen(function* () {
    const { client, tasks } = dependencies;
    let githubAskedAt: number | undefined;
    let githubRead = 0;
    /** Reads whether the account's GitHub is connected; a failed read keeps what it last read. */
    const readGithub = Effect.gen(function* () {
      githubRead += 1;
      const read = githubRead;
      githubAskedAt = yield* Clock.currentTimeMillis;
      const status = yield* served(client.github.status());
      if (read === githubRead && !("failure" in status)) tasks.draw({ github: status });
    });
    /** Reads the connection where none was asked for since a sign-out, or the last ask is older than its bound. */
    const readGithubWhenStale = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const fresh =
        githubAskedAt !== undefined && now - githubAskedAt < Duration.toMillis(GITHUB_READ_EVERY);
      if (!fresh) yield* readGithub;
    });
    /** The read of GitHub's connection the gate opening starts beside the follows, so a sign-in waits on none of it. */
    const githubOpened = yield* FiberHandle.make<void>();
    const acts: Pick<HostActTable<typeof TASKS_ACTS>, "GITHUB_CONNECT" | "GITHUB_DISCONNECT"> = {
      // The browser connects or disconnects GitHub, so the panel coming
      // forward again reads the connection whatever the bound says.
      GITHUB_CONNECT: () =>
        Effect.gen(function* () {
          if (!gate()) return GITHUB_PAGE_UNANSWERED;
          const page = yield* served(client.github.connect());
          githubAskedAt = undefined;
          return "failure" in page ? GITHUB_PAGE_UNANSWERED : { url: page.url };
        }),
      // The view takes the connection the service answers at once, so Settings
      // reads disconnected without waiting for the next read of it. Note that
      // GitHub as the last way to sign in is refused in words that say so.
      GITHUB_DISCONNECT: () =>
        Effect.gen(function* () {
          if (!gate()) return yield* new ActRefused({});
          const disconnected = yield* served(client.github.disconnect());
          githubAskedAt = undefined;
          // Note that GitHub's standing as an integration is asked again before the answer, so the window draws it from the held read as the answer lands.
          yield* dependencies.githubMoved;
          if ("failure" in disconnected) {
            return yield* new ActRefused(
              disconnected.failure === GITHUB_DISCONNECT_FAILURE.NOT_PERMITTED
                ? { sentence: GITHUB_LAST_SIGN_IN_REFUSAL }
                : {},
            );
          }
          // Note that a read started before the answer is made stale, because
          // the status it read may predate the unlink.
          githubRead += 1;
          tasks.draw({ github: disconnected });
        }),
    };
    return {
      readGithubWhenStale,
      acts,
      opened: FiberHandle.run(githubOpened, readGithubWhenStale, { onlyIfMissing: true }),
      reset: Effect.gen(function* () {
        yield* FiberHandle.clear(githubOpened);
      }),
      /** The reads asked so far let go, so the next is asked anew and none still out lands. */
      forgotten: Effect.sync(() => {
        githubAskedAt = undefined;
        githubRead += 1;
      }),
    };
  });
}

/** The admin dashboard's asks. */
function adminActs({
  dependencies,
  served,
  gate,
}: WorkspacesReach): Pick<HostActTable<typeof TASKS_ACTS>, "ADMIN_READ" | "ADMIN_FAVORITE"> {
  const { client } = dependencies;
  return {
    // An admin read is answered to the caller as the service answered it and
    // held nowhere, since it is other accounts' data, which no view keeps.
    ADMIN_READ: (read) =>
      gate() ? served(client.admin.read(read)) : Effect.succeed({ refused: ADMIN_UNANSWERED }),
    ADMIN_FAVORITE: (read) =>
      gate() ? served(client.admin.favorite(read.id, read.favorite)) : Effect.succeed(false),
  };
}

/** Every read and write a workspace's acts and held reads reach. */
interface WorkspaceParts {
  readonly list: Effect.Success<ReturnType<typeof workspaceList>>;
  readonly people: Effect.Success<ReturnType<typeof workspacePeople>>;
  readonly tokens: Effect.Success<ReturnType<typeof workspaceTokenRepositories>>;
  readonly integrated: Effect.Success<ReturnType<typeof workspaceIntegrations>>;
}

/**
 * A workspace write's call carried to the service where the gate stands
 * open: the workspace as it then stands, or why it refused.
 */
function workspaceWritten(
  { served, gate }: WorkspacesReach,
  call: Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient>,
): Effect.Effect<WorkspaceWritten<TasksWorkspaceAnswer>> {
  if (!gate()) {
    return Effect.succeed({ refused: WORKSPACE_UNANSWERED });
  }
  return Effect.map(served(call), (written) =>
    written.ok
      ? {
          answer: { workspace: written.answer },
          workspace: written.answer,
        }
      : { refused: { failure: written.failure } },
  );
}

/**
 * A member write's call carried to the service where the gate stands open:
 * the members it answers, and what it says of each of `userIds`, or why it
 * refused.
 */
function memberWritten(
  { served, gate }: WorkspacesReach,
  call: Effect.Effect<
    WorkspaceCallResult<readonly WorkspaceMember[]>,
    never,
    HttpClient.HttpClient
  >,
  userIds: readonly string[],
): Effect.Effect<MemberWritten<TasksWorkspaceMembersAnswer>> {
  if (!gate()) {
    return Effect.succeed({
      refused: WORKSPACE_UNANSWERED,
    });
  }
  return Effect.map(served(call), (written) =>
    written.ok
      ? {
          answer: { members: written.answer },
          moved: membersMoved(written.answer, userIds),
        }
      : { refused: { failure: written.failure } },
  );
}

/**
 * The workspace's own acts: one made, renamed, given a slug, an experiment,
 * or a photo, handed over, or left. Note that a rename, a slug, and an
 * experiment are drawn at once and kept until the follow moves them
 * (`workspace-rows.ts`), a slug another workspace holds refused and taken
 * back.
 */
function workspaceRowActs(
  reach: WorkspacesReach,
  { list, people }: WorkspaceParts,
): Pick<
  HostActTable<typeof WORKSPACE_ACTS>,
  | "WORKSPACE_CREATE"
  | "WORKSPACE_RENAME"
  | "WORKSPACE_SLUG_SET"
  | "WORKSPACE_EXPERIMENT_SET"
  | "WORKSPACE_PHOTO_SET"
  | "WORKSPACE_TRANSFER"
  | "WORKSPACE_LEAVE"
> {
  const { dependencies, served, gate } = reach;
  const { client } = dependencies;
  /** A workspace renamed, its name drawn at once and kept until the follow moves it. */
  const workspaceRenamed = workspaceWrite<
    TasksWorkspaceRenameParams & AskedOver,
    TasksWorkspaceAnswer
  >({
    workspaceId: ({ workspaceId }) => workspaceId,
    change:
      ({ name }) =>
      (row) => ({ ...row, name }),
    send: ({ workspaceId, name }) =>
      workspaceWritten(reach, client.workspaces.rename(workspaceId, name)),
    unsent: WORKSPACE_UNANSWERED,
  });
  /** A workspace's slug changed, drawn at once and kept until the follow moves it; a slug another workspace holds is refused and taken back. */
  const workspaceSlugSet = workspaceWrite<
    TasksWorkspaceSlugSetParams & AskedOver,
    TasksWorkspaceAnswer
  >({
    workspaceId: ({ workspaceId }) => workspaceId,
    change:
      ({ slug }) =>
      (row) => ({ ...row, slug }),
    send: ({ workspaceId, slug }) =>
      workspaceWritten(reach, client.workspaces.setSlug(workspaceId, slug)),
    unsent: WORKSPACE_UNANSWERED,
  });
  /**
   * One experiment turned on or off for everyone in a workspace, drawn at once
   * as the member's own change, now, and kept until the follow moves the
   * workspace; one the service refuses, as it refuses a member who is no
   * admin, is taken back. Note that the drawn choices stay in the order the
   * live row lists them, by key, so the row the follow carries reads the same.
   */
  const workspaceExperimentSet = workspaceWrite<
    TasksWorkspaceExperimentSetParams & AskedOver,
    TasksWorkspaceAnswer
  >({
    workspaceId: ({ workspaceId }) => workspaceId,
    change:
      ({ experiment, on }) =>
      (row) => {
        const member = dependencies.member();
        const changedBy = member === undefined ? null : { id: member.userId, name: member.name };
        const chosen = { experiment, on, changedBy, changedAt: dependencies.kernel.now() };
        const others = (row.experiments ?? []).filter((each) => each.experiment !== experiment);
        return {
          ...row,
          experiments: [...others, chosen].toSorted((a, b) =>
            a.experiment < b.experiment ? -1 : a.experiment > b.experiment ? 1 : 0,
          ),
        };
      },
    send: ({ workspaceId, experiment, on }) =>
      Effect.tap(
        workspaceWritten(reach, client.workspaces.setExperiment(workspaceId, experiment, on)),
        (written) =>
          Effect.sync(() => {
            if (!("workspace" in written) || !isExperiment(experiment)) return;
            dependencies.recordProductEvent(PRODUCT_EVENT.EXPERIMENT_TOGGLE, {
              experiment: EXPERIMENT_COUNTED_AS[experiment],
              setting_value: on ? PRODUCT_SETTING_VALUE.ON : PRODUCT_SETTING_VALUE.OFF,
              experiment_scope: EXPERIMENT_SCOPE_COUNTED_AS[experimentScope(experiment)],
            });
          }),
      ),
    unsent: WORKSPACE_UNANSWERED,
  });
  return {
    WORKSPACE_CREATE: ({ name }) =>
      Effect.gen(function* () {
        if (!gate()) return yield* workspaceRefused(WORKSPACE_UNANSWERED.failure);
        const made = yield* served(client.workspaces.create(name));
        return yield* workspaceAnswered("workspace")(
          made.ok ? { workspace: made.answer } : { failure: made.failure },
        );
      }),
    // A rename moves no task: its name is drawn at once, and the follow
    // carries the same name a moment later.
    WORKSPACE_RENAME: declaredWrite(dependencies.pool, workspaceRenamed, {
      read: (rename: TasksWorkspaceRenameParams) =>
        Effect.succeed({ ...rename, rows: list.rows() }),
      answered: workspaceAnswered("workspace"),
    }),
    // A slug moves no task either: links resolve by id, or by a former
    // slug the workspace keeps, so it is drawn at once as a rename is.
    WORKSPACE_SLUG_SET: declaredWrite(dependencies.pool, workspaceSlugSet, {
      read: (slugSet: TasksWorkspaceSlugSetParams) =>
        Effect.succeed({ ...slugSet, rows: list.rows() }),
      answered: workspaceAnswered("workspace"),
    }),
    // An experiment moves no task: the choice is drawn on its workspace at
    // once, and the follow carries the same choice a moment later.
    WORKSPACE_EXPERIMENT_SET: declaredWrite(dependencies.pool, workspaceExperimentSet, {
      read: (set: TasksWorkspaceExperimentSetParams) =>
        Effect.succeed({ ...set, rows: list.rows() }),
      answered: workspaceAnswered("workspace"),
    }),
    // A photo moves no task either, but it uploads, so its workspace is
    // drawn once the service answers it, its photo's new version or none,
    // and the photo at that version is fetched for the windows' tiles
    // (`photosListed`).
    WORKSPACE_PHOTO_SET: ({ workspaceId, photo }) =>
      Effect.gen(function* () {
        if (!gate()) return yield* workspaceRefused(WORKSPACE_UNANSWERED.failure);
        const written = yield* served(client.workspaces.setPhoto(workspaceId, photo));
        if (!written.ok) return yield* workspaceRefused(written.failure);
        yield* list.rows().answered(written.answer);
        return written.answer;
      }),
    // Note that a handover changes the account's own role in the workspace,
    // which the view's workspaces carry and every owner's and admin's act is
    // drawn from, and which the follow carries; it moves no task. The heir's
    // role and the account's own are drawn from its answer until the
    // people's read carries them.
    WORKSPACE_TRANSFER: ({ workspaceId, userId }) =>
      Effect.gen(function* () {
        if (!gate()) return yield* workspaceRefused(WORKSPACE_UNANSWERED.failure);
        const handedOver = yield* served(client.workspaces.transfer(workspaceId, userId));
        if (!handedOver.ok) return yield* workspaceRefused(handedOver.failure);
        yield* people.membersReads.moved(
          workspaceId,
          membersMoved(handedOver.answer, [userId, dependencies.accountId()]),
        );
        return handedOver.answer;
      }),
    // Note that a leave closes the open task where it is that workspace's, as
    // a delete of it does, because the account can no longer read or write a
    // task of a workspace it left; a refused leave closes nothing. The
    // account is drawn gone from the workspace's people, which its read,
    // ended as the account no longer reaches it, never takes back.
    WORKSPACE_LEAVE: ({ workspaceId }) =>
      Effect.gen(function* () {
        if (!gate()) return yield* workspaceRefused(WORKSPACE_UNANSWERED.failure);
        const open = dependencies.tasks.openTaskLeaving();
        const leave = Effect.tap(client.workspaces.leave(workspaceId), (answer) =>
          answer.ok && open.workspaceId === workspaceId ? open.close : Effect.void,
        );
        const left = yield* served(leave);
        if (!left.ok) return yield* workspaceRefused(left.failure);
        const readerId = dependencies.accountId();
        if (readerId !== undefined) {
          yield* people.membersReads.moved(workspaceId, [{ userId: readerId, gone: true }]);
        }
      }),
  };
}

/** A workspace's people's acts: a member's role changed or removed, and an invitation made or canceled. */
function workspacePeopleActs(
  reach: WorkspacesReach,
  { people }: WorkspaceParts,
): Pick<
  HostActTable<typeof WORKSPACE_ACTS>,
  | "WORKSPACE_MEMBER_REMOVE"
  | "WORKSPACE_MEMBER_ROLE"
  | "WORKSPACE_INVITE"
  | "WORKSPACE_INVITATION_CANCEL"
> {
  const { dependencies, served, gate } = reach;
  const { client } = dependencies;
  const { membersReads, invitationsReads } = people;
  /** A member's role changed, drawn on their row at once, kept until the people's read carries it. */
  const memberRoleChanged = membersReads.write<
    TasksWorkspaceMemberRoleParams,
    TasksWorkspaceMembersAnswer
  >({
    workspaceId: ({ workspaceId }) => workspaceId,
    moves: ({ userId, role }) => [{ userId, role }],
    send: ({ workspaceId, userId, role }) =>
      memberWritten(reach, client.workspaces.changeRole(workspaceId, userId, role), [userId]),
  });
  /** A member removed, drawn gone at once, kept until the people's read no longer carries them. */
  const memberRemoved = membersReads.write<
    TasksWorkspaceMemberRemoveParams,
    TasksWorkspaceMembersAnswer
  >({
    workspaceId: ({ workspaceId }) => workspaceId,
    moves: ({ userId }) => [{ userId, gone: true }],
    send: ({ workspaceId, userId }) =>
      memberWritten(reach, client.workspaces.removeMember(workspaceId, userId), [userId]),
  });
  /**
   * An invitation canceled, drawn gone at once, kept until the invitations'
   * read no longer carries it. Note that the list it answers is never laid
   * whole, since the read alone says what stands.
   */
  const invitationCanceled = invitationsReads.cancel<TasksWorkspaceInvitationsAnswer>(
    ({ workspaceId, invitationId }) =>
      gate()
        ? Effect.map(
            served(client.workspaces.cancelInvitation(workspaceId, invitationId)),
            (pending) =>
              pending.ok
                ? {
                    answer: { invitations: pending.answer },
                  }
                : { refused: { failure: pending.failure } },
          )
        : Effect.succeed({ refused: WORKSPACE_UNANSWERED }),
  );
  return {
    WORKSPACE_MEMBER_REMOVE: declaredWrite(dependencies.pool, memberRemoved, {
      answered: workspaceAnswered("members"),
    }),
    // A role changed moves no task; the people's read carries it, as a
    // removal's, drawn at once until then.
    WORKSPACE_MEMBER_ROLE: declaredWrite(dependencies.pool, memberRoleChanged, {
      answered: workspaceAnswered("members"),
    }),
    // An invitation made or canceled moves no workspace or task, so nothing
    // else is read with it; the invitations' read carries it, an invitation
    // made drawn from its answer until then where a window holds them.
    WORKSPACE_INVITE: ({ workspaceId, email, role }) =>
      Effect.gen(function* () {
        if (!gate()) return yield* workspaceRefused(WORKSPACE_UNANSWERED.failure);
        const made = yield* served(client.workspaces.invite(workspaceId, email, role));
        if (!made.ok) return yield* workspaceRefused(made.failure);
        yield* invitationsReads.made(workspaceId, made.answer);
        return made.answer;
      }),
    WORKSPACE_INVITATION_CANCEL: declaredWrite(dependencies.pool, invitationCanceled, {
      answered: workspaceAnswered("invitations"),
    }),
  };
}

/** A workspace's connections' acts: GitHub's organization, Sentry, and the Slack bot. */
function workspaceConnectionActs(
  { dependencies, served, gate }: WorkspacesReach,
  { integrated }: WorkspaceParts,
): Pick<
  HostActTable<typeof WORKSPACE_ACTS>,
  | "WORKSPACE_GITHUB_CONNECT"
  | "WORKSPACE_GITHUB_DISCONNECT"
  | "WORKSPACE_SENTRY_INSTALL"
  | "WORKSPACE_SENTRY_DISCONNECT"
  | "WORKSPACE_SLACK_BOT_CONNECT"
  | "WORKSPACE_SLACK_BOT_DISCONNECT"
> {
  const { client } = dependencies;
  return {
    // The install address is answered to the procedure that opens it and
    // held nowhere: the connection lands in the browser, and the follow
    // carries the organization.
    WORKSPACE_GITHUB_CONNECT: ({ workspaceId }) =>
      Effect.gen(function* () {
        if (!gate()) return yield* workspaceRefused(WORKSPACE_UNANSWERED.failure);
        const begun = yield* served(client.workspaces.githubConnect(workspaceId));
        if (!begun.ok) return yield* workspaceRefused(begun.failure);
        return begun.answer;
      }),
    WORKSPACE_GITHUB_DISCONNECT: ({ workspaceId }) =>
      Effect.gen(function* () {
        if (!gate()) return yield* workspaceRefused(WORKSPACE_UNANSWERED.failure);
        const disconnected = yield* served(client.workspaces.githubDisconnect(workspaceId));
        if (!disconnected.ok) return yield* workspaceRefused(disconnected.failure);
      }),
    // Sentry's install address is answered to the procedure that opens it
    // and held nowhere: the install lands in the browser.
    WORKSPACE_SENTRY_INSTALL: ({ workspaceId }) =>
      Effect.gen(function* () {
        if (!gate()) return yield* workspaceRefused(WORKSPACE_UNANSWERED.failure);
        const begun = yield* served(client.workspaces.sentryInstall(workspaceId));
        if (!begun.ok) return yield* workspaceRefused(begun.failure);
        return begun.answer;
      }),
    WORKSPACE_SENTRY_DISCONNECT: declaredWrite(
      dependencies.pool,
      sentryDisconnect(({ workspaceId, installationId }) =>
        gate()
          ? Effect.map(
              served(client.workspaces.sentryDisconnect(workspaceId, installationId)),
              (sentry): TasksWorkspaceSentryAnswer =>
                sentry.ok ? { sentry: sentry.answer } : { failure: sentry.failure },
            )
          : Effect.succeed(WORKSPACE_UNANSWERED),
      ),
      { answered: workspaceAnswered("sentry") },
    ),
    WORKSPACE_SLACK_BOT_CONNECT: ({ workspaceId }) =>
      Effect.gen(function* () {
        if (!gate()) return yield* workspaceRefused(WORKSPACE_UNANSWERED.failure);
        const connected = yield* served(client.workspaces.slackBotConnect(workspaceId));
        // Note that the bot's row is known only once Slack named its team, so the answer waits for the held read to carry it, and the window draws the team as the answer lands.
        if (connected.ok)
          yield* integrated.integrations.confirmed(workspaceId, connected.answer.txid);
        return yield* workspaceAnswered("slackBot")(slackBotAnswered(slackBotOf(connected)));
      }),
    WORKSPACE_SLACK_BOT_DISCONNECT: declaredWrite(
      dependencies.pool,
      slackBotDisconnect(({ workspaceId }) =>
        gate()
          ? Effect.map(served(client.workspaces.slackBotDisconnect(workspaceId)), slackBotOf)
          : Effect.succeed(WORKSPACE_UNANSWERED),
      ),
      { answered: workspaceAnswered("slackBot") },
    ),
  };
}

/** A workspace's settings' acts: the Slack bot's notifications, repository, and channels, and a token repository added or removed. */
function workspaceSettingActs(
  { dependencies, served, gate }: WorkspacesReach,
  { integrated, tokens }: WorkspaceParts,
): Pick<
  HostActTable<typeof WORKSPACE_ACTS>,
  | "WORKSPACE_SLACK_BOT_NOTIFICATIONS"
  | "WORKSPACE_SLACK_BOT_REPOSITORY"
  | "WORKSPACE_SLACK_BOT_CHANNEL"
  | "WORKSPACE_TOKEN_REPOSITORY_SET"
> {
  const { client } = dependencies;
  const { slackChannels } = integrated;
  return {
    // Note that the switch lives on the account's preferences row, so it is drawn over that row at once, whichever workspace's Settings turned it.
    WORKSPACE_SLACK_BOT_NOTIFICATIONS: declaredWrite(
      dependencies.pool,
      slackNotificationsWritten(
        (write) =>
          gate()
            ? Effect.map(
                served(
                  client.workspaces.slackBotNotifications(write.workspaceId, write.notifications),
                ),
                slackBotOf,
              )
            : Effect.succeed(WORKSPACE_UNANSWERED),
        dependencies.accountId,
      ),
      { answered: workspaceAnswered("slackBot") },
    ),
    WORKSPACE_SLACK_BOT_REPOSITORY: declaredWrite(
      dependencies.pool,
      slackBotRepository((repository) =>
        gate()
          ? Effect.map(served(client.workspaces.slackBotRepository(repository)), slackBotOf)
          : Effect.succeed(WORKSPACE_UNANSWERED),
      ),
      { answered: workspaceAnswered("slackBot") },
    ),
    // Note that whether the bot is in a channel is Slack's own, so the channels a write's answer carries are laid on the held list, and asked again where it carries none.
    WORKSPACE_SLACK_BOT_CHANNEL: declaredWrite(
      dependencies.pool,
      slackBotChannel(
        (channel) =>
          gate()
            ? Effect.map(served(client.workspaces.slackBotChannel(channel)), slackBotOf)
            : Effect.succeed(WORKSPACE_UNANSWERED),
        ({ workspaceId }, answer) => {
          if (!("slackBot" in answer)) return Effect.void;
          const { channels } = answer.slackBot;
          return channels === undefined
            ? slackChannels.wake((held) => held === workspaceId)
            : slackChannels.answered(workspaceId, channels.map(listedChannel));
        },
      ),
      { answered: workspaceAnswered("slackBot") },
    ),
    // An addition is drawn as the reader's own, newest first and removable,
    // until the service answers the list as it then stands.
    WORKSPACE_TOKEN_REPOSITORY_SET: declaredWrite(dependencies.pool, tokens.tokenRepositorySet, {
      read: (set: TasksWorkspaceTokenRepositorySetParams) =>
        Effect.map(Clock.currentTimeMillis, (addedAt) => ({
          ...set,
          addedBy: dependencies.accountId() ?? "",
          addedAt,
          session: tokens.tokenRepositoryWritten.session(),
        })),
      answered: workspaceAnswered("repositories"),
    }),
  };
}

/** A workspace call asked where the gate stands open, answering its answer or refused for why not (`workspaceRefused`). */
function workspaceAsked<Answer>(
  { served, gate }: WorkspacesReach,
  call: Effect.Effect<WorkspaceCallResult<Answer>, never, HttpClient.HttpClient>,
): Effect.Effect<Answer, ActRefused> {
  return Effect.gen(function* () {
    if (!gate()) return yield* workspaceRefused(WORKSPACE_UNANSWERED.failure);
    const asked = yield* served(call);
    if (!asked.ok) return yield* workspaceRefused(asked.failure);
    return asked.answer;
  });
}

/** A workspace's environment's acts: its variables' names listed, and one put or deleted. */
function workspaceEnvironmentActs(
  reach: WorkspacesReach,
): Pick<
  HostActTable<typeof WORKSPACE_ACTS>,
  "WORKSPACE_ENVIRONMENT_LIST" | "WORKSPACE_ENVIRONMENT_PUT" | "WORKSPACE_ENVIRONMENT_DELETE"
> {
  const { client } = reach.dependencies;
  // Note that the environment is asked of the service on each act and held
  // nowhere here, because no answer carries a value and Settings reads the
  // names again after each write.
  return {
    WORKSPACE_ENVIRONMENT_LIST: ({ workspaceId }) =>
      workspaceAsked(reach, client.workspaces.environment(workspaceId)),
    WORKSPACE_ENVIRONMENT_PUT: ({ workspaceId, name, value }) =>
      workspaceAsked(reach, client.workspaces.putVariable(workspaceId, name, value)),
    WORKSPACE_ENVIRONMENT_DELETE: ({ workspaceId, name }) =>
      workspaceAsked(reach, client.workspaces.deleteVariable(workspaceId, name)),
  };
}

/** The per-workspace reads the windows hold (`WORKSPACE_FOLLOWS`), each by the workspace its key names. */
function workspaceFollowActs({
  people,
  tokens,
  integrated,
}: WorkspaceParts): HostActTable<typeof WORKSPACE_FOLLOWS> {
  const { membersReads, invitationsReads } = people;
  const { integrations, slackChannels } = integrated;
  const { tokenRepositories } = tokens;
  return {
    // A workspace's people.
    WORKSPACE_MEMBERS_FOLLOW: {
      hold: ({ workspaceId }) => membersReads.held.hold(workspaceId),
      retry: ({ workspaceId }) => membersReads.held.retry(workspaceId),
    },
    // A workspace's invitations, held for an owner's or an admin's window while it draws them, as its people are.
    WORKSPACE_INVITATIONS_FOLLOW: {
      hold: ({ workspaceId }) => invitationsReads.held.hold(workspaceId),
      retry: ({ workspaceId }) => invitationsReads.held.retry(workspaceId),
    },
    // A workspace's own integrations.
    WORKSPACE_INTEGRATIONS_FOLLOW: {
      hold: ({ workspaceId }) => integrations.hold(workspaceId),
      retry: ({ workspaceId }) => integrations.retry(workspaceId),
    },
    // A workspace's Slack channels, held for an owner's or an admin's windows while they list them, on the terms its integrations are held.
    WORKSPACE_SLACK_CHANNELS_FOLLOW: {
      hold: ({ workspaceId }) => slackChannels.hold(workspaceId),
      retry: ({ workspaceId }) => slackChannels.retry(workspaceId),
    },
    // A workspace's token repositories; each change's own answer is laid there too.
    WORKSPACE_TOKEN_REPOSITORIES_FOLLOW: {
      hold: ({ workspaceId }) => tokenRepositories.hold(workspaceId),
      retry: ({ workspaceId }) => tokenRepositories.retry(workspaceId),
    },
  };
}

/**
 * The workspaces, GitHub's connection, and the admin dashboard, as one
 * concern beside the tasks: the workspaces followed from the account gate
 * opening, whether or not a window shows them, and each per-workspace read
 * from a window's first hold. Behind a closed account gate, or on a run that
 * sends nothing, nothing is read.
 */
export const composeWorkspaces = /* @__PURE__ */ Effect.fn("host/composeWorkspaces")(function* (
  dependencies: WorkspacesDependencies,
): Effect.fn.Return<WorkspacesComposer, never, Scope.Scope | HttpClient.HttpClient> {
  const { kernel, account } = dependencies;
  const http = yield* HttpClient.HttpClient;
  const reach: WorkspacesReach = {
    dependencies,
    served: (call) => Effect.provideService(call, HttpClient.HttpClient, http),
    gate: () => kernel.runMode.sendsNetwork && account.capabilitiesActive(),
  };
  const { gate } = reach;
  const list = yield* workspaceList(reach);
  const people = yield* workspacePeople(reach);
  const tokens = yield* workspaceTokenRepositories(reach);
  const integrated = yield* workspaceIntegrations(reach);
  const github = yield* githubStanding(reach);
  const parts: WorkspaceParts = { list, people, tokens, integrated };

  const methods: HostMethodTable = {
    // The panel coming forward, which may follow GitHub connected in the
    // browser, reads the connection no oftener than the bound allows; the
    // workspaces are followed and need no read. It is also the host's one
    // word that a window came forward, which every read asked again on
    // focus hears (`window-focus.ts`).
    [GATEWAY_METHOD.WORKSPACES_REFRESH]: () =>
      Effect.gen(function* () {
        yield* dependencies.focus.raise;
        if (gate()) yield* github.readGithubWhenStale;
        return {};
      }),
  };

  return {
    acts: {
      ...workspaceRowActs(reach, parts),
      ...workspacePeopleActs(reach, parts),
      ...workspaceConnectionActs(reach, parts),
      ...workspaceSettingActs(reach, parts),
      ...workspaceEnvironmentActs(reach),
      ...github.acts,
      ...adminActs(reach),
      ...workspaceFollowActs(parts),
    },
    methods,
    // The gate opening follows the account's workspaces, so they load after
    // a launch or a sign-in with no window asking; GitHub's connection is
    // read beside them where the last read is stale.
    open: Effect.gen(function* () {
      yield* people.membersReads.held.open;
      yield* people.invitationsReads.held.open;
      yield* tokens.tokenRepositories.open;
      yield* integrated.integrations.open;
      yield* integrated.slackChannels.open;
      if (!gate()) return;
      yield* list.drawnFromDisk;
      yield* list.followed;
      yield* github.opened;
    }),
    refreshed: Effect.andThen(list.followed, github.readGithubWhenStale),
    reset: Effect.gen(function* () {
      // Note that the session's token repository writes are let go first, so none still out lays its answer while the rest of the reset runs.
      yield* tokens.tokenRepositoryWritten.letGo;
      // Note that the windows' holds on people, token repositories, and invitations stand through a sign-out, so a session signing in follows them anew (`open`).
      yield* people.membersReads.held.end;
      yield* people.invitationsReads.held.end;
      yield* list.photosReset;
      yield* tokens.tokenRepositories.end;
      yield* integrated.integrations.end;
      yield* integrated.slackChannels.end;
      yield* list.reset;
      yield* github.reset;
      yield* github.forgotten;
    }),
    // Every read of the workspaces is an ask's, or a held read's, which stands in the composer's own scope.
    lifetime: Effect.void,
  };
});
