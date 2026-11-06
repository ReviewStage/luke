import { randomUUID } from "node:crypto";
import os from "node:os";
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
  MirrorPlatform,
  oauthAccountSourceLayer,
  RunMode,
  reporterLayer,
  SecretCipher,
  ShutdownSignal,
  SignInConsent,
  StateRoot,
  TerminalSocket,
} from "@repo/host/effect";
import { listenOnLoopbackOverNet, mirrorPlatform, openTerminalSocketOverWs } from "@repo/host/node";
import { ConfigProvider, Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { net } from "electron";
import { thisMacHostLayer } from "../native/this-mac-host";
import type { DesktopConfig } from "./desktop-config";

interface HostSeamDependencies {
  config: DesktopConfig;
  cipher: SecretCipherSeam;
}

function hostSeamLayersFor(dependencies: HostSeamDependencies) {
  const { config, cipher } = dependencies;
  const { runMode } = config;
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
    Layer.succeed(LoopbackListener, listenOnLoopbackOverNet),
    Layer.succeed(MirrorPlatform, mirrorPlatform(os.homedir())),
    thisMacHostLayer(),
    Layer.provide(
      oauthAccountSourceLayer,
      Layer.merge(Layer.succeed(SecretCipher, cipher), consent),
    ),
    Layer.succeed(ShutdownSignal, { notify: () => config.quit() }),
  );
}

export function hostAssemblyLayerFor(
  dependencies: HostSeamDependencies,
): Layer.Layer<HostAssemblyTag | ServiceReach, DuplicateGatewayMethod> {
  const seams = hostSeamLayersFor(dependencies);
  return Layer.provide(
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
