import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import { askHosted, type HostedClient, type HostedFailure, hostedClient } from "./hosted-link.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";
import {
  TERMINAL_REFUSAL,
  type TerminalCreatedActAnswer,
  type TerminalRefusal,
  type TerminalResumedActAnswer,
  type TerminalsActAnswer,
} from "./terminal-view.js";
import { TERMINAL_RELAY } from "./terminal-wire.js";

export interface HostedTerminalClientOptions {
  credential: CallCredential;
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

export const TERMINAL_UNANSWERED = { unanswered: true } as const;

export type TerminalUnanswered = typeof TERMINAL_UNANSWERED;

const TERMINAL_REFUSALS: ReadonlyMap<HostedApiError, TerminalRefusal> = new Map([
  [HOSTED_API_ERROR.NOT_FOUND, TERMINAL_REFUSAL.NOT_FOUND],
  [HOSTED_API_ERROR.AGENT_RETIRED, TERMINAL_REFUSAL.GONE],
  [HOSTED_API_ERROR.AGENT_NOT_READY, TERMINAL_REFUSAL.AGENT_NOT_READY],
  [HOSTED_API_ERROR.SANDBOX_STOPPED, TERMINAL_REFUSAL.SANDBOX_STOPPED],
  [HOSTED_API_ERROR.SANDBOX_SNAPSHOT_GONE, TERMINAL_REFUSAL.SANDBOX_SNAPSHOT_GONE],
  [HOSTED_API_ERROR.UPSTREAM_ERROR, TERMINAL_REFUSAL.SANDBOX_UNANSWERED],
]);

export interface TerminalRelayAsk {
  readonly agentId: string;
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
}

export function terminalRelayAddress(socketOrigin: string, ask: TerminalRelayAsk): string {
  const query = new URLSearchParams({
    [TERMINAL_RELAY.QUERY.AGENT]: ask.agentId,
    [TERMINAL_RELAY.QUERY.TERMINAL]: ask.terminalId,
    [TERMINAL_RELAY.QUERY.COLUMNS]: String(ask.cols),
    [TERMINAL_RELAY.QUERY.ROWS]: String(ask.rows),
  });
  return `${socketOrigin}${TERMINAL_RELAY.PATH}?${query}`;
}

function terminalAnswer<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<
  Answer | { readonly refused: TerminalRefusal } | TerminalUnanswered,
  never,
  HttpClient.HttpClient
> {
  return Effect.catch(asked, (failed) => {
    const refused =
      failed._tag === "HostedRefused" ? TERMINAL_REFUSALS.get(failed.refusal) : undefined;
    return Effect.succeed(refused === undefined ? TERMINAL_UNANSWERED : { refused });
  });
}

export class HostedTerminalClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedTerminalClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  list(
    agentId: string,
  ): Effect.Effect<TerminalsActAnswer | TerminalUnanswered, never, HttpClient.HttpClient> {
    return terminalAnswer(askHosted(this.#hosted.agents.terminals, { id: agentId }));
  }

  create(
    agentId: string,
    title: string | undefined,
  ): Effect.Effect<TerminalCreatedActAnswer | TerminalUnanswered, never, HttpClient.HttpClient> {
    return terminalAnswer(
      askHosted(this.#hosted.agents.openTerminal, {
        params: { id: agentId },
        body: title === undefined ? {} : { title },
      }),
    );
  }

  rename(
    agentId: string,
    terminalId: string,
    title: string,
  ): Effect.Effect<TerminalsActAnswer | TerminalUnanswered, never, HttpClient.HttpClient> {
    return terminalAnswer(
      askHosted(this.#hosted.agents.renameTerminal, {
        params: { id: agentId, terminal: terminalId },
        body: { title },
      }),
    );
  }

  kill(
    agentId: string,
    terminalId: string,
  ): Effect.Effect<TerminalsActAnswer | TerminalUnanswered, never, HttpClient.HttpClient> {
    return terminalAnswer(
      askHosted(this.#hosted.agents.endTerminal, { id: agentId, terminal: terminalId }),
    );
  }

  resume(
    agentId: string,
  ): Effect.Effect<TerminalResumedActAnswer | TerminalUnanswered, never, HttpClient.HttpClient> {
    return terminalAnswer(askHosted(this.#hosted.agents.sandboxResume, { id: agentId }));
  }
}
