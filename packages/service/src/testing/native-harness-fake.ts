import { randomUUID } from "node:crypto";
import { Effect, Layer, Option } from "effect";
import { NATIVE_SESSION_PREFIX } from "../agents/coder-host/native-runtime.js";
import {
  NativeAgentSessions,
  type NativeAgentSessionsService,
  RUNNER_CHECKOUT,
  RUNNER_CHOICE,
  type RunnerCheckout,
} from "../agents/coder-host/runtime-sessions.js";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
} from "../agents/eve-host/eve-sessions.js";

export function harnessFor(account: string): string {
  return `harness for ${account}`;
}

export function scriptedHarness(
  script: (account: string) => AgentSessions,
  checkout: RunnerCheckout = RUNNER_CHECKOUT.NOT_LIVE,
): NativeAgentSessionsService {
  return {
    sessions: (_runtime, account) =>
      Option.some(
        Effect.succeed({
          ...script(account),
          retune: () => Effect.succeed(RUNNER_CHOICE.NOT_LIVE),
          checkOut: () => Effect.succeed(checkout),
          halt: () => Effect.succeed(true),
          deliverWaiting: () => Effect.succeed(false),
        }),
      ),
  };
}

export function scriptedHarnessLayer(
  script: (account: string) => AgentSessions,
): Layer.Layer<NativeAgentSessions> {
  return Layer.succeed(NativeAgentSessions, scriptedHarness(script));
}

interface HeardCall {
  readonly call: "open" | "send";
  readonly account: string;
}

export function recordingHarness() {
  const heard: HeardCall[] = [];
  const layer = scriptedHarnessLayer((account) => ({
    open: () =>
      Effect.sync(() => {
        heard.push({ call: "open", account });
        return {
          outcome: EVE_SEND_OUTCOME.ACCEPTED,
          sessionId: `${NATIVE_SESSION_PREFIX.claude_code}${randomUUID()}`,
        } as const;
      }),
    send: (sessionId) =>
      Effect.sync(() => {
        heard.push({ call: "send", account });
        return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId: randomUUID() } as const;
      }),
    cancel: () => Effect.succeed({ outcome: EVE_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: EVE_RESET_OUTCOME.RESET }),
  }));
  return { heard, layer };
}
