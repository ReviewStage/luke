import assert from "node:assert/strict";
import {
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  SESSION_STATUS,
} from "@sidecar/session";
import { test } from "vitest";
import { hostClaims, unclaimedWorkspace, type WorkspaceHostContexts } from "./host-claims.js";

const OBSERVED_AT = Date.parse("2026-09-01T09:00:00.000Z");
const PROVIDER_ID = "claude-code";

interface StubContext {
  workspaceName: string;
  archived?: boolean;
}

function observation(
  providerSessionId: string,
  overrides: Partial<ProviderSessionObservation> = {},
): ProviderSessionObservation {
  return {
    providerSessionId,
    title: providerSessionId,
    status: SESSION_STATUS.WORKING,
    lastActivityAt: OBSERVED_AT,
    ...overrides,
  };
}

function contexts(
  entries: Readonly<Record<string, StubContext>>,
): WorkspaceHostContexts<StubContext> {
  return new Map([[PROVIDER_ID, new Map(Object.entries(entries))]]);
}

function claims(
  entries: Readonly<Record<string, StubContext>>,
  overrides: { retains?: (context: StubContext) => boolean } = {},
) {
  return hostClaims<StubContext>({
    applicationId: SESSION_APPLICATION_ID.CLAUDE,
    contexts: contexts(entries),
    ...(overrides.retains === undefined ? undefined : { retains: overrides.retains }),
    annotate: ({ observation: row, context }) => ({
      ...row,
      applications: [
        ...(row.applications ?? []),
        {
          id: SESSION_APPLICATION_ID.CLAUDE,
          displayName: context.workspaceName,
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
      ],
    }),
  });
}

test("a manager with nothing to say about a provider changes nothing", () => {
  const rows = [observation("one")];
  assert.equal(claims({}).enrich("codex", rows), rows);
});

test("a matched row is annotated and an unmatched one is left alone", () => {
  const enriched = claims({ one: { workspaceName: "luke" } }).enrich(PROVIDER_ID, [
    observation("one"),
    observation("two"),
  ]);

  assert.deepEqual(
    enriched.map((row) => row.applications?.map((application) => application.displayName)),
    [["luke"], undefined],
  );
});

test("a row already carrying this manager's association stands exactly as it is", () => {
  const already = observation("one", {
    applications: [
      {
        id: SESSION_APPLICATION_ID.CLAUDE,
        displayName: "already",
        scope: SESSION_APPLICATION_SCOPE.SESSION,
      },
    ],
  });

  const enriched = claims({ one: { workspaceName: "luke" } }).enrich(PROVIDER_ID, [already]);

  assert.equal(enriched[0], already);
});

test("a cloud row with a coincidentally equal id is never annotated", () => {
  const enriched = claims({ one: { workspaceName: "luke" } }).enrich(PROVIDER_ID, [
    observation("one", { location: SESSION_LOCATION.CLOUD }),
  ]);

  assert.equal(enriched[0]?.applications, undefined);
});

test("a sub-agent inherits its nearest indexed ancestor's context", () => {
  const enriched = claims({ parent: { workspaceName: "luke" } }).enrich(PROVIDER_ID, [
    observation("parent"),
    observation("child", { parentProviderSessionId: "parent" }),
    observation("grandchild", { parentProviderSessionId: "child" }),
  ]);

  assert.deepEqual(
    enriched.map((row) => row.applications?.[0]?.displayName),
    ["luke", "luke", "luke"],
  );
});

test("an ancestor chain that loops back on itself ends rather than spinning", () => {
  const enriched = claims({}).enrich(PROVIDER_ID, [
    observation("one", { parentProviderSessionId: "two" }),
    observation("two", { parentProviderSessionId: "one" }),
  ]);

  assert.deepEqual(
    enriched.map((row) => row.applications),
    [undefined, undefined],
  );
});

test("a manager that drops a filed-away row leaves no row at all", () => {
  const enriched = claims(
    { one: { workspaceName: "luke", archived: true }, two: { workspaceName: "luke" } },
    { retains: (context) => context.archived !== true },
  ).enrich(PROVIDER_ID, [observation("one"), observation("two")]);

  assert.deepEqual(
    enriched.map((row) => row.providerSessionId),
    ["two"],
  );
});

test("has answers for the sessions this manager's own index named", () => {
  const claimed = claims({ one: { workspaceName: "luke" } });
  assert.equal(claimed.has(PROVIDER_ID, "one"), true);
  assert.equal(claimed.has(PROVIDER_ID, "two"), false);
  assert.equal(claimed.has("codex", "one"), false);
});

test("a claim lands only where no earlier manager already grouped the chat", () => {
  const claim = { providerWorkspaceId: "workspace-1", name: "luke" };
  assert.deepEqual(unclaimedWorkspace(observation("one"), claim), claim);
  assert.equal(unclaimedWorkspace(observation("one", { workspace: claim }), claim), undefined);
});
