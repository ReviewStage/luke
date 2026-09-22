import { clockAt } from "@sidecar/wire/testing";
import { Layer, type Redacted } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { type DevicesVaultSeams, devicesVaultApp } from "../../server/devices-vault-app.js";
import { HostedEnvironment } from "../../server/hosted/environment.js";
import { noDatabase } from "./no-database.js";

/**
 * The devices-and-vault group answered the way a function answers it, with
 * the deployment's environment handed in rather than read: a test names the
 * vault secret the same way `hostedEnvironment` resolves it from `Config`,
 * and reaches no runtime of its own.
 */
export interface DevicesVaultCall extends DevicesVaultSeams {
  request: Request;
  /** Absent, or blank, means the vault is off, the way the environment's own absence does. */
  encryptionSecret?: Redacted.Redacted | undefined;
  /** The instant the group's `Clock` reads; the live clock when absent. */
  instant?: number | undefined;
}

export function devicesVaultAnswer(call: DevicesVaultCall): Promise<Response> {
  // The seams a test hands in reach no connection, so the group runs over the
  // refusing client rather than one this suite would have to open.
  const { handler } = HttpRouter.toWebHandler(
    devicesVaultApp(call).pipe(
      HttpRouter.provideRequest(noDatabase),
      HttpRouter.provideRequest(
        Layer.succeed(HostedEnvironment, {
          openAiKey: undefined,
          posthogPersonalApiKey: undefined,
          posthogProjectId: undefined,
          posthogApiHost: undefined,
          providerKeyEncryptionSecret: call.encryptionSecret,
          posthogProjectApiKey: undefined,
          posthogIngestHost: undefined,
          cronSecret: undefined,
          apnsCredentials: undefined,
        }),
      ),
      HttpRouter.provideRequest(call.instant === undefined ? Layer.empty : clockAt(call.instant)),
    ),
    { disableLogger: true },
  );
  return handler(call.request);
}
