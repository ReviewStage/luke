import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { text as trimmedText } from "../core.js";
import { user } from "../db/schema.js";
import {
  forgetPosthogPerson,
  POSTHOG_ENVIRONMENT,
  type PosthogBatch,
  postPosthogBatch,
} from "../hosted/posthog.js";
import { HostedDatabaseService, HostedPosthog } from "./tags.js";

function posthogHost(): string | undefined {
  const host = process.env[POSTHOG_ENVIRONMENT.HOST];
  return host ? host : undefined;
}

function posthogApiHost(): string | undefined {
  const host = process.env[POSTHOG_ENVIRONMENT.API_HOST];
  return host ? host : undefined;
}

function forgetPersonEffect(): ((userId: string) => Effect.Effect<void>) | undefined {
  const personalApiKey = process.env[POSTHOG_ENVIRONMENT.PERSONAL_API_KEY];
  const projectId = process.env[POSTHOG_ENVIRONMENT.PROJECT_ID];
  if (!personalApiKey || !projectId) return undefined;
  return (userId: string) =>
    Effect.promise(async () => {
      const forget: Parameters<typeof forgetPosthogPerson>[1] = {
        personalApiKey,
        projectId,
      };
      const host = posthogApiHost();
      if (host) forget.host = host;
      await forgetPosthogPerson(userId, forget);
    });
}

export const HostedPosthogLive = Layer.effect(
  HostedPosthog,
  Effect.gen(function* () {
    const database = yield* HostedDatabaseService;
    const host = posthogHost();
    return {
      projectApiKey: trimmedText(process.env[POSTHOG_ENVIRONMENT.PROJECT_API_KEY]),
      host,
      postBatch: (body: PosthogBatch) =>
        Effect.promise(() => {
          const upstream: { host?: string } = {};
          if (host) upstream.host = host;
          return postPosthogBatch(body, upstream);
        }),
      forgetPerson: forgetPersonEffect(),
      readPerson: (userId: string) =>
        Effect.promise(async () => {
          const rows = await database
            .select({ name: user.name, email: user.email })
            .from(user)
            .where(eq(user.id, userId))
            .limit(1);
          return rows[0];
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
    };
  }),
);
