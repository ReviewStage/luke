import { Context, type Effect } from "effect";
import type { HostedUsageAnswer } from "../core.js";
import type { createDatabase } from "../db/index.js";
import type { OpenAiPostBody } from "../hosted/openai.js";
import type { PosthogBatch, PosthogPerson } from "../hosted/posthog.js";
import type { HostedMeter, HostedSpend, IntroductionSpend } from "../hosted/quota.js";

export type HostedDatabase = ReturnType<typeof createDatabase>;

export class HostedClock extends Context.Tag("@luke/web/HostedClock")<
  HostedClock,
  { readonly now: () => number }
>() {}

export class HostedDatabaseService extends Context.Tag("@luke/web/HostedDatabase")<
  HostedDatabaseService,
  HostedDatabase
>() {}

export class HostedAuth extends Context.Tag("@luke/web/HostedAuth")<
  HostedAuth,
  {
    readonly resolveUserId: (request: Request) => Effect.Effect<string | undefined>;
  }
>() {}

export class HostedOpenAi extends Context.Tag("@luke/web/HostedOpenAi")<
  HostedOpenAi,
  {
    readonly apiKey: string | undefined;
    readonly realtimeModel: string | undefined;
    readonly attentionModel: string | undefined;
    readonly post: (path: string, body: OpenAiPostBody) => Effect.Effect<Response | undefined>;
  }
>() {}

export class HostedPosthog extends Context.Tag("@luke/web/HostedPosthog")<
  HostedPosthog,
  {
    readonly projectApiKey: string | undefined;
    readonly host: string | undefined;
    readonly postBatch: (body: PosthogBatch) => Effect.Effect<Response | undefined>;
    readonly readPerson?: (userId: string) => Effect.Effect<PosthogPerson | undefined>;
    readonly forgetPerson?: (userId: string) => Effect.Effect<void>;
  }
>() {}

export class HostedEncryption extends Context.Tag("@luke/web/HostedEncryption")<
  HostedEncryption,
  {
    readonly secret: string | undefined;
    readonly encrypt: (plaintext: string) => Effect.Effect<string>;
    readonly decrypt: (ciphertext: string) => Effect.Effect<string>;
  }
>() {}

export class HostedMeterService extends Context.Tag("@luke/web/HostedMeter")<
  HostedMeterService,
  {
    readonly spend: (userId: string, meter: HostedMeter) => Effect.Effect<HostedSpend>;
    readonly spendIntroduction: (callerKey: string) => Effect.Effect<IntroductionSpend>;
    readonly readUsage: (userId: string) => Effect.Effect<HostedUsageAnswer>;
  }
>() {}

export type HostedServices =
  | HostedClock
  | HostedDatabaseService
  | HostedAuth
  | HostedOpenAi
  | HostedPosthog
  | HostedEncryption
  | HostedMeterService;

export type { ProductEventBatch } from "../core.js";
