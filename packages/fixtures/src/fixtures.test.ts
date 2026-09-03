import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_SPEAKING_CAPTION, fixtureSnapshot } from "@sidecar/fixtures";
import { mentionedSessions, SESSION_MENTION_KIND } from "@sidecar/session";
import { attentionCount, FIXTURE_SESSION_IDS_BY_PROVIDER } from "./fixtures.js";

test("the smoke fixture is stable and contains no duplicate identities", () => {
  const snapshot = fixtureSnapshot("smoke");
  const identities = snapshot.sessions.map((session) => session.id);

  assert.equal(snapshot.scenario, "smoke");
  assert.equal(new Set(identities).size, identities.length);
  assert.equal(attentionCount(snapshot), 1);
});

test("registered fixture rows are the smoke fixture's provider rows", () => {
  const snapshot = fixtureSnapshot("smoke");
  const registered = Object.values(FIXTURE_SESSION_IDS_BY_PROVIDER).flat();
  assert.deepEqual(new Set(registered), new Set(snapshot.sessions.map((session) => session.id)));
});

test("the spoken sentence names rows of the roster it is captured beside", () => {
  const snapshot = fixtureSnapshot("smoke");
  const mentions = mentionedSessions(
    FIXTURE_SPEAKING_CAPTION,
    snapshot.sessions.map((session) => ({
      providerId: session.providerId,
      providerSessionId: session.id,
      title: session.title,
      lastActivityAt: session.lastActivityAt,
      ...(session.workspace
        ? { workspace: { providerWorkspaceId: session.workspace.id, name: session.workspace.name } }
        : undefined),
    })),
  );

  // Both kinds, so the photographed band holds a chat chip and a workspace
  // one, and enough of them to wrap: a sentence that stopped naming these
  // would ship the band unphotographed without failing anything else.
  assert.deepEqual(
    mentions.map((mention) => mention.providerSessionId),
    [
      "claude-review",
      "conductor-chat-tidy",
      "conductor-cursor-agent",
      "conductor-opencode-session",
    ],
  );
  assert.ok(mentions.some((mention) => mention.kind === SESSION_MENTION_KIND.WORKSPACE));
});

test("unknown fixtures remain explicit", () => {
  assert.throws(() => fixtureSnapshot("missing"), /Unknown fixture scenario/);
});
