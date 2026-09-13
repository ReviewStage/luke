import { FetchHttpClient, HttpApp } from "@effect/platform";
import type * as HttpClient from "@effect/platform/HttpClient";
import { Effect, type Layer, Redacted } from "effect";
import { HostedEnvironment } from "../../server/hosted/environment.js";
import {
  type IntroductionMintSeams,
  introductionMintApp,
} from "../../server/introduction-mint-app.js";
import { type VoiceMintSeams, voiceMintApp } from "../../server/voice-mint-app.js";
import { noDatabase } from "./no-database.js";

/**
 * The mint group answered the way a function answers it, with the
 * deployment's environment handed in rather than read: a test names the key
 * and the Realtime model override the same way `hostedEnvironment` resolves
 * them from `Config`, and reaches no runtime of its own. `httpClient` is the
 * test's own upstream double, the layer the group's OpenAI mint runs its
 * request over, where the deployment always runs the platform's own. The
 * client behind the group's meter seam is the one that refuses every
 * statement: a test names what its own `spend` answers, so a statement
 * reaching a connection here is the group reading a database this test never
 * opened.
 */
export interface MintCall extends Partial<VoiceMintSeams>, Partial<IntroductionMintSeams> {
  request: Request;
  /** Absent, or blank, means the hosted tier is off, the way the environment's own absence does. */
  apiKey?: string | undefined;
  model?: string | undefined;
  httpClient?: Layer.Layer<HttpClient.HttpClient> | undefined;
}

/** Which group a test's request is for, which is the path it names. */
const INTRODUCTION_MINT_SUFFIX = "/introduction-mint";

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function mintAnswer(call: MintCall): Promise<Response> {
  const apiKey = present(call.apiKey);
  const seams = {
    resolveUserId: () => Effect.succeed(undefined),
    spend: () => Effect.succeed({ allowed: false, quota: { used: 0, limit: 0, resetsAt: 0 } }),
    spendIntroduction: () => Effect.succeed({ allowed: false }),
    readVaultKeys: () => Effect.succeed([]),
    ...call,
  } satisfies VoiceMintSeams & IntroductionMintSeams;
  const app = new URL(call.request.url).pathname.endsWith(INTRODUCTION_MINT_SUFFIX)
    ? introductionMintApp(seams)
    : voiceMintApp(seams);
  const handler = HttpApp.toWebHandler(
    app.pipe(
      Effect.provideService(HostedEnvironment, {
        openAiKey: apiKey === undefined ? undefined : Redacted.make(apiKey),
        brainModel: undefined,
        prefetchModel: undefined,
        realtimeModel: present(call.model),
        providerKeyEncryptionSecret: undefined,
        posthogPersonalApiKey: undefined,
        posthogProjectId: undefined,
        posthogApiHost: undefined,
        posthogProjectApiKey: undefined,
        posthogIngestHost: undefined,
        cronSecret: undefined,
        apnsCredentials: undefined,
      }),
      Effect.provide(call.httpClient ?? FetchHttpClient.layer),
      Effect.provide(noDatabase),
    ),
  );
  return handler(call.request);
}
