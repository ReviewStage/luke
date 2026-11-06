import { CALL_FAULT } from "./account-call.js";
import { AGENT_STATUS, type AgentStatus } from "./agent-wire.js";
import type { HostedFailure } from "./hosted-link.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

export const CLI_EXIT = {
  OK: 0,
  REFUSED: 1,
  USAGE: 2,
  AUTH: 3,
  UNAVAILABLE: 4,
  TURN_FAILED: 5,
  TIMED_OUT: 6,
} as const;

export type CliExit = (typeof CLI_EXIT)[keyof typeof CLI_EXIT];

const STATUS = { UNAUTHORIZED: 401, FIRST_CLIENT_ERROR: 400, FIRST_SERVER_ERROR: 500 } as const;

export function cliExitOfStatus(status: number): CliExit {
  if (status === STATUS.UNAUTHORIZED) return CLI_EXIT.AUTH;
  if (status >= STATUS.FIRST_SERVER_ERROR) return CLI_EXIT.UNAVAILABLE;
  if (status >= STATUS.FIRST_CLIENT_ERROR) return CLI_EXIT.REFUSED;
  return CLI_EXIT.OK;
}

export function cliExitOfFault(fault: (typeof CALL_FAULT)[keyof typeof CALL_FAULT]): CliExit {
  return fault === CALL_FAULT.NETWORK ? CLI_EXIT.UNAVAILABLE : CLI_EXIT.AUTH;
}

export function cliExitOfHostedFailure(failed: HostedFailure): CliExit {
  if (failed._tag === "HostedRefused") {
    if (failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN) return CLI_EXIT.AUTH;
    return failed.refusal === HOSTED_API_ERROR.UNAVAILABLE
      ? CLI_EXIT.UNAVAILABLE
      : CLI_EXIT.REFUSED;
  }
  if (failed.fault !== undefined) return cliExitOfFault(failed.fault);
  return failed.status === undefined ? CLI_EXIT.UNAVAILABLE : cliExitOfStatus(failed.status);
}

export function cliExitOfAgentStatus(status: AgentStatus): CliExit | undefined {
  if (status === AGENT_STATUS.COMPLETED) return CLI_EXIT.OK;
  if (status === AGENT_STATUS.FAILED || status === AGENT_STATUS.CANCELED) {
    return CLI_EXIT.TURN_FAILED;
  }
  return undefined;
}
