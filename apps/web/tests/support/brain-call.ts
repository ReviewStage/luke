import { HttpApp } from "@effect/platform";
import type { CloudFetch } from "@sidecar/wire";
import { layerFromCloudFetch } from "@sidecar/wire/effect";
import { Effect, Redacted } from "effect";
import { type BrainSeams, brainApp } from "../../server/brain-app.js";
import { HostedEnvironment } from "../../server/hosted/environment.js";

/**
 * The brain group answered the way a function answers it, with the
 * deployment's environment handed in rather than read: a test names the key
 * and the model override the same way `hostedEnvironment` resolves them from
 * `Config`, and reaches no runtime of its own. `fetch` is the test's own
 * upstream double, carried as the `HttpClient` layer the group's OpenAI call
 * now runs its request over, where the deployment always runs the platform's
 * own.
 */
export interface BrainCall extends BrainSeams {
  request: Request;
  /** Absent, or blank, means the hosted tier is off, the way the environment's own absence does. */
  apiKey?: string | undefined;
  model?: string | undefined;
  prefetchModel?: string | undefined;
  fetch?: CloudFetch | undefined;
}

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function brainAnswer(call: BrainCall): Promise<Response> {
  const apiKey = present(call.apiKey);
  const handler = HttpApp.toWebHandler(
    brainApp(call).pipe(
      Effect.provideService(HostedEnvironment, {
        openAiKey: apiKey === undefined ? undefined : Redacted.make(apiKey),
        brainModel: present(call.model),
        prefetchModel: present(call.prefetchModel),
        realtimeModel: undefined,
        posthogPersonalApiKey: undefined,
        posthogProjectId: undefined,
        posthogApiHost: undefined,
        providerKeyEncryptionSecret: undefined,
        posthogProjectApiKey: undefined,
        posthogIngestHost: undefined,
        cronSecret: undefined,
        apnsCredentials: undefined,
      }),
      Effect.provide(layerFromCloudFetch(call.fetch ?? ((input, init) => fetch(input, init)))),
    ),
  );
  return handler(call.request);
}
