import { authDeployment } from "@luke/service/auth/auth-deployment";
import { hostedUserInfo, userIdForAuthorization } from "@luke/service/auth/bearer";
import { browserLiveDependencies, browserLiveUserId } from "@luke/service/browser-live/production";
import {
  type BrowserLiveServer,
  browserLiveServer,
  standBrowserLive,
} from "@luke/service/browser-live/service";
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
 * function.ts -- the sandbox relays' one runtime edge: the terminal relay stood on the server the `api/terminal/sessions` function exports, and the Browser tab's live view on the one `api/browser/live` exports, each once per instance of its own function.
 *
 * Each scope is held open by `Effect.never`, as the voice service's is, so
 * the `ws` server and every connection's fiber belong to one scope nothing
 * but a disposed runtime closes, which is what a Vercel function gets. An
 * instance whose runtime cannot be built stands none, and its server keeps
 * refusing every upgrade with 503; either way what ended the relay is
 * reported to Sentry. The two relays share this edge because they stand on
 * the same terms, each a function of its own all the same.
 */

let standingTerminal: TerminalRelayServer | undefined;

let standingBrowser: BrowserLiveServer | undefined;

function standTerminal(relay: TerminalRelayServer): void {
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

function standBrowser(live: BrowserLiveServer): void {
  void standReported(
    runWeb,
    Effect.scoped(
      Effect.gen(function* () {
        const dependencies = yield* browserLiveDependencies;
        yield* standBrowserLive({
          server: live,
          ownOrigins: new Set(authDeployment(process.env).ownOrigins),
          resolveUserId: browserLiveUserId,
          dependencies,
        });
        return yield* Effect.never;
      }),
    ),
  );
}

/** The one terminal server of this function instance, with its service stood on first use. */
export function terminalFunctionServer() {
  if (standingTerminal === undefined) {
    standingTerminal = terminalRelayServer();
    standTerminal(standingTerminal);
  }
  return standingTerminal.server;
}

/** The one live-view server of this function instance, with its service stood on first use. */
export function browserLiveFunctionServer() {
  if (standingBrowser === undefined) {
    standingBrowser = browserLiveServer();
    standBrowser(standingBrowser);
  }
  return standingBrowser.server;
}
