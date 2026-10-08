import { HTTP_METHOD } from "@sidecar/wire";
import type { Effect } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { type AccountCallEffects, accountBearer, accountCall } from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import { type NotebookAnswer, notebookAnswerSchema } from "./notebook-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

/**
 * notebook-client.ts -- the desktop's one read of Luke's notebook, for the Settings page that shows it.
 *
 * The ask is the shared account call — the token read fresh per attempt, a
 * 401 refreshed and retried once, the answer validated by the shared wire
 * contract — and nothing here keeps what it read.
 */
export interface HostedNotebookClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

export class HostedNotebookClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedNotebookClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /**
   * Luke's notebook as the service holds it, read whole and bounded for its
   * owner to look at; nothing on this Mac keeps it past the screen that
   * asked. Nothing for a refusal, a fault, or a body outside the contract,
   * because the one caller does the same thing about each: says the notebook
   * could not be read just now.
   */
  notebook(): Effect.Effect<NotebookAnswer | undefined, never, HttpClient.HttpClient> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.BRAIN_NOTEBOOK },
      notebookAnswerSchema,
    );
  }
}
