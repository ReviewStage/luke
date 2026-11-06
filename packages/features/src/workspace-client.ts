import { HTTP_METHOD, type UnparsedWireValue, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountCall,
  type CallCredential,
  callAnswered,
  jsonOf,
} from "./account-call.js";
import type { WorkspaceTokenRepository } from "./github-repositories-wire.js";
import { hostedCall } from "./hosted-call.js";
import { spelledFailure } from "./hosted-failure.js";
import { askLive, type HostedClient, type HostedFailure, hostedClient } from "./hosted-link.js";
import { type ImageBody, imageBodyOf } from "./image-body.js";
import { LIVE_SIGNED_OUT, LIVE_USER_QUERY } from "./live-wire.js";
import {
  type WorkspaceSentry,
  workspaceSentryDisconnectRequestSchema,
  workspaceSentryRequestSchema,
} from "./sentry-install-wire.js";
import { workspacePhotoPath } from "./service-paths.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";
import {
  WORKSPACE_SLACK_BOT_QUERY,
  type WorkspaceSlackBot,
  workspaceSlackBotChannelRequestSchema,
  workspaceSlackBotNotificationsRequestSchema,
  workspaceSlackBotRepositoryRequestSchema,
  workspaceSlackBotRequestSchema,
} from "./slack-bot-wire.js";
import type { TaskCallResult } from "./task-client.js";
import {
  WORKSPACE_CALL_FAILURE,
  WORKSPACE_RENAMES,
  type WorkspaceCallFailure,
  type WorkspaceCallResult,
} from "./workspace-call.js";
import type { WorkspaceIntegrationsLiveAnswer } from "./workspace-integrations-live.js";
import {
  type WorkspaceInvitation,
  workspaceInvitationCancelSchema,
  workspaceInviteRequestSchema,
} from "./workspace-invitation-wire.js";
import type {
  WorkspaceInvitationsLiveAnswer,
  WorkspaceMembersLiveAnswer,
  WorkspacesLiveAnswer,
} from "./workspace-live.js";
import {
  type Workspace,
  type WorkspaceMember,
  type WorkspacePhotoType,
  workspaceCreateRequestSchema,
  workspaceGithubRequestSchema,
  workspaceLeaveRequestSchema,
  workspaceMemberRemovalSchema,
  workspaceMemberRoleSchema,
  workspacePhotoSetRequestSchema,
  workspacePhotoTypeSchema,
  workspaceRenameRequestSchema,
  workspaceSlugSetRequestSchema,
  workspaceTokenRepositoryRequestSchema,
  workspaceTransferSchema,
} from "./workspace-wire.js";

/**
 * workspace-client.ts -- the account's workspaces as the host asks the service for them: the list, a workspace created, renamed, given a slug or a photo, or handed over, a GitHub organization connected or disconnected, and its members read, removed, given a role, or left.
 *
 * Every call is the account call, so the bearer is read fresh per attempt
 * and a 401 is renewed and retried once. Renaming, setting the photo,
 * removing a member, changing a member's role, handing the workspace over,
 * and leaving write through Better Auth's own
 * organization calls, so they carry the
 * Mac's Better Auth session rather than its OAuth token: with no session
 * yet, or one the service no longer takes, the call asks for one through
 * the browser's hand-off and is sent once more on it. An owner's or an
 * admin's invitations are made, read, and canceled the same way. A
 * workspace's photo is read apart from the list, as its bytes. A list that did not come back is
 * nothing, because the one thing a caller does without it is keep the
 * workspaces it last read; every other call answers a result, because its
 * caller draws why it did not happen: the account's role does not allow
 * it, the workspace is not one it is in, or no answer came. Each procedure
 * is asked through `hostedCall`, so a refusal is read as its contract
 * declares it, in the words `workspace-call.ts` derives from them.
 */

export interface HostedWorkspaceClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The Mac's own Better Auth session, for the calls that write through Better Auth's organization endpoints. */
  sessionCredential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;

/** The workspace failure a refusal is read as, where it is one a workspace call names. */
function workspaceFailureOf(refusal: HostedApiError): WorkspaceCallFailure | undefined {
  const failure = spelledFailure(refusal, { as: WORKSPACE_RENAMES });
  return Object.values(WORKSPACE_CALL_FAILURE).find((each) => each === failure);
}

/** The refusal a refused answer carries, where it is one named here; unanswered otherwise. */
function refusedAs(payload: UnparsedWireValue): WorkspaceCallResult<never> {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  const failure = refusal === undefined ? undefined : workspaceFailureOf(refusal);
  return failure === undefined ? UNANSWERED : { ok: false, failure };
}

