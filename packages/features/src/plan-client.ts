import {
  HTTP_METHOD,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  callAnswered,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import { type Board, type BoardElement, boardAnswerSchema } from "./board-wire.js";
import {
  GITHUB_REPOSITORIES_QUERY,
  type GitHubRepositoriesAnswer,
  type GitHubRepositoryPullRequestAnswer,
  githubRepositoriesAnswerSchema,
  githubRepositoryPullRequestAnswerSchema,
} from "./github-repositories-wire.js";
import { imageBodyOf } from "./image-body.js";
import {
  type PageLine,
  type PageVersion,
  planPagesAnswerSchema,
  planPageVersionAnswerSchema,
} from "./page-wire.js";
import { pictureTypeSchema } from "./picture-wire.js";
import { PLAN_ATTACHMENT_REFUSAL, planAttachmentAnswerSchema } from "./plan-attachment-wire.js";
import {
  type PlanEditAnswer,
  type PlanEditRequest,
  planEditAnswerSchema,
  planEditRequestSchema,
} from "./plan-edit.js";
import {
  PLAN_LIST_ARCHIVED,
  PLAN_LIST_QUERY,
  type Plan,
  type PlanCreateRequest,
  type PlanFileAnswer,
  type PlanFileRequest,
  type PlanListAnswer,
  type PlanRenameRequest,
  type PlanRevisionAnswer,
  type PlanRevisionsAnswer,
  type PlanSkillsAnswer,
  type PlanTreeAnswer,
  type PlanTreeRequest,
  type PlanUpdateRequest,
  planAnswerSchema,
  planCreateRequestSchema,
  planDeleteAnswerSchema,
  planFileAnswerSchema,
  planFileRequestSchema,
  planListAnswerSchema,
  planRenameRequestSchema,
  planRevisionAnswerSchema,
  planRevisionsAnswerSchema,
  planSkillsAnswerSchema,
  planTreeAnswerSchema,
  planTreeRequestSchema,
  planUpdateRequestSchema,
  type RepositoryPin,
  repositoryPinRequestSchema,
  repositoryPinsAnswerSchema,
} from "./plan-wire.js";
import {
  PICTURE_KEEP_FAILURE,
  PLAN_CALL_FAILURE,
  type PlanCallFailure,
  type PlanCodeAnswer,
  type PlanningPictureAnswer,
  type PlanningPictureKeepAnswer,
  type PlanWorkAnswer,
  planCodeAnswerSchema,
  planWorkAnswerSchema,
  type RepositoryCallFailure,
  type RepositoryListFailure,
  type StartCallFailure,
} from "./planning-view.js";
import {
  HOSTED_SERVICE_PATH,
  planAttachmentPath,
  planAttachmentsPath,
  planBoardPath,
  planCodePath,
  planEditPath,
  planFilePath,
  planPagesPath,
  planPageVersionPath,
  planPath,
  planRestorePath,
  planRevisionPath,
  planRevisionsPath,
  planSkillsPath,
  planTranscriptPath,
  planTreePath,
  planWorkPath,
  type RepositoryPlace,
  repositoryPullRequestPath,
  repositorySkillsPath,
  repositoryTreePath,
} from "./service-paths.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";
import { type PlanTranscript, planTranscriptAnswerSchema } from "./transcript-wire.js";

/**
 * plan-client.ts -- the Plans tab's side of the named plans, as the host asks the service for them.
 *
 * Every call is the one account call, so the bearer is read fresh per attempt
 * and a 401 is renewed and retried once. What the window has to say about a
 * call that did not answer is one of a few reasons: the service never
 * answered, the plan is gone, or, on a call that names a repository, GitHub's
 * reach refused it.
 */

/** One call's answer, or why there is none. */
export type PlanCallResult<Answer, Failure> =
  | { readonly ok: true; readonly answer: Answer }
  | { readonly ok: false; readonly failure: Failure };

export interface HostedPlanClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED } as const;

