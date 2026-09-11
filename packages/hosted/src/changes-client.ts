import type { CloudFetch, WireRecord } from "@sidecar/wire";
import { type AccountCall, accountBearer, createAccountCall } from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  type ChangesAnswer,
  type ChangesRequest,
  changesAnswerSchema,
  changesRequestSchema,
} from "./reads-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

export interface HostedChangesClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  fetch?: CloudFetch;
  requestTimeoutMs?: number;
}

/** The change-signal poll is one method on its path. */
const CHANGES_METHOD = "POST";

/**
 * The request as the record that travels, field by field: the device, and
 * each instant exactly as the caller stated it — a number, `null` to clear,
 * or left out to leave — so what is sent is what the schema admitted and
 * never a field the schema did not name.
 */
function changesRecord(request: ChangesRequest): WireRecord {
  return {
    deviceId: request.deviceId,
    ...(request.activeUntil !== undefined ? { activeUntil: request.activeUntil } : undefined),
    ...(request.quietUntil !== undefined ? { quietUntil: request.quietUntil } : undefined),
  };
}

/**
 * A device's side of the change signal: one poll that carries the device's
 * own presence and quiet instants and answers where every resource's read
 * stands. It is the shared account call — the token read fresh per attempt, a
 * 401 refreshed and retried once, the answer validated by the shared wire
 * contract — and a failure resolves to nothing, because the next poll asks
 * again. A request the service would refuse by shape is refused here without
 * traveling at all.
 */
export class HostedChangesClient {
  readonly #call: AccountCall;

  constructor(options: HostedChangesClientOptions) {
    this.#call = createAccountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      fetch: options.fetch,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  poll(request: ChangesRequest): Promise<ChangesAnswer | undefined> {
    const admitted = changesRequestSchema.parse(changesRecord(request));
    if (admitted === undefined) return Promise.resolve(undefined);
    return this.#call.ask(
      {
        method: CHANGES_METHOD,
        path: HOSTED_SERVICE_PATH.CHANGES,
        body: JSON.stringify(changesRecord(admitted)),
      },
      (payload) => changesAnswerSchema.parse(payload),
    );
  }
}