/** How a call failed, as `hostedCall` answers it beside the procedure's output, which never carries a failure. */
type Failed<Answered> = Extract<Answered, { readonly failure: string }>;

/** Whether a call's answer is how it failed rather than its output. */
function failedCall<Answered extends object>(answered: Answered): answered is Failed<Answered> {
  return "failure" in answered;
}

/**
 * A procedure's answer (`hostedCall`) as a result: its output picked, or
 * how it failed, with the fields its refusal carries or the facts beneath
 * it where it reached no answer. The result's failure is the call's own, so
 * a method answering a workspace result holds each to the workspace's words.
 */
function resultOf<Answered extends object, Picked>(
  called: Effect.Effect<Answered, never, HttpClient.HttpClient>,
  pick: (answer: Exclude<Answered, Failed<Answered>>) => Picked,
): Effect.Effect<
  TaskCallResult<Picked, Failed<Answered>["failure"]>,
  never,
  HttpClient.HttpClient
> {
  return Effect.map(called, (answered) => {
    // SAFETY: an answer that carries a failure is how the call failed, and every other one is the procedure's output.
    if (failedCall(answered)) return { ...answered, ok: false } as const;
    return { ok: true, answer: pick(answered as Exclude<Answered, Failed<Answered>>) } as const;
  });
}

/**
 * A live read's answer as a result, as `hostedResult` reads one, but signed
 * out where the service refused the session, as it answers a live read
 * started for another account (`LIVE_SIGNED_OUT`).
 */
function liveResult<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<
  WorkspaceCallResult<Answer> | typeof LIVE_SIGNED_OUT,
  never,
  HttpClient.HttpClient
> {
  return Effect.match(asked, {
    onSuccess: (answer): WorkspaceCallResult<Answer> | typeof LIVE_SIGNED_OUT => ({
      ok: true,
      answer,
    }),
    onFailure: (failed): WorkspaceCallResult<Answer> | typeof LIVE_SIGNED_OUT => {
      if (failed._tag !== "HostedRefused") return UNANSWERED;
      if (failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN) return LIVE_SIGNED_OUT;
      const failure = workspaceFailureOf(failed.refusal);
      return failure === undefined ? UNANSWERED : { ok: false, failure };
    },
  });
}

export class HostedWorkspaceClient {
  readonly #call: AccountCallEffects;
  /** The hosted contract's client under the account's credential. */
  readonly #hosted: HostedClient;
  /** The hosted contract's client under the Mac's session, for the procedures that write through Better Auth. */
  readonly #hostedInSession: HostedClient;

