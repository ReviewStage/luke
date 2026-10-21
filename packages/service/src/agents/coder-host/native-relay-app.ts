/**
 * native-relay-app.ts -- where an eve app's call to a native harness is answered, in the web function that launches the runner.
 *
 * The eve apps bundle no runner (`native-relay.ts`), so the planner's tools
 * and an eve agent's post each `open`, `send`, `cancel`, and `reset` the
 * router hands a native harness here, and this route makes it on the
 * function's own harnesses (`NativeAgentSessions`, provided beside the
 * deployment's services by `apps/web/server/native-agents.ts`), answering
 * the harness's outcome as it stands.
 *
 * Only the deployment's own calls are admitted: the bearer must be
 * `EVE_DEPLOYMENT_SECRET`, compared in constant time, never the cron's; a
 * deployment that names none answers unavailable and runs nothing. The
 * call acts for the account it names, as eve's door acts for the account a
 * deployment call names (`../brain-host/auth.ts`'s `deploymentActor`), and
 * the harness reaches only what that account reaches. A message is also
 * held to the conversation's own agent: one the account reaches, on the
 * harness named, and one it may write to (`admitsPlanWriter`, under
 * `PLAN_AGENT_WRITER_POLICY`); a cancel or a reset to a session the harness
 * named minted. The answer is the harness's outcome alone, which carries no
 * token. A function with no harness answers `NATIVE_AGENT_NOT_HERE`.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  readCodingAgentOfConversation,
  readCodingAgentRouting,
} from "@luke/database/models/coding-agent-store";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { HostedEnvironment } from "../../environment.js";
import { bearerMatchesSecret, HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../../route.js";
import { admitsPlanWriter } from "../agent-reach.js";
import type { AgentSessions, EveUnreachable } from "../brain-host/eve-sessions.js";
import {
  NATIVE_RELAY_CALL,
  NATIVE_RELAY_PATH,
  type NativeRelayCall,
  NativeRelayCallSchema,
  relayedMessage,
} from "./native-relay.js";
import { nativeRuntimeOfSession } from "./native-runtime.js";
import { NativeAgentSessions } from "./runtime-sessions.js";

const HTTP_METHOD = { POST: "POST" } as const;

/** The most a call may carry: a message's words and the files attached to it, under the platform's own bound. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const readCall = readEither(NativeRelayCallSchema);

/** The conversation's agent, held to the account, the harness named, and the account's right to write to it. */
const admittedMessage = /* @__PURE__ */ Effect.fnUntraced(function* (
  call: Extract<NativeRelayCall, { readonly message: unknown }>,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices> {
  const agent = yield* hostedStoreOrUnavailable(
    readCodingAgentOfConversation(call.account, call.message.conversationId),
  );
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const routing = yield* hostedStoreOrUnavailable(
    readCodingAgentRouting(call.account, agent.value.id),
  );
  if (Option.isNone(routing) || routing.value.runtime !== call.runtime) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  yield* admitsPlanWriter(call.account, agent.value);
});

/** The call made on the harness, once admitted, answering the harness's outcome. */
const answered = (
  sessions: AgentSessions,
  call: NativeRelayCall,
): Effect.Effect<object, EveUnreachable> => {
  switch (call.call) {
    case NATIVE_RELAY_CALL.OPEN:
      return sessions.open(relayedMessage(call.message));
    case NATIVE_RELAY_CALL.SEND:
      return sessions.send(call.sessionId, relayedMessage(call.message));
    case NATIVE_RELAY_CALL.CANCEL:
      return sessions.cancel(call.sessionId, call.turnId);
    case NATIVE_RELAY_CALL.RESET:
      return sessions.reset(call.sessionId);
  }
};

/** POST: one call to a native harness, admitted by the deployment's own secret and made for the account it names. */
const nativeRelayEndpoint = /* @__PURE__ */ Effect.fn("web/nativeRelayEndpoint")(
  function* (): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | DatabaseServices | HostedEnvironment
  > {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.POST) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const secret = (yield* HostedEnvironment).eveDeploymentSecret;
    if (secret === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    if (!bearerMatchesSecret(request, secret)) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }
    const read = readCall(yield* parseJsonBytes(yield* readBodyBytesEffect(MAX_BODY_BYTES)));
    if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const call = read.success;
    if ("message" in call) {
      yield* admittedMessage(call);
    } else if (nativeRuntimeOfSession(call.sessionId) !== call.runtime) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }
    const native = yield* Effect.serviceOption(NativeAgentSessions);
    const reached = Option.flatMap(native, (service) =>
      service.sessions(call.runtime, call.account),
    );
    if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.NATIVE_AGENT_NOT_HERE);
    const outcome = yield* answered(yield* reached.value, call).pipe(
      Effect.catchTag("EveUnreachable", () => Effect.fail(HOSTED_REFUSAL.UNAVAILABLE)),
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, outcome);
  },
);

/** The group: the one relay path, and the hosted vocabulary's own refusal for any other. */
export function nativeRelayApp(): WebRoutes<DatabaseServices | HostedEnvironment> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, NATIVE_RELAY_PATH, hostedRefusing(nativeRelayEndpoint())),
    hostedNotFoundRoute,
  );
}