/** The list with the archived plans among it, each flagged, which this build sorts into its own place. */
const LIST_WITH_ARCHIVED_PATH = `${HOSTED_SERVICE_PATH.PLANS}?${new URLSearchParams({
  [PLAN_LIST_QUERY.ARCHIVED]: PLAN_LIST_ARCHIVED.INCLUDE,
})}`;

/** What a plan's pin and archive change names: pinned or not, archived or not, or both. */
export type PlanMarks = Pick<PlanUpdateRequest, "pinned" | "archived">;

function succeeded<Answer>(answer: Answer) {
  return { ok: true, answer } as const;
}

/** The refusals a call that names a repository can answer with, by the service's own word for each. */
const REPOSITORY_REFUSALS = {
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: PLAN_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
} as const;

/** The refusals a start can answer with: a repository out of reach, or the Linear issue it was to start from unread. */
const START_REFUSALS = {
  ...REPOSITORY_REFUSALS,
  [HOSTED_API_ERROR.LINEAR_UNAVAILABLE]: PLAN_CALL_FAILURE.LINEAR_UNAVAILABLE,
} as const;

/** The refusals a move can answer with: the plan or the workspace not the account's, the plan archived, or the workspace not reaching its repository. */
const MOVE_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: PLAN_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.PLAN_ARCHIVED]: PLAN_CALL_FAILURE.PLAN_ARCHIVED,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: PLAN_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
} as const;

/** The refusal a read of one of the plan's own rows can answer with: the plan or the row not the account's. */
const NOT_FOUND_REFUSAL = {
  [HOSTED_API_ERROR.NOT_FOUND]: PLAN_CALL_FAILURE.NOT_FOUND,
} as const;

/** The refusal a refused answer carries, where it is one the caller names; unanswered otherwise. */
function refusedAs<Failure extends PlanCallFailure>(
  payload: UnparsedWireValue,
  named: Readonly<Partial<Record<HostedApiError, Failure>>>,
): PlanCallResult<never, Failure | typeof PLAN_CALL_FAILURE.UNANSWERED> {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  const failure = refusal === undefined ? undefined : named[refusal];
  return failure === undefined ? UNANSWERED : { ok: false, failure };
}

/**
 * The Plans tab's reads and its writes of the service: the list of plans,
 * one plan opened with its document, the repositories the account reaches,
 * and a plan started, renamed, given its repository, pinned, archived, or deleted. Each
 * resolves to a result rather than failing, because every caller does the
 * same thing with a failure: draws why, and offers to try again.
 */
