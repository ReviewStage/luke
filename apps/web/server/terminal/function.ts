import { hostedUserInfo, userIdForAuthorization } from "@luke/service/auth/bearer";
import { standReported } from "@luke/service/observability/sentry";
import { relayDependencies } from "@luke/service/terminal/production";
import {
  standTerminalRelay,
  type TerminalRelayServer,
  terminalRelayServer,
} from "@luke/service/terminal/service";
import { Effect } from "effect";
import { runWeb } from "../runtime.js";

/**
 * function.ts -- the terminal relay's one runtime edge: the service stood on the server the `api/terminal/sessions` function exports, once per instance.
 *
 * Its scope is held open by `Effect.never`, as the voice service's is, so
 * the `ws` server and every connection's fiber belong to one scope nothing
 * but a disposed runtime closes, which is what a Vercel function gets. An
 * instance whose runtime cannot be built stands none, and its server keeps
 * refusing every upgrade with 503; either way what ended the relay is
 * reported to Sentry.
 */

let standing: TerminalRelayServer | undefined;

function standService(relay: TerminalRelayServer): void {
  void standReported(
    runWeb,
    Effect.scoped(
      Effect.gen(function* () {
        const dependencies = yield* relayDependencies;
        yield* standTerminalRelay({
          server: relay,
          resolveUserId: (authorization) => userIdForAuthorization(authorization, hostedUserInfo),
          dependencies,
        });
        return yield* Effect.never;
      }),
    ),
  );
}

/** The one server of this function instance, with its service stood on first use. */
export function terminalFunctionServer() {
  if (standing === undefined) {
    standing = terminalRelayServer();
    standService(standing);
  }
  return standing.server;
}
