import type { CallCredential } from "./account-call.js";
import { hostedCall } from "./hosted-call.js";
import { type HostedClient, hostedClient } from "./hosted-link.js";
import { TERMINAL_RENAMES } from "./terminal-view.js";
import { TERMINAL_RELAY } from "./terminal-wire.js";

/**
 * terminal-client.ts -- a coding agent's terminals, as the host asks the service for them: its shells listed, started, named, and ended, its sandbox resumed, and the address one shell's relay socket opens on.
 *
 * Every call is a procedure of the hosted contract over the one account
 * call (`hosted-link.ts`), so the bearer is read fresh per attempt and a
 * 401 is renewed and retried once. Each answers what the service said or
 * how the call failed (`hostedCall`), a refusal spelled as the tab reads it
 * (`TERMINAL_RENAMES`); anything else — the network, an outage, a shape this
 * build does not read — is unanswered, which the desktop draws as the act's
 * own refusal. Nothing a shell printed ever
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

/**
 * The tab's reads and writes of one agent's shells, and the resume of its
 * sandbox, as the service answers them.
 */
export class HostedTerminalClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedTerminalClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** The agent's shells, oldest first, and where its sandbox stands; a stopped sandbox is never woken by it. */
  list(agentId: string) {
    return hostedCall(this.#hosted.agents.terminals, { id: agentId }, { as: TERMINAL_RENAMES });
  }

  /** A new shell in the agent's running sandbox, named where the developer named it. */
  create(agentId: string, title: string | undefined) {
    return hostedCall(
      this.#hosted.agents.openTerminal,
      { params: { id: agentId }, body: title === undefined ? {} : { title } },
      { as: TERMINAL_RENAMES },
    );
  }

  /** One shell named anew, answering the shells as they stand after. */
  rename(agentId: string, terminalId: string, title: string) {
    return hostedCall(
      this.#hosted.agents.renameTerminal,
      { params: { id: agentId, terminal: terminalId }, body: { title } },
      { as: TERMINAL_RENAMES },
    );
  }

  /** One shell ended, answering the shells as they stand after. */
  kill(agentId: string, terminalId: string) {
    return hostedCall(
      this.#hosted.agents.endTerminal,
      { id: agentId, terminal: terminalId },
      { as: TERMINAL_RENAMES },
    );
  }

  /** The agent's stopped sandbox resumed, on the developer's click, answering where it stands after. */
  resume(agentId: string) {
    return hostedCall(this.#hosted.agents.sandboxResume, { id: agentId }, { as: TERMINAL_RENAMES });
  }
}
