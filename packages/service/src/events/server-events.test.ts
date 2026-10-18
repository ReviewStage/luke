import { describe, expect, it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import type { PosthogBatch } from "../providers/posthog.js";
import {
  productAnalyticsFromEnvironment,
  recordServerEvent,
  SERVER_AGENT_START_KIND,
  SERVER_EVENT,
} from "./server-events.js";

const NOW = Date.parse("2026-08-19T12:00:00.000Z");

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

interface Posted {
  readonly url: string;
  readonly body: PosthogBatch;
}

/** The deployment's analytics over a processor that records what reached it and answers `status`. */
function analytics(environment: Partial<HostedEnvironmentValues>, status = 200) {
  const posted: Posted[] = [];
  const http = fakeHttpClientLayer((url, init) => {
    // SAFETY: the body is the batch document the capture just serialized.
    posted.push({ url, body: JSON.parse(String(init.body)) as PosthogBatch });
    return new Response("{}", { status });
  });
  const layer = productAnalyticsFromEnvironment.pipe(
    Layer.provide(
      Layer.merge(http, Layer.succeed(HostedEnvironment, { ...NO_ENVIRONMENT, ...environment })),
    ),
  );
  return { layer, posted };
}

const agentStart = recordServerEvent(SERVER_EVENT.AGENT_START, "user-1", {
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  start_kind: SERVER_AGENT_START_KIND.FRESH,
  is_from_automation: false,
  has_task: true,
});

describe("server events", () => {
  it.effect("posts the event under the account's id, its own properties, and no location", () => {
    const processor = analytics({
      posthogProjectApiKey: Redacted.make("phc_project"),
      posthogIngestHost: "https://eu.i.posthog.com",
    });
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* agentStart;
      expect(processor.posted).toEqual([
        {
          url: "https://eu.i.posthog.com/batch/",
          body: {
            api_key: "phc_project",
            historical_migration: false,
            batch: [
              {
                event: "agent:start",
                distinct_id: "user-1",
                timestamp: "2026-08-19T12:00:00.000Z",
                properties: {
                  model: "anthropic/claude-opus-5.5",
                  effort: "high",
                  start_kind: "fresh",
                  is_from_automation: false,
                  has_task: true,
                  $geoip_disable: true,
                  $lib: "luke-service",
                },
              },
            ],
          },
        },
      ]);
    }).pipe(Effect.provide(processor.layer));
  });

  it.effect("records nothing on a deployment without a project key", () => {
    const processor = analytics({});
    return Effect.gen(function* () {
      yield* agentStart;
      expect(processor.posted).toEqual([]);
    }).pipe(Effect.provide(processor.layer));
  });

  it.effect("a refusing processor costs the count, never the caller", () => {
    const processor = analytics({ posthogProjectApiKey: Redacted.make("phc_project") }, 500);
    return Effect.gen(function* () {
      const settled = yield* Effect.exit(agentStart);
      expect(settled._tag).toBe("Success");
      expect(processor.posted).toHaveLength(1);
    }).pipe(Effect.provide(processor.layer));
  });

  it.effect("a runtime that provides no analytics records nothing and still succeeds", () =>
    Effect.gen(function* () {
      const settled = yield* Effect.exit(agentStart);
      expect(settled._tag).toBe("Success");
    }),
  );
});