  constructor(options: HostedWorkspaceClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#hostedInSession = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.sessionCredential,
      requestTimeoutMs: options.requestTimeoutMs,
      inSession: true,
    });
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /**
   * The account's workspaces sealed for following over Neon Realtime, for
   * the account named, or with their rows inline where `poll` asks for
   * them, held by the service until they move past `after`; signed out
   * where the session is another account's, or why not.
   */
  live(
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    WorkspaceCallResult<WorkspacesLiveAnswer> | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    return liveResult(
      askLive(this.#hosted.live.workspaces, { [LIVE_USER_QUERY]: userId }, poll, after),
    );
  }

  /**
   * A workspace's people sealed for following over Neon Realtime, to a member
   * of it and for the account named, or with their rows inline where `poll`
   * asks for them; signed out where the session is another account's, or
   * why not.
   */
  peopleLive(
    workspaceId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    WorkspaceCallResult<WorkspaceMembersLiveAnswer> | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    return liveResult(
      askLive(
        this.#hosted.live.workspaceMembers,
        { workspaceId, [LIVE_USER_QUERY]: userId },
        poll,
        after,
      ),
    );
  }

  /**
   * A workspace's pending invitations sealed for following over Neon
   * Realtime, to an owner or an admin of it and for the account named, or
   * with their rows inline where `poll` asks for them; signed out where the
   * session is another account's, or why not.
   */
  invitationsLive(
    workspaceId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    WorkspaceCallResult<WorkspaceInvitationsLiveAnswer> | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    return liveResult(
      askLive(
        this.#hosted.live.workspaceInvitations,
        { workspaceId, [LIVE_USER_QUERY]: userId },
        poll,
        after,
      ),
    );
  }

  /**
   * A workspace's Sentry installations and Slack bot sealed for following
   * over Neon Realtime, to a member of it and for the account named, with
   * whether this deployment holds each integration, or with their rows
   * inline where `poll` asks for them; signed out where the session is
   * another account's, or why not.
   */
  integrationsLive(
    workspaceId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    WorkspaceCallResult<WorkspaceIntegrationsLiveAnswer> | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    return liveResult(
      askLive(
        this.#hosted.live.workspaceIntegrations,
        { workspaceId, [LIVE_USER_QUERY]: userId },
        poll,
        after,
      ),
    );
  }

  /** A workspace created with the name given, the account its owner; a name the service would refuse by shape never travels. */
  create(
    name: string,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(workspaceCreateRequestSchema)({ name }));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.workspaces.create, admitted),
      (answer) => answer.workspace,
    );
  }

  /** The workspace renamed by an owner or admin, answering it as it then stands; a name the service would refuse by shape never travels. */
  rename(
    workspaceId: string,
    name: string,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceRenameRequestSchema)({ workspaceId, name }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hostedInSession.workspaces.rename, admitted),
      (answer) => answer.workspace,
    );
  }

  /** The workspace's slug changed by its owner, answering it under its new slug; the service reads the slug's spelling itself, so a refusal names why. */
  setSlug(
    workspaceId: string,
    slug: string,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlugSetRequestSchema)({ workspaceId, slug }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.workspaces.setSlug, admitted, { as: WORKSPACE_RENAMES }),
      (answer) => answer.workspace,
    );
  }

  /** The workspace's photo set as a `data:` URL, or removed with null, by an owner or admin, answering the workspace as it then stands; a photo the service would refuse by shape never travels. */
  setPhoto(
    workspaceId: string,
    photo: string | null,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspacePhotoSetRequestSchema)({ workspaceId, photo }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hostedInSession.workspaces.setPhoto, admitted),
      (answer) => answer.workspace,
    );
  }

  /** Where the browser goes to connect a GitHub organization to the workspace: the App's install address, carrying a single-use intent. */
  githubConnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<string>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceGithubRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.workspaceGithub.connect, admitted),
      (answer) => answer.url,
    );
  }

  /** The workspace's GitHub organization disconnected, answering the workspace as it then stands. */
  githubDisconnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceGithubRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.workspaceGithub.disconnect, admitted),
      (answer) => answer.workspace,
    );
  }

  /** Where the browser goes to install our Sentry integration for the workspace: Sentry's install address, carrying a single-use intent. */
  sentryInstall(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<string>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSentryRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.workspaceSentry.install, admitted),
      (answer) => answer.url,
    );
  }

  /** One of the workspace's Sentry installations disconnected, answering the workspace's Sentry as it then stands. */
  sentryDisconnect(
    workspaceId: string,
    installationId: string,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSentry>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSentryDisconnectRequestSchema)({ workspaceId, installationId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.workspaceSentry.disconnect, admitted),
      (answer) => answer,
    );
  }
  /** Whether the deployment holds our Slack bot, and the Slack team the workspace's bot is connected to. */
  slackBot(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSlackBot>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlackBotRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.workspaceSlackBot.read, {
        [WORKSPACE_SLACK_BOT_QUERY.WORKSPACE_ID]: admitted.workspaceId,
      }),
      (answer) => answer,
    );
  }

  /** The workspace's Slack bot connected to the team its token answers for, answering the bot as it then stands. */
  slackBotConnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSlackBot>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlackBotRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.workspaceSlackBot.connect, admitted),
      (answer) => answer,
    );
  }

  /** The workspace's Slack bot disconnected, answering the bot as it then stands. */
  slackBotDisconnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSlackBot>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlackBotRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.workspaceSlackBot.disconnect, admitted),
      (answer) => answer,
    );
  }

  /** The reader's own Slack notifications turned on or off, answering the bot as it then stands. */
  slackBotNotifications(
    workspaceId: string,
    notifications: boolean,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSlackBot>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlackBotNotificationsRequestSchema)({ workspaceId, notifications }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.workspaceSlackBot.notifications, admitted),
      (answer) => answer,
    );
  }

  /** The workspace's default repository for Slack starts named or cleared by an owner or admin, answering the bot as it then stands. */
  slackBotRepository(
    params: typeof workspaceSlackBotRepositoryRequestSchema.Type,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSlackBot>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlackBotRepositoryRequestSchema)(params),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.workspaceSlackBot.repository, admitted),
      (answer) => answer,
    );
  }

  /** One channel's bot membership or default repository changed by an owner or admin, answering the bot as it then stands. */
  slackBotChannel(
    params: typeof workspaceSlackBotChannelRequestSchema.Type,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSlackBot>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlackBotChannelRequestSchema)(params),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.workspaceSlackBot.channel, admitted),
      (answer) => answer,
    );
  }

  /**
   * One workspace's photo, fetched under the account: its bytes in base64
   * under its media type, where the service answered with one a photo may
   * be; not found where the workspace is not one the account is in or holds
   * no photo; unanswered for anything else, another media type included, so
   * nothing the window draws is a type it did not expect.
   */
  photo(
    workspaceId: string,
  ): Effect.Effect<
    WorkspaceCallResult<ImageBody<WorkspacePhotoType>>,
    never,
    HttpClient.HttpClient
  > {
    const send = this.#call.send;
    return Effect.gen(function* () {
      const answer = yield* send({
        method: HTTP_METHOD.GET,
        path: workspacePhotoPath(workspaceId),
      });
      if (!callAnswered(answer)) return UNANSWERED;
      if (!answer.response.ok) return refusedAs(unparsedWire(yield* jsonOf(answer.response)));
      const image = yield* imageBodyOf(answer.response, workspacePhotoTypeSchema);
      return image === undefined ? UNANSWERED : { ok: true, answer: image };
    });
  }

  /** The repositories members added to the workspace on their own GitHub tokens, newest added first. */
  tokenRepositories(
    workspaceId: string,
  ): Effect.Effect<
    WorkspaceCallResult<readonly WorkspaceTokenRepository[]>,
    never,
    HttpClient.HttpClient
  > {
    const admitted = Result.getOrUndefined(
      readEither(workspaceLeaveRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.github.tokenRepositories, admitted),
      (answer) => answer.repositories,
    );
  }

  /**
   * A repository added to the workspace on the account's own GitHub token,
   * or removed from it, answering the workspace's token repositories as they
   * then stand; a request the service would refuse by shape never travels.
   */
  setTokenRepository(
    workspaceId: string,
    repository: string,
    added: boolean,
  ): Effect.Effect<
    WorkspaceCallResult<readonly WorkspaceTokenRepository[]>,
    never,
    HttpClient.HttpClient
  > {
    const admitted = Result.getOrUndefined(
      readEither(workspaceTokenRepositoryRequestSchema)({ workspaceId, repository, added }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hosted.github.setTokenRepository, admitted),
      (answer) => answer.repositories,
    );
  }

  /** One member removed by an owner or admin, answering the members who remain; an id the service would refuse by shape never travels. */
  removeMember(
    workspaceId: string,
    userId: string,
  ): Effect.Effect<WorkspaceCallResult<readonly WorkspaceMember[]>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceMemberRemovalSchema)({ workspaceId, userId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hostedInSession.workspaces.removeMember, admitted),
      (answer) => answer.members,
    );
  }

  /** Another member made an admin or an admin a member by the owner, answering the members as they then stand; a role the service would refuse by shape never travels. */
  changeRole(
    workspaceId: string,
    userId: string,
    role: string,
  ): Effect.Effect<WorkspaceCallResult<readonly WorkspaceMember[]>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceMemberRoleSchema)({ workspaceId, userId, role }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hostedInSession.workspaces.changeRole, admitted),
      (answer) => answer.members,
    );
  }

  /** The workspace handed by its owner to one of its admins, the owner becoming an admin, answering the members as they then stand. */
  transfer(
    workspaceId: string,
    userId: string,
  ): Effect.Effect<WorkspaceCallResult<readonly WorkspaceMember[]>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceTransferSchema)({ workspaceId, userId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hostedInSession.workspaces.transfer, admitted),
      (answer) => answer.members,
    );
  }

  /** The account leaves the workspace, answering the workspace left; an answer naming another workspace is no answer. */
  leave(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<string>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceLeaveRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      resultOf(
        hostedCall(this.#hostedInSession.workspaces.leave, admitted),
        (answer) => answer.workspaceId,
      ),
      (left) => (left.ok && left.answer !== workspaceId ? UNANSWERED : left),
    );
  }

  /** An invitation to the workspace for the address, as the role given, answering it with its accept link; an address the service would refuse by shape never travels. */
  invite(
    workspaceId: string,
    email: string,
    role: string,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceInvitation>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceInviteRequestSchema)({ workspaceId, email, role }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hostedInSession.workspaceInvitations.invite, admitted),
      (answer) => answer.invitation,
    );
  }

  /** A pending invitation canceled, answering those still pending; an id the service would refuse by shape never travels. */
  cancelInvitation(
    workspaceId: string,
    invitationId: string,
  ): Effect.Effect<
    WorkspaceCallResult<readonly WorkspaceInvitation[]>,
    never,
    HttpClient.HttpClient
  > {
    const admitted = Result.getOrUndefined(
      readEither(workspaceInvitationCancelSchema)({ workspaceId, invitationId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return resultOf(
      hostedCall(this.#hostedInSession.workspaceInvitations.cancel, admitted),
      (answer) => answer.invitations,
    );
  }
}
