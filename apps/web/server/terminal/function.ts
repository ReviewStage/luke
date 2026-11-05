import { authDeployment } from "@repo/service/auth/auth-deployment";
import { resolveRelayUserId } from "@repo/service/auth/bearer";
import { browserLiveDependencies } from "@repo/service/browser-live/production";
import { browserLiveServer, standBrowserLive } from "@repo/service/browser-live/service";
import type { RelayServer } from "@repo/service/http/relay-upgrade";
import { liveSocketServer } from "@repo/service/live/live-socket";
import { standReported } from "@repo/service/observability/sentry";
import { relayDependencies } from "@repo/service/terminal/production";
import { standTerminalRelay, terminalRelayServer } from "@repo/service/terminal/service";
import { Effect } from "effect";
import { runWeb } from "../runtime.js";

/**
 * function.ts -- the WebSocket services' one runtime edge: the terminal relay stood on the server the `api/terminal/sessions` function exports, the Browser tab's live view on the one `api/browser/live` exports, each once per instance of its own function, and the live reads' socket server `api/live/socket` exports, which stands no service and so refuses every upgrade.
 *
 * Each scope is held open by `Effect.never`, so
 * the `ws` server and every connection's fiber belong to one scope nothing
 * but a disposed runtime closes, which is what a Vercel function gets. An
 * instance whose runtime cannot be built stands none, and its server keeps
 * refusing every upgrade with 503; either way what ended the service is
 * reported to Sentry. The relays share this edge because they stand on
 * the same terms, each a function of its own all the same: the desktop's
 * bearer with no `Origin`, or a page of the deployment's own origins by its
 * session cookie (`http/relay-upgrade.ts`).
 */

let standingTerminal: RelayServer | undefined;

let standingBrowser: RelayServer | undefined;

let standingLive: RelayServer | undefined;

function standTerminal(relay: RelayServer): void {
  void standReported(
    runWeb,
    Effect.scoped(
      Effect.gen(function* () {
        const dependencies = yield* relayDependencies;
        yield* standTerminalRelay({
          server: relay,
          ownOrigins: new Set(authDeployment(process.env).ownOrigins),
          resolveUserId: resolveRelayUserId,
          dependencies,
        });
        return yield* Effect.never;
      }),
    ),
  );
}

function standBrowser(live: RelayServer): void {
  void standReported(
    runWeb,
    Effect.scoped(
      Effect.gen(function* () {
        const dependencies = yield* browserLiveDependencies;
        yield* standBrowserLive({
          server: live,
          ownOrigins: new Set(authDeployment(process.env).ownOrigins),
          resolveUserId: resolveRelayUserId,
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

/**
 * The one live-reads socket server of this function instance, with no
 * service stood on it, so it refuses every upgrade with 503. Note that we
 * stand none, because every desktop's live reads pinned to the few instances
 * their sockets landed on timed out there, while the same reads over HTTP
 * answered; a refused open sends a host's polls over HTTP
 * (`packages/host/src/live-socket.ts`), released desktops included.
 */
export function liveSocketFunctionServer() {
  if (standingLive === undefined) standingLive = liveSocketServer();
  return standingLive.server;
}
