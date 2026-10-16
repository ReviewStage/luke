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
import { runSnapshotAnswerSchema } from "./run-snapshot-wire.js";
import { agentRunSnapshotPath } from "./service-paths.js";
import { HOSTED_API_ERROR, hostedErrorSchema, readServiceAnswer } from "./service-wire.js";

/**
 * run-snapshot-client.ts -- the Mac's ask for a coding agent's working tree, to run it, and for the token it fetches the starting commit with.
 *
 * The one account call, so the bearer is read fresh per attempt and a 401 is
 * renewed and retried once. The token in the answer is sealed into a
 * `Redacted` the moment the body is read, so no caller ever holds it as a
 * string it could log, emit, or keep. The call never fails: a refusal or no
 * answer is one of `RUN_SNAPSHOT_REFUSAL`, which the caller words.
 */

/** Why the service handed no working tree. */
export const RUN_SNAPSHOT_REFUSAL = {
  /** The agent is not one the account reaches. */
  NOT_FOUND: "not-found",
  /** The agent has not started, so it has no sandbox yet. */
  NOT_READY: "not-ready",
  /** The agent is archived. */
  RETIRED: "retired",
  /** The workspace's GitHub installation does not reach the agent's repository. */
  NOT_REACHABLE: "not-reachable",
  /** The service, the sandbox, or GitHub behind them did not answer. */
  UNANSWERED: "unanswered",
} as const;

export type RunSnapshotRefusal = (typeof RUN_SNAPSHOT_REFUSAL)[keyof typeof RUN_SNAPSHOT_REFUSAL];

/** The agent's working tree as the Mac takes it, its token sealed. */
export interface RunSnapshotGrant {
  readonly repository: string;
  /** Where the agent's work starts, which GitHub holds. */
  readonly base: string;
  readonly branch: string | null;
  /** The gzipped binary patch, in base64. */
  readonly patch: string;
  readonly token: Redacted.Redacted<string>;
}

export type RunSnapshotOutcome =
  | { readonly snapshot: RunSnapshotGrant }
  | { readonly waking: true }
  | { readonly tooLarge: number }
  | { readonly refused: RunSnapshotRefusal };

export interface HostedRunSnapshotClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
}

/** The refusals this client names, by the service's own word for each. */
const REFUSALS = new Map<string, RunSnapshotRefusal>([
  [HOSTED_API_ERROR.NOT_FOUND, RUN_SNAPSHOT_REFUSAL.NOT_FOUND],
  [HOSTED_API_ERROR.AGENT_NOT_READY, RUN_SNAPSHOT_REFUSAL.NOT_READY],
  [HOSTED_API_ERROR.AGENT_RETIRED, RUN_SNAPSHOT_REFUSAL.RETIRED],
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, RUN_SNAPSHOT_REFUSAL.NOT_REACHABLE],
]);

/** The refusal the service's word names, where this client names one. */
function refusalOf(word: string | undefined): RunSnapshotRefusal {
  return (word === undefined ? undefined : REFUSALS.get(word)) ?? RUN_SNAPSHOT_REFUSAL.UNANSWERED;
}

const readAnswer = readServiceAnswer(runSnapshotAnswerSchema);
const readRefusal = readServiceAnswer(hostedErrorSchema);

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

export class HostedRunSnapshotClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedRunSnapshotClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
    });
  }

  /** The agent's working tree and a token for its repository, or that its sandbox is waking, or why there is none. */
  take(agentId: string): Effect.Effect<RunSnapshotOutcome, never, HttpClient.HttpClient> {
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send({
        method: HTTP_METHOD.POST,
        path: agentRunSnapshotPath(agentId),
      });
      if (!callAnswered(answer)) return { refused: RUN_SNAPSHOT_REFUSAL.UNANSWERED };
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (!answer.response.ok) {
        const refusal = Result.getOrUndefined(readRefusal(payload));
        return { refused: refusalOf(refusal) };
      }
      const read = Result.getOrUndefined(readAnswer(payload));
      if (read === undefined) return { refused: RUN_SNAPSHOT_REFUSAL.UNANSWERED };
      if ("waking" in read) return { waking: true };
      if ("tooLarge" in read) return { tooLarge: read.tooLarge };
      return {
        snapshot: {
          repository: read.repository,
          base: read.base,
          branch: read.branch,
          patch: read.patch,
          token: Redacted.make(read.token),
        },
      };
    });
  }
}
