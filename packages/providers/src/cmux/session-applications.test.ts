import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  PROVIDER_ID,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  SESSION_STATUS,
} from "@sidecar/session";
import { CmuxSessionApplicationReader, cmuxSurfaceLink } from "./session-applications.js";

const TEST_WORKSPACE_ID = "8149E107-6812-4C1C-A2DC-7B0D3316EA75";
const TEST_SURFACE_ID = "E23492B0-A9C0-4CDB-ADA8-3BEB2656C125";

async function temporaryStateDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-cmux-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

interface TestStoreSession {
  sessionId: string;
  workspaceId?: string;
  surfaceId?: string;
}

/** The store shape cmux's CLI writes, with only the fields Luke reads. */
async function writeStore(
  stateDirectory: string,
  agent: string,
  sessions: readonly TestStoreSession[],
): Promise<void> {
  const store = {
    version: 1,
    sessions: Object.fromEntries(
      sessions.map((session) => [
        session.sessionId,
        {
          sessionId: session.sessionId,
          workspaceId: session.workspaceId ?? TEST_WORKSPACE_ID,
          surfaceId: session.surfaceId ?? TEST_SURFACE_ID,
          cwd: "/tmp/example",
          startedAt: 1_786_047_803.48,
          updatedAt: 1_786_047_803.48,
        },
      ]),
    ),
  };
  await fs.writeFile(
    path.join(stateDirectory, `${agent}-hook-sessions.json`),
    JSON.stringify(store),
  );
}

test("indexes supported provider session ids from cmux stores", async (t) => {
  const stateDirectory = await temporaryStateDirectory(t);
  await writeStore(stateDirectory, "claude", [{ sessionId: "claude-local" }]);
  await writeStore(stateDirectory, "codex", [{ sessionId: "codex-local" }]);
  await writeStore(stateDirectory, "cursor", [{ sessionId: "cursor-local" }]);
  await writeStore(stateDirectory, "gemini", [{ sessionId: "gemini-local" }]);
  await writeStore(stateDirectory, "opencode", [{ sessionId: "opencode-local" }]);
  // An agent kind Luke has no provider for is not read at all.
  await writeStore(stateDirectory, "grok", [{ sessionId: "grok-local" }]);

  const snapshot = await new CmuxSessionApplicationReader({ stateDirectory }).read();
  for (const [providerId, providerSessionId] of [
    [PROVIDER_ID.CLAUDE_CODE, "claude-local"],
    [PROVIDER_ID.CODEX, "codex-local"],
    [PROVIDER_ID.CURSOR, "cursor-local"],
    [PROVIDER_ID.GEMINI_CLI, "gemini-local"],
    [PROVIDER_ID.OPENCODE, "opencode-local"],
  ] as const) {
    assert.equal(snapshot.has(providerId, providerSessionId), true);
  }

  assert.equal(snapshot.has(PROVIDER_ID.CLAUDE_CODE, "codex-local"), false);
  assert.equal(snapshot.has(PROVIDER_ID.DEVIN, "grok-local"), false);
});

test("an absent state directory leaves provider observations intact", async (t) => {
  const stateDirectory = path.join(await temporaryStateDirectory(t), "missing");
  const snapshot = await new CmuxSessionApplicationReader({ stateDirectory }).read();
  const observation = {
    providerSessionId: "local",
    title: "Local",
    status: SESSION_STATUS.WORKING,
    observedAt: 1,
  };
  assert.deepEqual(snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [observation]), [observation]);
});

test("a store that does not parse, or parses to another shape, reads as empty", async (t) => {
  const stateDirectory = await temporaryStateDirectory(t);
  await fs.writeFile(path.join(stateDirectory, "claude-hook-sessions.json"), "not json");
  await fs.writeFile(path.join(stateDirectory, "codex-hook-sessions.json"), '{"sessions": []}');
  await fs.writeFile(path.join(stateDirectory, "cursor-hook-sessions.json"), '"a string"');

  const snapshot = await new CmuxSessionApplicationReader({ stateDirectory }).read();
  assert.equal(snapshot.has(PROVIDER_ID.CLAUDE_CODE, "claude-local"), false);
  assert.equal(snapshot.has(PROVIDER_ID.CODEX, "codex-local"), false);
});

