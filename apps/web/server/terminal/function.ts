import { workspaceSeams } from "@repo/database/models/workspace-seams";
import { auth } from "@repo/service/auth/auth";
import { authDeployment } from "@repo/service/auth/auth-deployment";
import { resolveHostedUserId, resolveRelayUserId } from "@repo/service/auth/bearer";
import { browserLiveDependencies } from "@repo/service/browser-live/production";
import { browserLiveServer, standBrowserLive } from "@repo/service/browser-live/service";
import type { RelayServer } from "@repo/service/http/relay-upgrade";
import { liveProcedures } from "@repo/service/live/live-procedures";
import { liveSocketServer, standLiveSocket } from "@repo/service/live/live-socket";
import { standReported } from "@repo/service/observability/sentry";
import { hostedFetch } from "@repo/service/orpc/handler";
import { relayDependencies } from "@repo/service/terminal/production";
import { standTerminalRelay, terminalRelayServer } from "@repo/service/terminal/service";
import { tunnelDependencies } from "@repo/service/tunnel/production";
import { standTunnel, tunnelServer } from "@repo/service/tunnel/service";
import { Effect } from "effect";
import { runWeb } from "../runtime.js";

let standingTerminal: RelayServer | undefined;

let standingTunnel: RelayServer | undefined;

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

function standTunnelOn(tunnel: RelayServer): void {
  void standReported(
    runWeb,
    Effect.scoped(
      Effect.gen(function* () {
        const dependencies = yield* tunnelDependencies;
        yield* standTunnel({
          server: tunnel,
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

function standLive(live: RelayServer): void {
  const deployment = authDeployment(process.env);
  void standReported(
    runWeb,
    Effect.scoped(
      Effect.gen(function* () {
        yield* standLiveSocket({
          server: live,
          ownOrigins: new Set(deployment.ownOrigins),
          resolveUserId: resolveRelayUserId,
          fetch: hostedFetch({
            live: liveProcedures({
              resolveUserId: resolveHostedUserId,
              workspaces: workspaceSeams(auth.api),
            }),
          }),
          origin: new URL(deployment.baseURL).origin,
        });
        return yield* Effect.never;
      }),
    ),
  );
}

export function terminalFunctionServer() {
  if (standingTerminal === undefined) {
    standingTerminal = terminalRelayServer();
    standTerminal(standingTerminal);
  }
  return standingTerminal.server;
}

export function tunnelFunctionServer() {
  if (standingTunnel === undefined) {
    standingTunnel = tunnelServer();
    standTunnelOn(standingTunnel);
  }
  return standingTunnel.server;
}

export function browserLiveFunctionServer() {
  if (standingBrowser === undefined) {
    standingBrowser = browserLiveServer();
    standBrowser(standingBrowser);
  }
  return standingBrowser.server;
}

export function liveSocketFunctionServer() {
  if (standingLive === undefined) {
    standingLive = liveSocketServer();
    standLive(standingLive);
  }
  return standingLive.server;
}
