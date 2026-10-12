import { carried, GATEWAY_METHOD, type GatewayMethodTable } from "@sidecar/gateway";
import type { HostedLinearClient } from "@sidecar/hosted";
import {
  LINEAR_CALL_FAILURE,
  type LinearConnectView,
  type LinearStatusView,
} from "@sidecar/hosted/linear-view";
import { Effect, type Scope } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-linear.ts -- the account's Linear connection, asked of the service on the window's behalf: where it stands, a sign-in begun, the connection ended.
 *
 * Nothing is held here. A Connect asks the service to begin a sign-in and
 * opens the address it answered in the browser through the native node,
 * here, so the address, which begins a grant for the account, never reaches
 * a window or a report; the window hears only whether the browser was sent.
 * It learns how the sign-in settled by reading where the connection stands
 * again, which it does when it is shown and when the developer comes back
 * from the browser. Behind a closed account gate, or on a run that sends
 * nothing, every ask answers unanswered.
 */

/** The service's side of the connection, as this concern asks it. */
export type LinearClient = Pick<HostedLinearClient, "status" | "connect" | "disconnect">;

export interface LinearDependencies {
  kernel: { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: LinearClient;
  /** Hands an address to the operating system; answers whether it took it. */
  openExternal: (url: string) => Effect.Effect<boolean>;
}

export type LinearComposer = Composer;

const UNANSWERED = { failure: LINEAR_CALL_FAILURE.UNANSWERED } as const;

export function composeLinear(
  dependencies: LinearDependencies,
): Effect.Effect<LinearComposer, never, Scope.Scope> {
  return Effect.sync(() => composed(dependencies));
}

/** The composer's one table, built from its seams; nothing here starts anything. */
function composed(dependencies: LinearDependencies): LinearComposer {
  const { kernel, account, client, openExternal } = dependencies;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  /** The service asked behind the gate, over the ambient fetch client. */
  const asked = <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provide(call, FetchHttpClient.layer) : Effect.succeed(UNANSWERED);

  /** A sign-in begun and its address opened; the window hears whether it was, and nothing of the address. */
  const connect: Effect.Effect<LinearConnectView> = Effect.gen(function* () {
    const answer = yield* asked(client.connect());
    if ("failure" in answer) return answer;
    const opened = yield* openExternal(answer.url);
    return opened ? { opened: true } : { failure: LINEAR_CALL_FAILURE.NOT_OPENED };
  });

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.LINEAR_STATUS]: () =>
      Effect.map(asked(client.status()), (answer) => carried<LinearStatusView>(answer)),
    [GATEWAY_METHOD.LINEAR_CONNECT]: () =>
      Effect.map(connect, (answer) => carried<LinearConnectView>(answer)),
    [GATEWAY_METHOD.LINEAR_DISCONNECT]: () =>
      Effect.map(asked(client.disconnect()), (answer) => carried<LinearStatusView>(answer)),
  };

  return { methods, lifetime: Effect.void };
}