test("a record missing its placing identifiers is skipped, not the store", async (t) => {
  const stateDirectory = await temporaryStateDirectory(t);
  await fs.writeFile(
    path.join(stateDirectory, "claude-hook-sessions.json"),
    JSON.stringify({
      version: 1,
      sessions: {
        placed: {
          sessionId: "placed",
          workspaceId: TEST_WORKSPACE_ID,
          surfaceId: TEST_SURFACE_ID,
        },
        unplaced: { sessionId: "unplaced", workspaceId: TEST_WORKSPACE_ID },
        malformed: "not a record",
      },
    }),
  );

  const snapshot = await new CmuxSessionApplicationReader({ stateDirectory }).read();
  assert.equal(snapshot.has(PROVIDER_ID.CLAUDE_CODE, "placed"), true);
  assert.equal(snapshot.has(PROVIDER_ID.CLAUDE_CODE, "unplaced"), false);
  assert.equal(snapshot.has(PROVIDER_ID.CLAUDE_CODE, "malformed"), false);
});

test("annotates matching local observations and their spawned descendants", async (t) => {
  const stateDirectory = await temporaryStateDirectory(t);
  await writeStore(stateDirectory, "claude", [{ sessionId: "local" }, { sessionId: "cloud" }]);

  const snapshot = await new CmuxSessionApplicationReader({ stateDirectory }).read();
  const applicationLink = cmuxSurfaceLink(TEST_WORKSPACE_ID, TEST_SURFACE_ID);
  const observations = snapshot.enrich(PROVIDER_ID.CLAUDE_CODE, [
    {
      providerSessionId: "local",
      title: "Local",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
    },
    {
      providerSessionId: "child",
      parentProviderSessionId: "local",
      title: "Child",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
    },
    {
      providerSessionId: "cloud",
      title: "Cloud",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
      location: SESSION_LOCATION.CLOUD,
    },
    {
      providerSessionId: "other",
      title: "Other",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
    },
  ]);

  const cmuxApplication = {
    id: SESSION_APPLICATION_ID.CMUX,
    displayName: "cmux",
    scope: SESSION_APPLICATION_SCOPE.SESSION,
    link: applicationLink,
  };
  assert.deepEqual(observations[0]?.applications, [cmuxApplication]);
  assert.equal(observations[0]?.detail?.link, applicationLink);
  assert.deepEqual(observations[1]?.applications, [cmuxApplication]);
  assert.equal(observations[1]?.detail?.link, applicationLink);
  assert.equal(observations[2]?.applications, undefined);
  assert.equal(observations[3]?.applications, undefined);
});

test("keeps a link and an association another manager already gave the row", async (t) => {
  const stateDirectory = await temporaryStateDirectory(t);
  await writeStore(stateDirectory, "codex", [{ sessionId: "managed" }, { sessionId: "annotated" }]);

  const snapshot = await new CmuxSessionApplicationReader({ stateDirectory }).read();
  const observations = snapshot.enrich(PROVIDER_ID.CODEX, [
    {
      providerSessionId: "managed",
      title: "Managed",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
      detail: { link: "codex://threads/managed" },
    },
    {
      providerSessionId: "annotated",
      title: "Annotated",
      status: SESSION_STATUS.WORKING,
      observedAt: 1,
      applications: [
        {
          id: SESSION_APPLICATION_ID.CMUX,
          displayName: "cmux",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
      ],
    },
  ]);

  assert.equal(observations[0]?.detail?.link, "codex://threads/managed");
  assert.equal(
    observations[0]?.applications?.[0]?.link,
    cmuxSurfaceLink(TEST_WORKSPACE_ID, TEST_SURFACE_ID),
  );
  assert.equal(observations[1]?.applications?.length, 1);
  assert.equal(observations[1]?.applications?.[0]?.link, undefined);
});

test("composes the pane address cmux registers for its released builds", () => {
  assert.equal(
    cmuxSurfaceLink(TEST_WORKSPACE_ID, TEST_SURFACE_ID),
    `cmux://workspace/${TEST_WORKSPACE_ID}/surface/${TEST_SURFACE_ID}`,
  );
});
