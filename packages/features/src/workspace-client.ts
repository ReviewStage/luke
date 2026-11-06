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
import {
  askHosted,
  askLive,
  type HostedClient,
  type HostedFailure,
  hostedClient,
} from "./hosted-link.js";
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
import {
  WORKSPACE_CALL_FAILURE,
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

export interface HostedWorkspaceClientOptions {
  credential: CallCredential;
  sessionCredential: CallCredential;
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;

const REFUSALS: ReadonlyMap<HostedApiError, WorkspaceCallFailure> = new Map([
  [HOSTED_API_ERROR.NOT_PERMITTED, WORKSPACE_CALL_FAILURE.NOT_PERMITTED],
  [HOSTED_API_ERROR.NOT_FOUND, WORKSPACE_CALL_FAILURE.NOT_FOUND],
  [HOSTED_API_ERROR.ALREADY_INVITED, WORKSPACE_CALL_FAILURE.ALREADY_INVITED],
  [HOSTED_API_ERROR.WORKSPACE_SLUG_MALFORMED, WORKSPACE_CALL_FAILURE.SLUG_MALFORMED],
  [HOSTED_API_ERROR.WORKSPACE_SLUG_RESERVED, WORKSPACE_CALL_FAILURE.SLUG_RESERVED],
  [HOSTED_API_ERROR.WORKSPACE_SLUG_TAKEN, WORKSPACE_CALL_FAILURE.SLUG_TAKEN],
]);

function refusedAs(payload: UnparsedWireValue): WorkspaceCallResult<never> {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  const failure = refusal === undefined ? undefined : REFUSALS.get(refusal);
  return failure === undefined ? UNANSWERED : { ok: false, failure };
}

function hostedResult<Answer, Picked>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
  pick: (answer: Answer) => Picked,
): Effect.Effect<WorkspaceCallResult<Picked>, never, HttpClient.HttpClient> {
  return Effect.match(asked, {
    onSuccess: (answer): WorkspaceCallResult<Picked> => ({ ok: true, answer: pick(answer) }),
    onFailure: (failed): WorkspaceCallResult<Picked> => {
      const failure = failed._tag === "HostedRefused" ? REFUSALS.get(failed.refusal) : undefined;
      return failure === undefined ? UNANSWERED : { ok: false, failure };
    },
  });
}

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
      const failure = REFUSALS.get(failed.refusal);
      return failure === undefined ? UNANSWERED : { ok: false, failure };
    },
  });
}

export class HostedWorkspaceClient {
  readonly #call: AccountCallEffects;
  readonly #hosted: HostedClient;
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

  create(
    name: string,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(workspaceCreateRequestSchema)({ name }));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.workspaces.create, admitted),
      (answer) => answer.workspace,
    );
  }

  rename(
    workspaceId: string,
    name: string,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceRenameRequestSchema)({ workspaceId, name }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hostedInSession.workspaces.rename, admitted),
      (answer) => answer.workspace,
    );
  }

  setSlug(
    workspaceId: string,
    slug: string,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlugSetRequestSchema)({ workspaceId, slug }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.workspaces.setSlug, admitted),
      (answer) => answer.workspace,
    );
  }

  setPhoto(
    workspaceId: string,
    photo: string | null,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspacePhotoSetRequestSchema)({ workspaceId, photo }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hostedInSession.workspaces.setPhoto, admitted),
      (answer) => answer.workspace,
    );
  }

  githubConnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<string>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceGithubRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.workspaceGithub.connect, admitted),
      (answer) => answer.url,
    );
  }

  githubDisconnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceGithubRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.workspaceGithub.disconnect, admitted),
      (answer) => answer.workspace,
    );
  }

  sentryInstall(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<string>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSentryRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.workspaceSentry.install, admitted),
      (answer) => answer.url,
    );
  }

  sentryDisconnect(
    workspaceId: string,
    installationId: string,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSentry>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSentryDisconnectRequestSchema)({ workspaceId, installationId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.workspaceSentry.disconnect, admitted),
      (answer) => answer,
    );
  }
  slackBot(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSlackBot>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlackBotRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.workspaceSlackBot.read, {
        [WORKSPACE_SLACK_BOT_QUERY.WORKSPACE_ID]: admitted.workspaceId,
      }),
      (answer) => answer,
    );
  }

  slackBotConnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSlackBot>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlackBotRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.workspaceSlackBot.connect, admitted),
      (answer) => answer,
    );
  }

  slackBotDisconnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSlackBot>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlackBotRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.workspaceSlackBot.disconnect, admitted),
      (answer) => answer,
    );
  }

  slackBotNotifications(
    workspaceId: string,
    notifications: boolean,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSlackBot>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlackBotNotificationsRequestSchema)({ workspaceId, notifications }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.workspaceSlackBot.notifications, admitted),
      (answer) => answer,
    );
  }

  slackBotRepository(
    params: typeof workspaceSlackBotRepositoryRequestSchema.Type,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSlackBot>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlackBotRepositoryRequestSchema)(params),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.workspaceSlackBot.repository, admitted),
      (answer) => answer,
    );
  }

  slackBotChannel(
    params: typeof workspaceSlackBotChannelRequestSchema.Type,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceSlackBot>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceSlackBotChannelRequestSchema)(params),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.workspaceSlackBot.channel, admitted),
      (answer) => answer,
    );
  }

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
    return hostedResult(
      askHosted(this.#hosted.github.tokenRepositories, admitted),
      (answer) => answer.repositories,
    );
  }

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
    return hostedResult(
      askHosted(this.#hosted.github.setTokenRepository, admitted),
      (answer) => answer.repositories,
    );
  }

  removeMember(
    workspaceId: string,
    userId: string,
  ): Effect.Effect<WorkspaceCallResult<readonly WorkspaceMember[]>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceMemberRemovalSchema)({ workspaceId, userId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hostedInSession.workspaces.removeMember, admitted),
      (answer) => answer.members,
    );
  }

  changeRole(
    workspaceId: string,
    userId: string,
    role: string,
  ): Effect.Effect<WorkspaceCallResult<readonly WorkspaceMember[]>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceMemberRoleSchema)({ workspaceId, userId, role }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hostedInSession.workspaces.changeRole, admitted),
      (answer) => answer.members,
    );
  }

  transfer(
    workspaceId: string,
    userId: string,
  ): Effect.Effect<WorkspaceCallResult<readonly WorkspaceMember[]>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceTransferSchema)({ workspaceId, userId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hostedInSession.workspaces.transfer, admitted),
      (answer) => answer.members,
    );
  }

  leave(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<string>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceLeaveRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.map(
      hostedResult(
        askHosted(this.#hostedInSession.workspaces.leave, admitted),
        (answer) => answer.workspaceId,
      ),
      (left) => (left.ok && left.answer !== workspaceId ? UNANSWERED : left),
    );
  }

  invite(
    workspaceId: string,
    email: string,
    role: string,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceInvitation>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceInviteRequestSchema)({ workspaceId, email, role }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hostedInSession.workspaceInvitations.invite, admitted),
      (answer) => answer.invitation,
    );
  }

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
    return hostedResult(
      askHosted(this.#hostedInSession.workspaceInvitations.cancel, admitted),
      (answer) => answer.invitations,
    );
  }
}
