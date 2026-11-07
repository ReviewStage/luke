import type { CallCredential } from "./account-call.js";
import { githubContract } from "./contract/github.js";
import { hostedCall } from "./hosted-call.js";
import { failureSetOf, type HostedFailed } from "./hosted-failure.js";
import { type HostedClient, hostedClient } from "./hosted-link.js";
import type { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * github-connection-client.ts -- whether the signed-in account has connected its GitHub, and the page that connects it, as the host asks the service for them.
 *
 * Every call is a procedure of the hosted contract over the account call
 * (`hosted-link.ts`), so the bearer is read fresh per attempt and a 401 is
 * renewed and retried once. Each answers the procedure's output or how it
 * failed (`hostedCall`), so a caller tells a service that did not answer
 * apart from an answer it can draw. A disconnect is Better Auth's own
 * unlink on the service, so it carries the Mac's Better Auth session rather
 * than its OAuth token, asking for one through the browser's hand-off where
 * there is none.
 */

/** The procedures this client asks. */
const githubConnectionContract = {
  connect: githubContract.connect,
  connection: githubContract.connection,
  disconnect: githubContract.disconnect,
};

/** Why a GitHub connection call has no answer: the service never gave one the wire reads, or GitHub is the account's only way to sign in. */
export const GITHUB_CONNECTION_CALL_FAILURE = failureSetOf(githubConnectionContract);

export type GitHubConnectionCallFailure =
  (typeof GITHUB_CONNECTION_CALL_FAILURE)[keyof typeof GITHUB_CONNECTION_CALL_FAILURE];

/** A connect, a status read, or a disconnect: its answer, or why there is none. */
export type GitHubConnectionCallResult<Answer> =
  | Answer
  | HostedFailed<typeof HOSTED_API_ERROR.NOT_PERMITTED>;

export interface HostedGitHubConnectionClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The Mac's own Better Auth session, for the calls that write through Better Auth's organization endpoints. */
  sessionCredential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

export class HostedGitHubConnectionClient {
  readonly #hosted: HostedClient;
  /** The client for the disconnect, under the Mac's session. */
  readonly #inSession: HostedClient;

  constructor(options: HostedGitHubConnectionClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#inSession = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.sessionCredential,
      requestTimeoutMs: options.requestTimeoutMs,
      inSession: true,
    });
  }

  /** A new connect intent: the page the browser opens to connect the account's GitHub. */
  connect() {
    return hostedCall(this.#hosted.github.connect, undefined);
  }

  /** Whether the account has connected its GitHub, and its login where the service holds one. */
  status() {
    return hostedCall(this.#hosted.github.connection, undefined);
  }

  /** The account's GitHub disconnected on the service, answering the connection as it then stands. */
  disconnect() {
    return hostedCall(this.#inSession.github.disconnect, undefined);
  }
}
