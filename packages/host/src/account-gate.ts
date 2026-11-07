/**
 * account-gate.ts -- whether a composer may ask the service now, and what a call the closed gate kept from it answers: the one copy the agents' and the account's asks' composers share.
 *
 * The gate stands open on a run that sends, behind an account whose
 * capabilities are active. A call it keeps is answered unanswered, saying
 * why, so a window never reports it as a service that did not answer.
 */

import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { FAILURE_FACT, type FailureFacts, GATE_CLOSED_BY } from "@repo/features/failure-facts";
import { Effect } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { RunMode } from "./run-mode.js";

/** What the gate is read from: whether this run sends, and whether an account stands behind it. */
export interface AccountGateDependencies {
  readonly kernel: { readonly runMode: Pick<RunMode, "sendsNetwork"> };
  readonly account: Pick<AccountComposer, "capabilitiesActive">;
}

/** What a call the closed gate kept from the service answers: unanswered, as the window draws it, with why the host asked nothing. */
export interface GateClosed {
  readonly failure: typeof AGENT_CALL_FAILURE.UNANSWERED;
  readonly cause: FailureFacts;
}

/** Why the service may not be asked now: a run that sends nothing, or no account behind the gate; none where it may. */
export function closedBy({ kernel, account }: AccountGateDependencies): string | undefined {
  if (!kernel.runMode.sendsNetwork) return GATE_CLOSED_BY.NO_NETWORK;
  return account.capabilitiesActive() ? undefined : GATE_CLOSED_BY.NO_ACCOUNT;
}

/** The answer of a call the gate kept from the service, saying why, so it is never reported as a service that did not answer. */
export function gateClosed(by: string): GateClosed {
  return {
    failure: AGENT_CALL_FAILURE.UNANSWERED,
    cause: { _tag: FAILURE_FACT.GATE_CLOSED, code: by },
  };
}

/** Whether the service may be asked now: a run that sends, behind an open account gate. */
export function gateOf(dependencies: AccountGateDependencies): () => boolean {
  return () => closedBy(dependencies) === undefined;
}

/** The service asked behind the gate, over the host's own HTTP client. */
export function askedOf(dependencies: AccountGateDependencies, http: HttpClient.HttpClient) {
  return <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | GateClosed> => {
    const by = closedBy(dependencies);
    return by === undefined
      ? Effect.provideService(call, HttpClient.HttpClient, http)
      : Effect.succeed(gateClosed(by));
  };
}

/** The service asked behind the gate, as `askedOf` answers it. */
export type Asked = ReturnType<typeof askedOf>;
