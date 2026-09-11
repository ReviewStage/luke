import { HttpApp } from "@effect/platform";
import { Effect, Redacted } from "effect";
import { type DevicesVaultSeams, devicesVaultApp } from "../../server/devices-vault-app.js";
import { HostedEnvironment } from "../../server/hosted/environment.js";

/**
 * The devices-and-vault group answered the way a function answers it, with
 * the deployment's environment handed in rather than read: a test names the
 * vault secret the same way `hostedEnvironment` resolves it from `Config`,
 * and reaches no runtime of its own.
 */
export interface DevicesVaultCall extends DevicesVaultSeams {
  request: Request;
  /** Absent, or blank, means the vault is off, the way the environment's own absence does. */
  encryptionSecret?: string | undefined;
}

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function devicesVaultAnswer(call: DevicesVaultCall): Promise<Response> {
  const secret = present(call.encryptionSecret);
  const handler = HttpApp.toWebHandler(
    devicesVaultApp(call).pipe(
      Effect.provideService(HostedEnvironment, {
        openAiKey: undefined,
        brainModel: undefined,
        posthogPersonalApiKey: undefined,
        posthogProjectId: undefined,
        posthogApiHost: undefined,
        providerKeyEncryptionSecret: secret === undefined ? undefined : Redacted.make(secret),
      }),
    ),
  );
  return handler(call.request);
}
