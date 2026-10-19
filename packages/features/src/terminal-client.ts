import { HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Effect, Result, type Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountCall,
  type CallAnswer,
  type CallCredential,
  callAnswered,
} from "./account-call.js";
import { agentSandboxResumePath, agentTerminalPath, agentTerminalsPath } from "./service-paths.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";
import {
  TERMINAL_REFUSAL,
  type TerminalCreatedActAnswer,
  type TerminalRefusal,
  type TerminalResumedActAnswer,
  type TerminalsActAnswer,
} from "./terminal-view.js";
import {
  sandboxResumedAnswerSchema,
  TERMINAL_RELAY,
  terminalCreatedAnswerSchema,
  terminalsAnswerSchema,
} from "./terminal-wire.js";

/**
 * terminal-client.ts -- a coding agent's terminals, as the host asks the service for them: its shells listed, started, named, and ended, its sandbox resumed, and the address one shell's relay socket opens on.
 *
 * Every call is the one account call, so the bearer is read fresh per
 * attempt and a 401 is renewed and retried once. A refusal the tab has
 * something to say of is answered as one; anything else — the network, an
 * outage, a shape this build does not read — answers unanswered, which the
 * desktop draws as the act's own refusal. Nothing a shell printed ever
 * travels here: these calls carry ids and names, and the bytes travel on the
 * relay socket alone.
 */

export interface HostedTerminalClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

/** A call the service did not answer in a shape the tab reads. */
export const TERMINAL_UNANSWERED = { unanswered: true } as const;

export type TerminalUnanswered = typeof TERMINAL_UNANSWERED;

/** The service's refusals the tab has something to say of, by the service's own word for each. */
const TERMINAL_REFUSALS: ReadonlyMap<HostedApiError, TerminalRefusal> = new Map([
  [HOSTED_API_ERROR.NOT_FOUND, TERMINAL_REFUSAL.NOT_FOUND],
  [HOSTED_API_ERROR.AGENT_RETIRED, TERMINAL_REFUSAL.GONE],
  [HOSTED_API_ERROR.AGENT_NOT_READY, TERMINAL_REFUSAL.AGENT_NOT_READY],
  [HOSTED_API_ERROR.SANDBOX_STOPPED, TERMINAL_REFUSAL.SANDBOX_STOPPED],
  // The terminal routes' upstream is the agent's sandbox alone, Vercel Sandbox's API or tmux in it, so its failure is the sandbox's.
  [HOSTED_API_ERROR.UPSTREAM_ERROR, TERMINAL_REFUSAL.SANDBOX_UNANSWERED],
]);

/** What one shell's relay socket asks for: the agent, the shell, and the terminal's size. */
export interface TerminalRelayAsk {
  readonly agentId: string;
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
}

/** The relay address one shell's socket opens on, at the service's socket origin. */
export function terminalRelayAddress(socketOrigin: string, ask: TerminalRelayAsk): string {
  const query = new URLSearchParams({
    [TERMINAL_RELAY.QUERY.AGENT]: ask.agentId,
    [TERMINAL_RELAY.QUERY.TERMINAL]: ask.terminalId,
    [TERMINAL_RELAY.QUERY.COLUMNS]: String(ask.cols),
    [TERMINAL_RELAY.QUERY.ROWS]: String(ask.rows),
  });
  return `${socketOrigin}${TERMINAL_RELAY.PATH}?${query}`;
}

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

/**
 * An answer read whole: the body the schema admits where the service
 * answered, a key a newer service added dropped rather than refused, the
 * refusal where it is one the tab names, and unanswered for everything else.
 */
function readAnswer<Answer, Encoded>(
  answer: CallAnswer,
  schema: Schema.Codec<Answer, Encoded>,
): Effect.Effect<Answer | { readonly refused: TerminalRefusal } | TerminalUnanswered> {
  if (!callAnswered(answer)) return Effect.succeed(TERMINAL_UNANSWERED);
  return Effect.map(jsonOf(answer.response), (body) => {
    const payload = unparsedWire(body);
    if (!answer.response.ok) {
      const error = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
      const refused = error === undefined ? undefined : TERMINAL_REFUSALS.get(error);
      return refused === undefined ? TERMINAL_UNANSWERED : { refused };
    }
    return Result.getOrUndefined(readServiceAnswer(schema)(payload)) ?? TERMINAL_UNANSWERED;
  });
}

/**
 * The tab's reads and writes of one agent's shells, and the resume of its
 * sandbox, as the service answers them.
 */
export class HostedTerminalClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedTerminalClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** The agent's shells, oldest first, and where its sandbox stands; a stopped sandbox is never woken by it. */
  list(
    agentId: string,
  ): Effect.Effect<TerminalsActAnswer | TerminalUnanswered, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: agentTerminalsPath(agentId) }),
      (answer) => readAnswer(answer, terminalsAnswerSchema),
    );
  }

  /** A new shell in the agent's running sandbox, named where the developer named it. */
  create(
    agentId: string,
    title: string | undefined,
  ): Effect.Effect<TerminalCreatedActAnswer | TerminalUnanswered, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: agentTerminalsPath(agentId),
        body: JSON.stringify(title === undefined ? {} : { title }),
      }),
      (answer) => readAnswer(answer, terminalCreatedAnswerSchema),
    );
  }

  /** One shell named anew, answering the shells as they stand after. */
  rename(
    agentId: string,
    terminalId: string,
    title: string,
  ): Effect.Effect<TerminalsActAnswer | TerminalUnanswered, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.PATCH,
        path: agentTerminalPath(agentId, terminalId),
        body: JSON.stringify({ title }),
      }),
      (answer) => readAnswer(answer, terminalsAnswerSchema),
    );
  }

  /** One shell ended, answering the shells as they stand after. */
  kill(
    agentId: string,
    terminalId: string,
  ): Effect.Effect<TerminalsActAnswer | TerminalUnanswered, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.DELETE, path: agentTerminalPath(agentId, terminalId) }),
      (answer) => readAnswer(answer, terminalsAnswerSchema),
    );
  }

  /** The agent's stopped sandbox resumed, on the developer's click, answering where it stands after. */
  resume(
    agentId: string,
  ): Effect.Effect<TerminalResumedActAnswer | TerminalUnanswered, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.POST, path: agentSandboxResumePath(agentId) }),
      (answer) => readAnswer(answer, sandboxResumedAnswerSchema),
    );
  }
}
