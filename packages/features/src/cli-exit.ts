/**
 * cli-exit.ts -- the exit codes the `vespin` command ends with, and how a hosted call's end maps onto them.
 *
 * Every command of the command-line tool exits with one of these, so a
 * script or a coding agent calling it from a shell tells a refusal from a
 * typo, a lapsed sign-in, and an outage without reading the words. A
 * refusal the service answered is the caller's to fix; a call that reached
 * no answer, or a server error, is the service's or the network's.
 */

import { CALL_FAULT } from "./account-call.js";
import { AGENT_STATUS, type AgentStatus } from "./agent-wire.js";
import type { HostedFailure } from "./hosted-link.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/** The `vespin` command's exit codes, held to these so every command means the same by each. */
export const CLI_EXIT = {
  OK: 0,
  /** The service answered and refused: a missing task, a bad input, a limit. */
  REFUSED: 1,
  /** The command line itself was wrong: an unknown command, a missing argument, a bad flag. */
  USAGE: 2,
  /** No sign-in, or one the service no longer takes: `vespin login` fixes it. */
  AUTH: 3,
  /** The service could not be reached, or failed on its side. */
  UNAVAILABLE: 4,
  /** The agent's turn a command waited on ended without completing: it failed, or it was stopped (`agent wait`, `agent start --wait`). */
  TURN_FAILED: 5,
  /** The wait ran past its `--timeout` with the agent's turn still under way. */
  TIMED_OUT: 6,
} as const;

export type CliExit = (typeof CLI_EXIT)[keyof typeof CLI_EXIT];

/** The status a lapsed bearer is answered with, and the first a server error is. */
const STATUS = { UNAUTHORIZED: 401, FIRST_CLIENT_ERROR: 400, FIRST_SERVER_ERROR: 500 } as const;

/** What an answer's status says of the call: fine, refused, a lapsed sign-in, or a failure on the service's side. */
export function cliExitOfStatus(status: number): CliExit {
  if (status === STATUS.UNAUTHORIZED) return CLI_EXIT.AUTH;
  if (status >= STATUS.FIRST_SERVER_ERROR) return CLI_EXIT.UNAVAILABLE;
  if (status >= STATUS.FIRST_CLIENT_ERROR) return CLI_EXIT.REFUSED;
  return CLI_EXIT.OK;
}

/** What a call that ended before any status says: no sign-in to send, the account changed under it, or no network. */
export function cliExitOfFault(fault: (typeof CALL_FAULT)[keyof typeof CALL_FAULT]): CliExit {
  return fault === CALL_FAULT.NETWORK ? CLI_EXIT.UNAVAILABLE : CLI_EXIT.AUTH;
}

/** How a hosted procedure's failure ends the command. */
export function cliExitOfHostedFailure(failed: HostedFailure): CliExit {
  if (failed._tag === "HostedRefused") {
    if (failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN) return CLI_EXIT.AUTH;
    // Note that a refusal naming the service's own state is not the caller's to fix.
    return failed.refusal === HOSTED_API_ERROR.UNAVAILABLE
      ? CLI_EXIT.UNAVAILABLE
      : CLI_EXIT.REFUSED;
  }
  if (failed.fault !== undefined) return cliExitOfFault(failed.fault);
  return failed.status === undefined ? CLI_EXIT.UNAVAILABLE : cliExitOfStatus(failed.status);
}

/**
 * How an agent's turn stands for a command waiting on it: still under way
 * (starting, or running), or ended, with the code its end exits with. A
 * turn that completed is fine; one that failed or was stopped did not do
 * what was waited on.
 */
export function cliExitOfAgentStatus(status: AgentStatus): CliExit | undefined {
  if (status === AGENT_STATUS.COMPLETED) return CLI_EXIT.OK;
  if (status === AGENT_STATUS.FAILED || status === AGENT_STATUS.CANCELED) {
    return CLI_EXIT.TURN_FAILED;
  }
  return undefined;
}
