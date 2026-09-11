import type * as HttpClient from "@effect/platform/HttpClient";
import type { CloudAgentProviderId } from "@sidecar/session";
import {
  type CloudFetch,
  HTTP_METHOD,
  type Schema,
  unparsedWire,
  type WireRecord,
} from "@sidecar/wire";
import { layerFromCloudFetch } from "@sidecar/wire/effect";
import { Effect, type Layer } from "effect";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  CALL_FAULT,
  callAnswered,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  type HostedActionAnswer,
  type HostedActionWorkspaceAnswer,
  hostedActionAnswerSchema,
  hostedActionWorkspaceAnswerSchema,
} from "./action-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

export interface HostedActionClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  fetch?: CloudFetch;
  requestTimeoutMs?: number;
}

/** The cloud session an action names, by the two identifiers the service admits against. */
export interface HostedActionTarget {
  providerId: CloudAgentProviderId;
  providerSessionId: string;
}

/**
 * How an action call ended short of an answer, told apart by the one thing
 * the caller has to know: whether the action may have landed. A call that
 * never left, or that the service turned away at its door, ran nothing; a
 * call that left and lost its answer, or came back unreadable, may have.
 */
export const HOSTED_ACTION_FAILURE = {
  /** No account stood to send it under, or the account changed under the call. */
  NOT_SENT: "not-sent",
  /** The call left and no answer came back. */
  LOST: "lost",
  /** The service refused the request before admitting anything. */
  REFUSED: "refused",
  /** The service answered in a shape this build cannot read. */
  UNREADABLE: "unreadable",
} as const;

export type HostedActionFailure =
  (typeof HOSTED_ACTION_FAILURE)[keyof typeof HOSTED_ACTION_FAILURE];

export type HostedActionOutcome = { answer: HostedActionAnswer } | { failure: HostedActionFailure };

/** A creation's outcome: the same ends, and an answer that may name the session the provider made. */
export type HostedActionWorkspaceOutcome =
  | { answer: HostedActionWorkspaceAnswer }
  | { failure: HostedActionFailure };

/**
 * A new workspace, as the creation endpoint takes it: the project the
 * provider itself listed, and the developer's own bounded words for what
 * the agent should start on. The model and effort ride only beside the agent
 * they pair with, as one selection, so the service's admission holds the
 * pairing to the build's table exactly as the desktop's did.
 */
export interface HostedWorkspaceCreation {
  providerProjectId: string;
  agent?: string | undefined;
  model?: string | undefined;
  effort?: string | undefined;
  name?: string | undefined;
  task?: string | undefined;
}

/** Another agent in an observed workspace: one of the kinds the row's own observation listed. */
export interface HostedAgentAddition {
  agent: string;
  model?: string | undefined;
  effort?: string | undefined;
  name?: string | undefined;
  task?: string | undefined;
}

/** A record with the absent fields left out, so the wire carries what was asked and no `undefined`. */
function present(fields: HostedWorkspaceCreation | HostedAgentAddition): WireRecord {
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * The desktop's side of every session action the service carries: the two a
 * row asks for — the message typed into its composer and the press of a
 * control its provider advertised — and the four the brain asks for at the
 * developer's word, a new workspace, another agent, and the two renames.
 * Each is one call on the signed-in account; the service admits it against
 * the stored snapshot the same account's rows were drawn from, builds the
 * write from that snapshot's own advertisement, and answers what the provider
 * said. Nothing here decides whether the action may run, and nothing here
 * holds a roster: the target is two identifiers and the ask is the words.
 */
export class HostedActionClient {
  readonly #call: AccountCallEffects;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;

  constructor(options: HostedActionClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#client = layerFromCloudFetch(options.fetch ?? ((input, init) => fetch(input, init)));
  }

  sendMessage(target: HostedActionTarget, text: string): Promise<HostedActionOutcome> {
    return this.#post(
      HOSTED_SERVICE_PATH.ACTION_MESSAGE,
      { ...targetRecord(target), text },
      hostedActionAnswerSchema,
    );
  }

  executeControl(target: HostedActionTarget, controlId: string): Promise<HostedActionOutcome> {
    return this.#post(
      HOSTED_SERVICE_PATH.ACTION_CONTROL,
      { ...targetRecord(target), controlId },
      hostedActionAnswerSchema,
    );
  }

  createWorkspace(
    providerId: CloudAgentProviderId,
    creation: HostedWorkspaceCreation,
  ): Promise<HostedActionWorkspaceOutcome> {
    return this.#post(
      HOSTED_SERVICE_PATH.ACTION_WORKSPACE,
      { providerId, ...present(creation) },
      hostedActionWorkspaceAnswerSchema,
    );
  }

  addAgent(
    target: HostedActionTarget,
    addition: HostedAgentAddition,
  ): Promise<HostedActionOutcome> {
    return this.#post(
      HOSTED_SERVICE_PATH.ACTION_AGENT,
      { ...targetRecord(target), ...present(addition) },
      hostedActionAnswerSchema,
    );
  }

  renameSession(target: HostedActionTarget, name: string): Promise<HostedActionOutcome> {
    return this.#post(
      HOSTED_SERVICE_PATH.ACTION_RENAME_SESSION,
      { ...targetRecord(target), name },
      hostedActionAnswerSchema,
    );
  }

  renameWorkspace(target: HostedActionTarget, name: string): Promise<HostedActionOutcome> {
    return this.#post(
      HOSTED_SERVICE_PATH.ACTION_RENAME_WORKSPACE,
      { ...targetRecord(target), name },
      hostedActionAnswerSchema,
    );
  }

  /** One action call, its answer read by the schema of the route it went to. */
  async #post<Answer extends HostedActionAnswer>(
    path: string,
    body: WireRecord,
    answerSchema: Schema<Answer>,
  ): Promise<{ answer: Answer } | { failure: HostedActionFailure }> {
    const sent = await this.#run(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path,
        body: JSON.stringify(body),
      }),
    );
    if (!callAnswered(sent)) {
      // A client that could not carry the request may have failed after it
      // left, so a network fault is an answer lost rather than a call never made.
      return {
        failure:
          sent.fault === CALL_FAULT.NETWORK
            ? HOSTED_ACTION_FAILURE.LOST
            : HOSTED_ACTION_FAILURE.NOT_SENT,
      };
    }
    if (!sent.response.ok) return { failure: HOSTED_ACTION_FAILURE.REFUSED };
    const payload = await sent.response.json().catch(() => undefined);
    const answer = payload === undefined ? undefined : answerSchema.parse(unparsedWire(payload));
    return answer ? { answer } : { failure: HOSTED_ACTION_FAILURE.UNREADABLE };
  }

  #run<Answer>(effect: Effect.Effect<Answer, never, HttpClient.HttpClient>): Promise<Answer> {
    return Effect.runPromise(Effect.provide(effect, this.#client));
  }
}

function targetRecord(target: HostedActionTarget): WireRecord {
  return { providerId: target.providerId, providerSessionId: target.providerSessionId };
}
