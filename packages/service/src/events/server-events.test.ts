import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { deleteAccount } from "@luke/database/models/account-store";
import { organization, user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { AGENT_KIND } from "@luke/features/agent-wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { eq } from "drizzle-orm";
import { Effect, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import type { PosthogBatch, PosthogBatchItem } from "../providers/posthog.js";
import { DEPLOYMENT_VARIABLE } from "./events.js";
import {
  productAnalyticsFromEnvironment,
  recordServerEvent,
  SERVER_AGENT_START_KIND,
  SERVER_AGENT_STARTER,
  SERVER_EVENT,
  SERVER_SIGN_IN_METHOD,
  workspaceRenamed,
} from "./server-events.js";

const NOW = Date.parse("2026-08-19T12:00:00.000Z");

/** When the workspace a group test names was made. */
const CREATED = Date.parse("2026-03-02T09:30:00.000Z");

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  eveDeploymentSecret: undefined,
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

/** An account the service holds, answering its id. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** An agent's start counted by the account in the workspace, which no row of the test's holds unless it opened one. */
const agentStartIn = (userId: string, workspaceId: string) =>
  recordServerEvent(
    SERVER_EVENT.AGENT_START,
    { userId, workspaceId },
    {
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      start_kind: SERVER_AGENT_START_KIND.FRESH,
      is_from_automation: false,
      started_by: SERVER_AGENT_STARTER.MEMBER,
      has_task: true,
      agent_kind: AGENT_KIND.CODER,
    },
  );

const agentStart = (userId: string) => agentStartIn(userId, "workspace-1");

/** Every item the processor was posted, across its batches, in order. */
const itemsOf = (posted: readonly Posted[]): PosthogBatchItem[] =>
  posted.flatMap((each) => [...each.body.batch]);

/** A workspace the service holds, named and made as given, answering its id. */
const openWorkspaceNamed = (id: string, name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db
      .insert(organization)
      .values({ id, name, slug: `workspace-${id}`, createdAt: new Date(CREATED) });
    return id;
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

it.layer(getTestDB())("server events", (it) => {
  it.effect(
    "posts the event under the account's id, its workspace's group, its own properties, the deployment, and no location",
    () => {
      // The layer reads the deployment's name as it is built, so it is named before.
      vi.stubEnv(DEPLOYMENT_VARIABLE, "preview");
      const processor = analytics({
        posthogProjectApiKey: Redacted.make("phc_project"),
        posthogIngestHost: "https://eu.i.posthog.com",
      });
      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const userId = yield* openUser;
        yield* agentStart(userId);
        expect(processor.posted).toEqual([
          {
            url: "https://eu.i.posthog.com/batch/",
            body: {
              api_key: "phc_project",
              historical_migration: false,
              batch: [
                {
                  event: "agent:start",
                  distinct_id: userId,
                  timestamp: "2026-08-19T12:00:00.000Z",
                  properties: {
                    model: "anthropic/claude-opus-5.5",
                    effort: "high",
                    start_kind: "fresh",
                    is_from_automation: false,
                    started_by: "member",
                    has_task: true,
                    agent_kind: "coder",
                    $groups: { workspace: "workspace-1" },
                    $geoip_disable: true,
                    platform: "server",
                    environment: "preview",
                    $lib: "luke-service",
                  },
                },
              ],
            },
          },
        ]);
      }).pipe(Effect.provide(processor.layer));
    },
  );

  it.effect("files an account's own event under no workspace", () => {
    const processor = analytics({ posthogProjectApiKey: Redacted.make("phc_project") });
    return Effect.gen(function* () {
      yield* recordServerEvent(
        SERVER_EVENT.ACCOUNT_SIGN_UP,
        { userId: yield* openUser },
        { method: SERVER_SIGN_IN_METHOD.GITHUB },
      );
      const items = itemsOf(processor.posted);
      expect(items.map((item) => item.event)).toEqual(["account:sign_up"]);
      expect(items[0]?.properties).not.toHaveProperty("$groups");
    }).pipe(Effect.provide(processor.layer));
  });

  it.effect(
    "names a workspace's group by its name and creation alone, beside its first event and again on a rename",
    () => {
      const processor = analytics({ posthogProjectApiKey: Redacted.make("phc_project") });
      const named = () =>
        itemsOf(processor.posted)
          .filter((item) => item.event === "$groupidentify")
          .map((item) => ({
            type: item.properties["$group_type"],
            key: item.properties["$group_key"],
            set: item.properties["$group_set"],
          }));
      return Effect.gen(function* () {
        const userId = yield* openUser;
        const workspaceId = yield* openWorkspaceNamed("workspace-acme", "Acme");
        yield* agentStartIn(userId, workspaceId);
        yield* agentStartIn(userId, workspaceId);
        const db = yield* Database;
        yield* db
          .update(organization)
          .set({ name: "Acme Labs" })
          .where(eq(organization.id, workspaceId));
        yield* workspaceRenamed(userId, workspaceId);
        const created_at = new Date(CREATED).toISOString();
        expect(named()).toEqual([
          { type: "workspace", key: workspaceId, set: { name: "Acme", created_at } },
          { type: "workspace", key: workspaceId, set: { name: "Acme Labs", created_at } },
        ]);
      }).pipe(Effect.provide(processor.layer));
    },
  );

  it.effect("records nothing on a deployment without a project key", () => {
    const processor = analytics({});
    return Effect.gen(function* () {
      yield* agentStart(yield* openUser);
      expect(processor.posted).toEqual([]);
    }).pipe(Effect.provide(processor.layer));
  });

  it.effect("a refusing processor costs the count, never the caller", () => {
    const processor = analytics({ posthogProjectApiKey: Redacted.make("phc_project") }, 500);
    return Effect.gen(function* () {
      const settled = yield* Effect.exit(agentStart(yield* openUser));
      expect(settled._tag).toBe("Success");
      expect(processor.posted).toHaveLength(1);
    }).pipe(Effect.provide(processor.layer));
  });

  it.effect("posts nothing for an account deleted before its event is captured", () => {
    const processor = analytics({ posthogProjectApiKey: Redacted.make("phc_project") });
    return Effect.gen(function* () {
      const userId = yield* openUser;
      yield* deleteAccount(userId);
      yield* agentStart(userId);
      expect(processor.posted).toEqual([]);
    }).pipe(Effect.provide(processor.layer));
  });

  it.effect("a runtime that provides no analytics records nothing and still succeeds", () =>
    Effect.gen(function* () {
      const settled = yield* Effect.exit(agentStart("user-1"));
      expect(settled._tag).toBe("Success");
    }),
  );
});
