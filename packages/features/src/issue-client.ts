import {
  HTTP_METHOD,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Duration, Effect, Result, type Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  type CallAnswer,
  type CallRequest,
  callAnswered,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  ISSUE_CALL_FAILURE,
  type IssueCallFailure,
  type IssueChangeParams,
  type IssueCreateParams,
  type IssueIdParams,
  type IssueListParams,
  type IssueListView,
  type IssueView,
  issueChangeParamsSchema,
  issueCreateParamsSchema,
} from "./issue-view.js";
import { ISSUE_LIST_QUERY, issueAnswerSchema, issueListAnswerSchema } from "./issue-wire.js";
import { HOSTED_SERVICE_PATH, issuePath } from "./service-paths.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";

/**
 * issue-client.ts -- the window's side of a workspace's issues, as the host asks the service for them.
 *
 * Every call is the one account call, so the bearer is read fresh per
 * attempt and a 401 is renewed and retried once. Each call answers what the
 * service said or why there is no answer, never a failure, because every
 * caller does the same with one: says why, and offers to try again. A write
 * the service would refuse by shape is refused here without traveling.
 */

export interface HostedIssueClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

type Failed = { readonly failure: IssueCallFailure };

const UNANSWERED: Failed = { failure: ISSUE_CALL_FAILURE.UNANSWERED };

const INVALID: Failed = { failure: ISSUE_CALL_FAILURE.INVALID };

/** The refusals a call may answer with, by the service's own word for each. */
type NamedRefusals = Readonly<Partial<Record<HostedApiError, IssueCallFailure>>>;

/** The refusals every issue call can answer with. */
const REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: ISSUE_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.INVALID_REQUEST]: ISSUE_CALL_FAILURE.INVALID,
} satisfies NamedRefusals;

/** A body's text, read to its end. */
function textOf(reader: ReadableStreamDefaultReader<Uint8Array>): Effect.Effect<string, unknown> {
  return Effect.gen(function* () {
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = yield* Effect.tryPromise(() => reader.read());
      if (done) return text + decoder.decode();
      text += decoder.decode(value, { stream: true });
    }
  });
}

/**
 * A response's body as JSON, read within the deadline; nothing where it is
 * not JSON at all, and nothing, its stream cancelled so its connection is
 * let go, where it has not ended by then.
 * Note that the account call's own deadline ends with the headers, so a
 * body that stalls after them is bounded here, or the call would never
 * answer.
 */
function jsonWithin(
  response: Response,
  deadline: Duration.Duration,
): Effect.Effect<WireBoundaryInput> {
  const reader = response.body?.getReader();
  if (reader === undefined) return Effect.succeed(undefined);
  const parsed = Effect.flatMap(textOf(reader), (text) =>
    Effect.promise(
      (): Promise<WireBoundaryInput> => new Response(text).json().catch(() => undefined),
    ),
  );
  return parsed.pipe(
    Effect.catch(() => Effect.succeed(undefined)),
    Effect.timeoutOrElse({
      duration: deadline,
      orElse: () => Effect.as(Effect.ignore(Effect.tryPromise(() => reader.cancel())), undefined),
    }),
  );
}

/** The refusal a refused answer carries, where it is one this client names; unanswered otherwise. */
function refusedAs(payload: UnparsedWireValue, named: NamedRefusals): Failed {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  const failure = refusal === undefined ? undefined : named[refusal];
  return failure === undefined ? UNANSWERED : { failure };
}

/** An answer read whole within the deadline: the body the schema admits, a key a newer service added dropped, or why there is none. */
function readAnswer<Answer, Encoded>(
  answer: CallAnswer,
  schema: Schema.Codec<Answer, Encoded>,
  deadline: Duration.Duration,
): Effect.Effect<Answer | Failed> {
  if (!callAnswered(answer)) return Effect.succeed(UNANSWERED);
  return Effect.map(jsonWithin(answer.response, deadline), (body): Answer | Failed => {
    const payload = unparsedWire(body);
    if (!answer.response.ok) return refusedAs(payload, REFUSALS);
    return Result.getOrUndefined(readServiceAnswer(schema)(payload)) ?? UNANSWERED;
  });
}

/** The list's query: the workspace, and the archived issues where asked for. */
function listQuery(params: IssueListParams): string {
  const query = new URLSearchParams({ [ISSUE_LIST_QUERY.WORKSPACE_ID]: params.workspaceId });
  if (params.archived === true) query.set(ISSUE_LIST_QUERY.ARCHIVED, "true");
  return `?${query.toString()}`;
}

/** The window's reads and writes of a workspace's issues. */
export class HostedIssueClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedIssueClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /**
   * One call sent and its answer read, the body within a deadline of its
   * own once the headers arrive. Note that the body is not handed what the
   * call's deadline has left, because a renewal of the credential can spend
   * all of it before an answer that did arrive is read; one deadline more
   * keeps the call bounded without throwing such an answer away.
   */
  #asked<Answer, Encoded>(
    request: CallRequest,
    schema: Schema.Codec<Answer, Encoded>,
  ): Effect.Effect<Answer | Failed, never, HttpClient.HttpClient> {
    const deadline = Duration.millis(this.#call.requestTimeoutMs);
    return Effect.flatMap(this.#call.send(request), (answer) =>
      readAnswer(answer, schema, deadline),
    );
  }

  /** The workspace's issues, standing or archived, the most recently changed first. */
  list(params: IssueListParams): Effect.Effect<IssueListView, never, HttpClient.HttpClient> {
    return this.#asked(
      { method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.ISSUES}${listQuery(params)}` },
      issueListAnswerSchema,
    );
  }

  /** One issue, archived or not. */
  read(params: IssueIdParams): Effect.Effect<IssueView, never, HttpClient.HttpClient> {
    return this.#asked(
      { method: HTTP_METHOD.GET, path: issuePath(params.issueId) },
      issueAnswerSchema,
    );
  }

  /** An issue filed, answering it as the service kept it. */
  create(params: IssueCreateParams): Effect.Effect<IssueView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(issueCreateParamsSchema)(params));
    if (admitted === undefined) return Effect.succeed(INVALID);
    return this.#asked(
      {
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.ISSUES,
        body: JSON.stringify(admitted),
      },
      issueAnswerSchema,
    );
  }

  /** One issue changed, answering it as it then stands. */
  change(params: IssueChangeParams): Effect.Effect<IssueView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(issueChangeParamsSchema)(params));
    if (admitted === undefined) return Effect.succeed(INVALID);
    return this.#asked(
      {
        method: HTTP_METHOD.PATCH,
        path: issuePath(admitted.issueId),
        body: JSON.stringify(admitted.change),
      },
      issueAnswerSchema,
    );
  }
}
