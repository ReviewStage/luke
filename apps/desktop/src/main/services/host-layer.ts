import { randomUUID } from "node:crypto";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import type { LoopbackConsentOptions } from "@repo/credentials";
import { loopbackConsent } from "@repo/credentials/node";
import type { ServiceReach } from "@repo/features";
import { PRODUCT_PLATFORM } from "@repo/features/analytics";
import type { SecretCipher as SecretCipherSeam } from "@repo/host";
import { serviceReachLayer } from "@repo/host/client";
import {
  ALL_HOST_PLATFORM_CONCERNS,
  AppIdentity,
  type DuplicateGatewayMethod,
  Environment,
  type HostAssemblyTag,
  hostAssemblyLayer,
  hostKernelLayer,
  IdSource,
  LoopbackListener,
  oauthAccountSourceLayer,
  RunMode,
  reporterLayer,
  SecretCipher,
  ShutdownSignal,
  SignInConsent,
  StateRoot,
  TerminalSocket,
} from "@repo/host/effect";
import { listenOnLoopbackOverNet, openTerminalSocketOverWs } from "@repo/host/node";
import { ConfigProvider, Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { net } from "electron";
import { thisMacHostLayer } from "../native/this-mac-host";
import type { DesktopConfig } from "./desktop-config";

interface HostSeamDependencies {
  config: DesktopConfig;
  /** The client's own credential protection; the host encrypts nothing without it. */
  cipher: SecretCipherSeam;
}

/** Every seam tag this process answers for, each stood up from what the launch already established. */
function hostSeamLayersFor(dependencies: HostSeamDependencies) {
  const { config, cipher } = dependencies;
  const { runMode } = config;
  // A press on a Mac with no network is answered at once, from Electron's own
  // probe, rather than opening a page nobody can load.
  const consent = Layer.succeed(SignInConsent, {
    open: <Grant extends object>(options: LoopbackConsentOptions<Grant>) =>
      loopbackConsent({ ...options, isOnline: () => net.isOnline() }),
  });
  return Layer.mergeAll(
    Layer.succeed(StateRoot, config.stateRoot),
    Layer.succeed(RunMode, runMode),
    Layer.succeed(AppIdentity, {
      appVersion: config.appVersion,
      packaged: config.packaged,
      platform: PRODUCT_PLATFORM.DESKTOP,
    }),
    Layer.succeed(Environment, ConfigProvider.fromEnvRecord(config.environment)),
    Layer.succeed(IdSource, { create: () => randomUUID() }),
    reporterLayer(config.report),
    Layer.succeed(TerminalSocket, openTerminalSocketOverWs),
    // A forwarded cloud port is listened on at 127.0.0.1 alone, over `node:net`.
    Layer.succeed(LoopbackListener, listenOnLoopbackOverNet),
    thisMacHostLayer(),
    // The account is the OAuth sign-in, its tokens sealed by this Mac's
    // cipher. Its consent is a loopback on this Mac: the browser hands the
    // code back to a `node:http` listener on 127.0.0.1.
    Layer.provide(
      oauthAccountSourceLayer,
      Layer.merge(Layer.succeed(SecretCipher, cipher), consent),
    ),
    // The protocol's shutdown answers accepted at once; the quit that follows
    // is the one drain, which the entry's `before-quit` asks for.
    Layer.succeed(ShutdownSignal, { notify: () => config.quit() }),
  );
}

/**
 * The host this client operates, constructed and linked with nothing yet
 * begun: the assembly is where the server the operator reaches comes from, so
 * it stands before any start, and `hostStandingLayer` over it is what begins
 * the composers, arms the loops, and registers the drain — which is why the
 * standing layer is a step of the desktop's own launch rather than something
 * this module builds.
 *
 * A live run keeps its settings and workspace files on disk under the app's own
 * application data; a fixture or capture run keeps nothing and is
 * network-silent. Either way this process is one operator over one
 * transport, and one node. Every call it makes to the service tells the
 * service's reach beside it, which the client's network watch follows.
 */
export function hostAssemblyLayerFor(
  dependencies: HostSeamDependencies,
): Layer.Layer<HostAssemblyTag | ServiceReach, DuplicateGatewayMethod> {
  const seams = hostSeamLayersFor(dependencies);
  return Layer.provide(
    // The desktop runs every platform concern: it is the host they were written for.
    hostAssemblyLayer(ALL_HOST_PLATFORM_CONCERNS),
    Layer.mergeAll(
      Layer.provideMerge(hostKernelLayer, seams),
      Layer.provideMerge(
        NodeChildProcessSpawner.layer,
        Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
      ),
      FetchHttpClient.layer,
    ),
  ).pipe(Layer.provideMerge(serviceReachLayer));
}
