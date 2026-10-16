import { HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Effect, Redacted, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  callAnswered,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import { type PrFetchRequest, prFetchAnswerSchema } from "./pr-fetch-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR, hostedErrorSchema, readServiceAnswer } from "./service-wire.js";

/**
 * pr-fetch-client.ts -- the host's ask for a pull request's head and the token it is fetched with, before the Mac runs it.
 *
 * One account call, so the bearer is read fresh per attempt and a 401 is
 * renewed and retried once. The token in the answer is sealed the moment
 * it is read, so what this client hands back carries it only as a
 * `Redacted`, which prints as nothing; the rest of the body is dropped. A
 * call never fails: the service's refusal, or its silence, is answered as
 * one of `PR_FETCH_REFUSAL`, which says nothing the service did not.
 */

/** Why there is no grant. */
export const PR_FETCH_REFUSAL = {
  /** The workspace is not the account's, or its repository holds no such pull request. */
  NOT_FOUND: "not-found",
  /** The workspace's GitHub installation does not reach the repository. */
  NOT_REACHABLE: "not-reachable",
  /** The service or GitHub did not answer; a later try may. */
  UNANSWERED: "unanswered",
} as const;

export type PrFetchRefusal = (typeof PR_FETCH_REFUSAL)[keyof typeof PR_FETCH_REFUSAL];

/** What the Mac fetches with: the pull request's head as GitHub held it when asked, and a contents-read token for its repository alone. */
export interface PrFetchGrant {
  readonly headSha: string;
  /** The pull request's head branch, as named on its own repository. */
  readonly headRef: string;
  readonly token: Redacted.Redacted<string>;
  readonly expiresAt: string;
}

export type PrFetchOutcome = PrFetchGrant | { readonly refused: PrFetchRefusal };

export interface HostedPrFetchClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
}

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

/** The refusal a refused body names, where this client knows it; unanswered otherwise. */
function refusalOf(body: WireBoundaryInput): PrFetchRefusal {
  const error = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(unparsedWire(body)));
  if (error === HOSTED_API_ERROR.NOT_FOUND) return PR_FETCH_REFUSAL.NOT_FOUND;
  if (error === HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE) return PR_FETCH_REFUSAL.NOT_REACHABLE;
  return PR_FETCH_REFUSAL.UNANSWERED;
}

export class HostedPrFetchClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedPrFetchClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
    });
  }

  /** The pull request's head and a token to fetch it with, or why there is none; an answer for another pull request than asked is none. */
  fetch(request: PrFetchRequest): Effect.Effect<PrFetchOutcome, never, HttpClient.HttpClient> {
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.GITHUB_PR_FETCH,
        body: JSON.stringify(request),
      });
      if (!callAnswered(answer)) return { refused: PR_FETCH_REFUSAL.UNANSWERED };
      const body = yield* jsonOf(answer.response);
      if (!answer.response.ok) return { refused: refusalOf(body) };
      const read = Result.getOrUndefined(
        readServiceAnswer(prFetchAnswerSchema)(unparsedWire(body)),
      );
      const same =
        read !== undefined &&
        read.workspaceId === request.workspaceId &&
        read.repository.toLowerCase() === request.repository.toLowerCase() &&
        read.prNumber === request.prNumber;
      if (!same) return { refused: PR_FETCH_REFUSAL.UNANSWERED };
      return {
        headSha: read.headSha,
        headRef: read.headRef,
        token: Redacted.make(read.token),
        expiresAt: read.expiresAt,
      };
    });
  }
}
