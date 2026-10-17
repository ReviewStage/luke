import {
  HTTP_METHOD,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result, type Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  type CallRequest,
  callAnswered,
  sendInSession,
  sessionBearer,
} from "./account-call.js";
import type { AccountSessionToken, AccountToken } from "./account-token.js";
import { type ImageBody, imageBodyOf } from "./image-body.js";
import { type LinearIssueSummary, linearIssuesAnswerSchema } from "./linear-wire.js";
import { HOSTED_SERVICE_PATH, workspacePhotoPath } from "./service-paths.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";
import {
  WORKSPACE_CALL_FAILURE,
  type WorkspaceCallFailure,
  type WorkspaceCallResult,
} from "./workspace-call.js";
import {
  type WorkspaceEnvironmentAnswer,
  type WorkspaceEnvironmentRemoveRequest,
  type WorkspaceEnvironmentSaveRequest,
  workspaceEnvironmentAnswerSchema,
  workspaceEnvironmentListRequestSchema,
  workspaceEnvironmentRemoveRequestSchema,
  workspaceEnvironmentSaveRequestSchema,
} from "./workspace-environment-wire.js";
import {
  WORKSPACE_INVITATIONS_QUERY,
  type WorkspaceInvitation,
  workspaceInvitationAnswerSchema,
  workspaceInvitationCancelSchema,
  workspaceInvitationsAnswerSchema,
  workspaceInviteRequestSchema,
} from "./workspace-invitation-wire.js";
import {
  type FormerMember,
  type LinearIssuesRequest,
  linearIssuesRequestSchema,
  WORKSPACE_MEMBERS_QUERY,
  type Workspace,
  type WorkspaceMember,
  type WorkspacePhotoType,
  type WorkspacesAnswer,
  workspaceAnswerSchema,
  workspaceCreateRequestSchema,
  workspaceGithubConnectAnswerSchema,
  workspaceGithubRequestSchema,
  workspaceLeaveAnswerSchema,
  workspaceLeaveRequestSchema,
  workspaceLinearConnectAnswerSchema,
  workspaceLinearRequestSchema,
  workspaceMemberRemovalSchema,
  workspaceMemberRoleSchema,
  workspaceMembersAnswerSchema,
  workspacePhotoSetRequestSchema,
  workspacePhotoTypeSchema,
  workspaceRenameRequestSchema,
  workspacesAnswerSchema,
  workspaceTransferSchema,
} from "./workspace-wire.js";

/**
 * workspace-client.ts -- the account's workspaces as the host asks the service for them: the list, a workspace created, renamed, given a photo, or handed over, a GitHub organization connected or disconnected, and its members read, removed, given a role, or left.
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
 * it, the workspace is not one it is in, or no answer came.
 */

export interface HostedWorkspaceClientOptions extends AccountToken, AccountSessionToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;

/** The refusals a workspace call names, by the service's own word for each. */
const REFUSALS: ReadonlyMap<HostedApiError, WorkspaceCallFailure> = new Map([
  [HOSTED_API_ERROR.NOT_PERMITTED, WORKSPACE_CALL_FAILURE.NOT_PERMITTED],
  [HOSTED_API_ERROR.NOT_FOUND, WORKSPACE_CALL_FAILURE.NOT_FOUND],
  [HOSTED_API_ERROR.ALREADY_INVITED, WORKSPACE_CALL_FAILURE.ALREADY_INVITED],
  [HOSTED_API_ERROR.LINEAR_UNAVAILABLE, WORKSPACE_CALL_FAILURE.LINEAR_UNAVAILABLE],
]);

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

/** The refusal a refused answer carries, where it is one named here; unanswered otherwise. */
function refusedAs(payload: UnparsedWireValue): WorkspaceCallResult<never> {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  const failure = refusal === undefined ? undefined : REFUSALS.get(refusal);
  return failure === undefined ? UNANSWERED : { ok: false, failure };
}

export class HostedWorkspaceClient {
  readonly #call: AccountCallEffects;
  /** The send for the calls that write through Better Auth under the Mac's session. */
  readonly #inSession: AccountCallEffects["send"];