export class HostedPlanClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedPlanClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** Every plan the account owns, newest started first, and every agent with no plan in its workspaces, the archived ones of each among them. */
  list(): Effect.Effect<
    PlanCallResult<PlanListAnswer, typeof PLAN_CALL_FAILURE.UNANSWERED>,
    never,
    HttpClient.HttpClient
  > {
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.GET, path: LIST_WITH_ARCHIVED_PATH },
        planListAnswerSchema,
      ),
      (answer) => (answer === undefined ? UNANSWERED : succeeded(answer)),
    );
  }

  /** One plan with its saved document; opening it moves no row of the list. */
  open(
    planId: string,
  ): Effect.Effect<PlanCallResult<Plan, PlanCallFailure>, never, HttpClient.HttpClient> {
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send({ method: HTTP_METHOD.GET, path: planPath(planId) });
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (answer.response.ok) {
        const opened = Result.getOrUndefined(readServiceAnswer(planAnswerSchema)(payload));
        return opened === undefined ? UNANSWERED : succeeded(opened.plan);
      }
      return refusedAs(payload, { [HOSTED_API_ERROR.NOT_FOUND]: PLAN_CALL_FAILURE.NOT_FOUND });
    });
  }

  /**
   * Saves the developer's edit of the document, answering the plan as saved,
   * the text as it now stands where the edit no longer lands in it, or why
   * it was refused; or why there is no answer: the service did not answer,
   * the plan is gone, or it is archived. An edit the service would refuse by shape is
   * refused here without traveling at all.
   */
  edit(
    planId: string,
    edit: PlanEditRequest,
  ): Effect.Effect<
    PlanCallResult<
      PlanEditAnswer,
      | typeof PLAN_CALL_FAILURE.UNANSWERED
      | typeof PLAN_CALL_FAILURE.NOT_FOUND
      | typeof PLAN_CALL_FAILURE.PLAN_ARCHIVED
    >,
    never,
    HttpClient.HttpClient
  > {
    const admitted = Result.getOrUndefined(readEither(planEditRequestSchema)(edit));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send({
        method: HTTP_METHOD.POST,
        path: planEditPath(planId),
        body: JSON.stringify(admitted),
      });
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (answer.response.ok) {
        const edited = Result.getOrUndefined(readServiceAnswer(planEditAnswerSchema)(payload));
        return edited === undefined ? UNANSWERED : succeeded(edited);
      }
      return refusedAs(payload, {
        [HOSTED_API_ERROR.NOT_FOUND]: PLAN_CALL_FAILURE.NOT_FOUND,
        [HOSTED_API_ERROR.PLAN_ARCHIVED]: PLAN_CALL_FAILURE.PLAN_ARCHIVED,
      });
    });
  }

  /**
   * The repositories the account reaches through the Luke GitHub App, or
   * only those of the installation the workspace given stands for, with
   * whether the App is installed anywhere for it and where to install it;
   * or why there is none: the service did not answer.
   */
  repositories(
    workspaceId?: string,
  ): Effect.Effect<
    PlanCallResult<GitHubRepositoriesAnswer, RepositoryListFailure>,
    never,
    HttpClient.HttpClient
  > {
    const call = this.#call;
    return Effect.gen(function* () {
      const query =
        workspaceId === undefined
          ? ""
          : `?${new URLSearchParams({ [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID]: workspaceId })}`;
      const answer = yield* call.send({
        method: HTTP_METHOD.GET,
        path: `${HOSTED_SERVICE_PATH.GITHUB_REPOSITORIES}${query}`,
      });
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (!answer.response.ok) return UNANSWERED;
      const listed = Result.getOrUndefined(
        readServiceAnswer(githubRepositoriesAnswerSchema)(payload),
      );
      return listed === undefined ? UNANSWERED : succeeded(listed);
    });
  }

  /**
   * Gives one plan its repository, or takes it away with null, answering
   * the plan as changed; or why it is unchanged: the service did not answer,
   * or the App does not reach that repository for the account. A name the service would refuse by shape
   * is refused here without traveling at all.
   */
  setRepository(
    planId: string,
    repository: string | null,
  ): Effect.Effect<PlanCallResult<Plan, RepositoryCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planUpdateRequestSchema)({ repository }));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send({
        method: HTTP_METHOD.PATCH,
        path: planPath(planId),
        body: JSON.stringify(admitted),
      });
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (answer.response.ok) {
        const changed = Result.getOrUndefined(readServiceAnswer(planAnswerSchema)(payload));
        return changed === undefined ? UNANSWERED : succeeded(changed.plan);
      }
      return refusedAs(payload, REPOSITORY_REFUSALS);
    });
  }

  /**
   * Moves one plan to another of the account's workspaces, answering the
   * plan as moved; or why it stands where it was: the service did not
   * answer, the plan or the workspace is not the account's to move it to,
   * the plan is archived, or the workspace does not reach its repository.
   */
  move(
    planId: string,
    workspaceId: string,
  ): Effect.Effect<PlanCallResult<Plan, PlanCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planUpdateRequestSchema)({ workspaceId }));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send({
        method: HTTP_METHOD.PATCH,
        path: planPath(planId),
        body: JSON.stringify(admitted),
      });
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (answer.response.ok) {
        const moved = Result.getOrUndefined(readServiceAnswer(planAnswerSchema)(payload));
        return moved === undefined ? UNANSWERED : succeeded(moved.plan);
      }
      return refusedAs(payload, MOVE_REFUSALS);
    });
  }

  /** One plan's whiteboard as it stands; nothing where the service did not answer one. */
  readBoard(planId: string): Effect.Effect<Board | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask({ method: HTTP_METHOD.GET, path: planBoardPath(planId) }, boardAnswerSchema),
      (answer) => answer?.board,
    );
  }

  /** What was said on one plan's calls; nothing where the service did not answer it. */
  readTranscript(
    planId: string,
  ): Effect.Effect<PlanTranscript | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.GET, path: planTranscriptPath(planId) },
        planTranscriptAnswerSchema,
      ),
      (answer) => answer?.transcript,
    );
  }

  /** A page of one plan's work as the service keeps it, the newest or the one before a turn, with every code shown on the newest; nothing where the service did not answer it. */
  readWork(
    planId: string,
    before?: string,
  ): Effect.Effect<PlanWorkAnswer | undefined, never, HttpClient.HttpClient> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: planWorkPath(planId, before) },
      planWorkAnswerSchema,
    );
  }

  /** Every code Luke showed on one plan, oldest first; nothing where the service did not answer it. */
  readCode(
    planId: string,
  ): Effect.Effect<PlanCodeAnswer | undefined, never, HttpClient.HttpClient> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: planCodePath(planId) },
      planCodeAnswerSchema,
    );
  }

  /**
   * One window of a file of the plan's repository as GitHub holds it now,
   * or why it is not shown; nothing where the service did not answer, or
   * where the window asked is not one the wire admits.
   */
  readFile(
    planId: string,
    window: PlanFileRequest,
  ): Effect.Effect<PlanFileAnswer | undefined, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planFileRequestSchema)(window));
    if (admitted === undefined) return Effect.succeed(undefined);
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: planFilePath(planId, admitted) },
      planFileAnswerSchema,
    );
  }

  /**
   * One folder of the plan's repository as GitHub holds it now, or why it
   * is not listed; nothing where the service did not answer, or where the
   * folder asked is not one the wire admits.
   */
  readTree(
    planId: string,
    folder: PlanTreeRequest,
  ): Effect.Effect<PlanTreeAnswer | undefined, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planTreeRequestSchema)(folder));
    if (admitted === undefined) return Effect.succeed(undefined);
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: planTreePath(planId, admitted) },
      planTreeAnswerSchema,
    );
  }

  /** The skills a developer may choose of the plan's repository as GitHub holds it now, or why they are not read; nothing where the service did not answer. */
  readSkills(
    planId: string,
  ): Effect.Effect<PlanSkillsAnswer | undefined, never, HttpClient.HttpClient> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: planSkillsPath(planId) },
      planSkillsAnswerSchema,
    );
  }

  /**
   * One folder of a repository the workspace's installation reaches, as
   * `readTree` reads a plan's, for a place with no plan to name it by;
   * nothing where the service did not answer, or where the folder asked is
   * not one the wire admits.
   */
  readRepositoryTree(
    place: RepositoryPlace,
    folder: PlanTreeRequest,
  ): Effect.Effect<PlanTreeAnswer | undefined, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planTreeRequestSchema)(folder));
    if (admitted === undefined) return Effect.succeed(undefined);
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: repositoryTreePath(place, admitted) },
      planTreeAnswerSchema,
    );
  }

  /** The skills a developer may choose of a repository the workspace's installation reaches, as `readSkills` reads a plan's; nothing where the service did not answer. */
  readRepositorySkills(
    place: RepositoryPlace,
  ): Effect.Effect<PlanSkillsAnswer | undefined, never, HttpClient.HttpClient> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: repositorySkillsPath(place) },
      planSkillsAnswerSchema,
    );
  }

  /** One pull request of a repository the workspace's installation reaches, by its number, or null where there is none to draw; nothing where the service did not answer. */
  readRepositoryPullRequest(
    place: RepositoryPlace,
    number: number,
  ): Effect.Effect<GitHubRepositoryPullRequestAnswer | undefined, never, HttpClient.HttpClient> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: repositoryPullRequestPath(place, number) },
      githubRepositoryPullRequestAnswerSchema,
    );
  }

  /** A page of one plan's history, the newest or the one before a revision; nothing where the service did not answer it. */
  readRevisions(
    planId: string,
    before?: number,
  ): Effect.Effect<PlanRevisionsAnswer | undefined, never, HttpClient.HttpClient> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: planRevisionsPath(planId, before) },
      planRevisionsAnswerSchema,
    );
  }

  /** One revision of one plan beside the one before it; nothing where the service did not answer it, or holds no such revision. */
  readRevision(
    planId: string,
    seq: number,
  ): Effect.Effect<PlanRevisionAnswer["revision"] | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.GET, path: planRevisionPath(planId, seq) },
        planRevisionAnswerSchema,
      ),
      (answer) => answer?.revision,
    );
  }

  /**
   * One picture of one plan, fetched under the account: its bytes in base64
   * under its media type, where the service answered with a type a picture
   * may be; not found where the plan is not one the account reaches or holds
   * no such picture; unanswered for anything else, another media type
   * included, so nothing a window draws is a type it did not expect.
   */
  readPicture(
    planId: string,
    attachmentId: string,
  ): Effect.Effect<PlanningPictureAnswer, never, HttpClient.HttpClient> {
    const send = this.#call.send;
    return Effect.gen(function* () {
      const answer = yield* send({
        method: HTTP_METHOD.GET,
        path: planAttachmentPath(planId, attachmentId),
      });
      if (!callAnswered(answer)) return { failure: PLAN_CALL_FAILURE.UNANSWERED };
      if (!answer.response.ok) {
        const refused = refusedAs(unparsedWire(yield* jsonOf(answer.response)), NOT_FOUND_REFUSAL);
        return { failure: refused.ok ? PLAN_CALL_FAILURE.UNANSWERED : refused.failure };
      }
      const picture = yield* imageBodyOf(answer.response, pictureTypeSchema);
      return picture ?? { failure: PLAN_CALL_FAILURE.UNANSWERED };
    });
  }

  /**
   * One picture kept on one plan, sent as the `data:` URL the Mac made of
   * it: the id the plan's text then names it by; too many where the plan
   * holds its bound; not found where the plan is not one the account may
   * write, an archived one among them; unanswered for anything else.
   */
  keepPicture(
    planId: string,
    picture: string,
  ): Effect.Effect<PlanningPictureKeepAnswer, never, HttpClient.HttpClient> {
    const send = this.#call.send;
    return Effect.gen(function* () {
      const answer = yield* send({
        method: HTTP_METHOD.POST,
        path: planAttachmentsPath(planId),
        body: JSON.stringify({ picture }),
      });
      if (!callAnswered(answer)) return { failure: PICTURE_KEEP_FAILURE.UNANSWERED };
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (!answer.response.ok) {
        const refused = refusedAs(payload, NOT_FOUND_REFUSAL);
        return { failure: refused.ok ? PICTURE_KEEP_FAILURE.UNANSWERED : refused.failure };
      }
      const kept = Result.getOrUndefined(readServiceAnswer(planAttachmentAnswerSchema)(payload));
      if (kept === undefined) return { failure: PICTURE_KEEP_FAILURE.UNANSWERED };
      return "id" in kept
        ? { id: kept.id }
        : {
            failure:
              kept.refused === PLAN_ATTACHMENT_REFUSAL.TOO_MANY
                ? PICTURE_KEEP_FAILURE.TOO_MANY
                : PICTURE_KEEP_FAILURE.UNANSWERED,
          };
    });
  }

  /** One plan's pages, each by its newest version; nothing where the service did not answer them. */
  readPages(
    planId: string,
  ): Effect.Effect<readonly PageLine[] | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.GET, path: planPagesPath(planId) },
        planPagesAnswerSchema,
      ),
      (answer) => answer?.pages,
    );
  }

  /** One version of one page of one plan, with its HTML; nothing where the service did not answer it, or holds no such version. */
  readPageVersion(
    planId: string,
    pageId: string,
    version: number,
  ): Effect.Effect<PageVersion | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.GET, path: planPageVersionPath(planId, pageId, version) },
        planPageVersionAnswerSchema,
      ),
      (answer) => answer?.page,
    );
  }

  /** Puts one revision of a plan back as its content, answering the plan as it now stands, or nothing where the service did not restore it. */
  restore(
    planId: string,
    seq: number,
  ): Effect.Effect<Plan | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.POST, path: planRestorePath(planId, seq) },
        planAnswerSchema,
      ),
      (answer) => answer?.plan,
    );
  }

  /** The board's scene written whole, with the number of Luke's drawing it holds and, when it is the first to hold it, the scene's image; the board as written, or nothing where the service did not answer. */
  saveBoard(
    planId: string,
    elements: readonly BoardElement[],
    appliedDrawing: number,
    image?: string,
  ): Effect.Effect<Board | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        {
          method: HTTP_METHOD.PUT,
          path: planBoardPath(planId),
          body: JSON.stringify({ elements, appliedDrawing, image }),
        },
        boardAnswerSchema,
      ),
      (answer) => answer?.board,
    );
  }

  /** Deletes one plan with its document and its conversation; whether the service deleted it. */
  delete(planId: string): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.DELETE, path: planPath(planId) },
        planDeleteAnswerSchema,
      ),
      (answer) => answer?.deleted === true,
    );
  }

  /**
   * Renames one plan, answering it as renamed with its document, or nothing
   * where the service did not rename it; a name the service would refuse by
   * shape is refused here without traveling at all.
   */
  rename(
    planId: string,
    request: PlanRenameRequest,
  ): Effect.Effect<Plan | undefined, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planRenameRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(undefined);
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.PATCH, path: planPath(planId), body: JSON.stringify(admitted) },
        planAnswerSchema,
      ),
      (answer) => answer?.plan,
    );
  }

  /**
   * Pins or unpins one plan, archives it or brings it back, answering it as
   * changed with its document, or nothing where the service did not change
   * it; a change that names neither never travels.
   */
  mark(
    planId: string,
    marks: PlanMarks,
  ): Effect.Effect<Plan | undefined, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planUpdateRequestSchema)(marks));
    if (admitted === undefined) return Effect.succeed(undefined);
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.PATCH, path: planPath(planId), body: JSON.stringify(admitted) },
        planAnswerSchema,
      ),
      (answer) => answer?.plan,
    );
  }

  /** The repositories the account pinned in the sidebar, newest pinned first; nothing where the service did not answer. */
  repositoryPins(): Effect.Effect<
    readonly RepositoryPin[] | undefined,
    never,
    HttpClient.HttpClient
  > {
    return Effect.map(
      this.#call.ask(
        { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.REPOSITORY_PINS },
        repositoryPinsAnswerSchema,
      ),
      (answer) => answer?.pins,
    );
  }

  /**
   * Pins one repository or unpins it, answering the account's pins as they
   * then stand; nothing where the service refused or did not answer. A
   * repository the wire would refuse by shape never travels.
   */
  pinRepository(
    repository: string,
    pinned: boolean,
  ): Effect.Effect<readonly RepositoryPin[] | undefined, never, HttpClient.HttpClient> {
    const asked = Result.getOrUndefined(
      readEither(repositoryPinRequestSchema)({ repository, pinned }),
    );
    if (asked === undefined) return Effect.succeed(undefined);
    return Effect.map(
      this.#call.ask(
        {
          method: HTTP_METHOD.PUT,
          path: HOSTED_SERVICE_PATH.REPOSITORY_PINS,
          body: JSON.stringify(asked),
        },
        repositoryPinsAnswerSchema,
      ),
      (answer) => answer?.pins,
    );
  }

  /**
   * Starts a plan from the account's template, on the repository the
   * request names where it names one; a request the service would refuse by
   * shape is refused here without traveling at all, and a repository the
   * service refused is answered as the refusal it was.
   */
  create(
    request: PlanCreateRequest,
  ): Effect.Effect<PlanCallResult<Plan, StartCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planCreateRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.PLANS,
        body: JSON.stringify(admitted),
      });
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (answer.response.ok) {
        const started = Result.getOrUndefined(readServiceAnswer(planAnswerSchema)(payload));
        return started === undefined ? UNANSWERED : succeeded(started.plan);
      }
      return refusedAs(payload, START_REFUSALS);
    });
  }
}

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}