  constructor(options: HostedWorkspaceClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#inSession = sendInSession(
      accountCall({
        baseUrl: options.serviceBaseUrl,
        credential: sessionBearer(options),
        requestTimeoutMs: options.requestTimeoutMs,
      }),
      options,
    );
  }

  /** Every workspace the account is a member of, its first one first; nothing where the service refused or did not answer. */
  list(): Effect.Effect<WorkspacesAnswer | undefined, never, HttpClient.HttpClient> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES },
      workspacesAnswerSchema,
    );
  }

  /** A workspace created with the name given, the account its owner; a name the service would refuse by shape never travels. */
  create(
    name: string,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(workspaceCreateRequestSchema)({ name }));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return this.#answered(
      {
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES,
        body: JSON.stringify(admitted),
      },
      workspaceAnswerSchema,
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
    return this.#answered(
      {
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES_RENAME,
        body: JSON.stringify(admitted),
      },
      workspaceAnswerSchema,
      (answer) => answer.workspace,
      this.#inSession,
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
    return this.#answered(
      {
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES_PHOTO_SET,
        body: JSON.stringify(admitted),
      },
      workspaceAnswerSchema,
      (answer) => answer.workspace,
      this.#inSession,
    );
  }

  /** Where the browser goes to connect a GitHub organization to the workspace: the App's install address, carrying a single-use intent. */
  githubConnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<string>, never, HttpClient.HttpClient> {
    return this.#github(HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_CONNECT, workspaceId, (body) =>
      this.#answered(body, workspaceGithubConnectAnswerSchema, (answer) => answer.url),
    );
  }

  /** The workspace's GitHub organization disconnected, answering the workspace as it then stands. */
  githubDisconnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    return this.#github(HOSTED_SERVICE_PATH.WORKSPACE_GITHUB_DISCONNECT, workspaceId, (body) =>
      this.#answered(body, workspaceAnswerSchema, (answer) => answer.workspace),
    );
  }

  /** Where the browser goes to connect Linear for the whole workspace: Vercel Connect's sign-in address. */
  linearConnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<string>, never, HttpClient.HttpClient> {
    return this.#linear(HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_CONNECT, workspaceId, (body) =>
      this.#answered(body, workspaceLinearConnectAnswerSchema, (answer) => answer.url),
    );
  }

  /** The workspace's Linear disconnected, answering the workspace as it then stands. */
  linearDisconnect(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient> {
    return this.#linear(HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_DISCONNECT, workspaceId, (body) =>
      this.#answered(body, workspaceAnswerSchema, (answer) => answer.workspace),
    );
  }

  /**
   * The Linear issues the workspace's connection reaches, newest changed
   * first, or those the search matches; a request the service would refuse
   * by shape never travels.
   */
  linearIssues(
    request: LinearIssuesRequest,
  ): Effect.Effect<
    WorkspaceCallResult<readonly LinearIssueSummary[]>,
    never,
    HttpClient.HttpClient
  > {
    const admitted = Result.getOrUndefined(readEither(linearIssuesRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return this.#answered(
      {
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_ISSUES,
        body: JSON.stringify(admitted),
      },
      linearIssuesAnswerSchema,
      (answer) => answer.issues,
    );
  }

  /** One workspace's members, owners first, and who its work names but left; or why there are none: not a member, not permitted, or no answer. */
  people(workspaceId: string): Effect.Effect<
    WorkspaceCallResult<{
      readonly members: readonly WorkspaceMember[];
      readonly former: readonly FormerMember[];
    }>,
    never,
    HttpClient.HttpClient
  > {
    const query = new URLSearchParams({ [WORKSPACE_MEMBERS_QUERY.WORKSPACE_ID]: workspaceId });
    return this.#answered(
      { method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS}?${query}` },
      workspaceMembersAnswerSchema,
      (answer) => ({ members: answer.members, former: answer.former ?? [] }),
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

  /** One member removed by an owner or admin, answering the members who remain; an id the service would refuse by shape never travels. */
  removeMember(
    workspaceId: string,
    userId: string,
  ): Effect.Effect<WorkspaceCallResult<readonly WorkspaceMember[]>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceMemberRemovalSchema)({ workspaceId, userId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return this.#answered(
      {
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_REMOVE,
        body: JSON.stringify(admitted),
      },
      workspaceMembersAnswerSchema,
      (answer) => answer.members,
      this.#inSession,
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
    return this.#answered(
      {
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_ROLE,
        body: JSON.stringify(admitted),
      },
      workspaceMembersAnswerSchema,
      (answer) => answer.members,
      this.#inSession,
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
    return this.#answered(
      {
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES_TRANSFER,
        body: JSON.stringify(admitted),
      },
      workspaceMembersAnswerSchema,
      (answer) => answer.members,
      this.#inSession,
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
      this.#answered(
        {
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.WORKSPACES_LEAVE,
          body: JSON.stringify(admitted),
        },
        workspaceLeaveAnswerSchema,
        (answer) => answer.workspaceId,
        this.#inSession,
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
    return this.#answered(
      {
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS,
        body: JSON.stringify(admitted),
      },
      workspaceInvitationAnswerSchema,
      (answer) => answer.invitation,
      this.#inSession,
    );
  }

  /** The workspace's pending invitations, soonest to expire first, to an owner or an admin. */
  invitations(
    workspaceId: string,
  ): Effect.Effect<
    WorkspaceCallResult<readonly WorkspaceInvitation[]>,
    never,
    HttpClient.HttpClient
  > {
    const query = new URLSearchParams({ [WORKSPACE_INVITATIONS_QUERY.WORKSPACE_ID]: workspaceId });
    return this.#answered(
      { method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS}?${query}` },
      workspaceInvitationsAnswerSchema,
      (answer) => answer.invitations,
      this.#inSession,
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
    return this.#answered(
      {
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES_INVITATIONS_CANCEL,
        body: JSON.stringify(admitted),
      },
      workspaceInvitationsAnswerSchema,
      (answer) => answer.invitations,
      this.#inSession,
    );
  }

  /** The workspace's environment variables and secrets: a variable with its value, a secret by its hint. */
  environment(
    workspaceId: string,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceEnvironmentAnswer>, never, HttpClient.HttpClient> {
    return this.#environment(
      HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT,
      readEither(workspaceEnvironmentListRequestSchema)({ workspaceId }),
    );
  }

  /**
   * One variable or secret saved, answering the list as it then stands and,
   * where the service kept nothing, why; a save the service would refuse by
   * shape never travels, so a secret is sent nowhere it would not be kept.
   */
  saveEnvironment(
    request: WorkspaceEnvironmentSaveRequest,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceEnvironmentAnswer>, never, HttpClient.HttpClient> {
    return this.#environment(
      HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT_SAVE,
      readEither(workspaceEnvironmentSaveRequestSchema)(request),
    );
  }

  /** One variable or secret removed, answering the list as it then stands. */
  removeEnvironment(
    request: WorkspaceEnvironmentRemoveRequest,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceEnvironmentAnswer>, never, HttpClient.HttpClient> {
    return this.#environment(
      HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT_REMOVE,
      readEither(workspaceEnvironmentRemoveRequestSchema)(request),
    );
  }

  /** An environment call sent where its body is one the service would take, its answer read as the list. */
  #environment(
    path: string,
    admitted: Result.Result<object, unknown>,
  ): Effect.Effect<WorkspaceCallResult<WorkspaceEnvironmentAnswer>, never, HttpClient.HttpClient> {
    if (Result.isFailure(admitted)) return Effect.succeed(UNANSWERED);
    return this.#answered(
      { method: HTTP_METHOD.POST, path, body: JSON.stringify(admitted.success) },
      workspaceEnvironmentAnswerSchema,
      (answer) => answer,
    );
  }

  /** A connect or disconnect request for the workspace; an id the service would refuse by shape never travels. */
  #github<A>(
    path: string,
    workspaceId: string,
    send: (
      request: CallRequest,
    ) => Effect.Effect<WorkspaceCallResult<A>, never, HttpClient.HttpClient>,
  ): Effect.Effect<WorkspaceCallResult<A>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceGithubRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return send({ method: HTTP_METHOD.POST, path, body: JSON.stringify(admitted) });
  }

  /** A call that names one workspace's Linear, sent where the workspace's id is one the service would take. */
  #linear<A>(
    path: string,
    workspaceId: string,
    send: (
      request: CallRequest,
    ) => Effect.Effect<WorkspaceCallResult<A>, never, HttpClient.HttpClient>,
  ): Effect.Effect<WorkspaceCallResult<A>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(workspaceLinearRequestSchema)({ workspaceId }),
    );
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return send({ method: HTTP_METHOD.POST, path, body: JSON.stringify(admitted) });
  }

  /** One call's answer read under its schema and picked, or its refusal named. */
  #answered<A, Encoded, Picked>(
    request: CallRequest,
    schema: Schema.Codec<A, Encoded>,
    pick: (answer: A) => Picked,
    send: (request: CallRequest) => ReturnType<AccountCallEffects["send"]> = this.#call.send,
  ): Effect.Effect<WorkspaceCallResult<Picked>, never, HttpClient.HttpClient> {
    return Effect.gen(function* () {
      const answer = yield* send(request);
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (!answer.response.ok) return refusedAs(payload);
      const read = Result.getOrUndefined(readServiceAnswer(schema)(payload));
      return read === undefined ? UNANSWERED : { ok: true, answer: pick(read) };
    });
  }
}
