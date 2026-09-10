import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_KIND, CONVERSATION_ENTRY_KIND, SESSION_APPLICATION_SCOPE } from "@sidecar/session";
import { actionRowParts } from "./conversation-action";
import type { SessionView } from "./session-model";

const lisbon: SessionView = {
  id: "a",
  title: "lisbon-v2",
  providerId: "codex",
  provider: "Codex",
  applications: [
    { id: "cursor", name: "Cursor", scope: SESSION_APPLICATION_SCOPE.SESSION, openable: true },
  ],
  detail: "Working",
  urgency: "urgency-working",
  label: "Working",
  location: "local",
  lastActivityAt: 0,
  openable: false,
  canMessage: true,
  actions: [],
  hasChange: false,
};
const identity = { providerId: "codex", providerSessionId: "a" };
const line = (action: NonNullable<Parameters<typeof actionRowParts>[0]["action"]>) => ({
  kind: CONVERSATION_ENTRY_KIND.ACTION,
  words: "recorded at the time",
  identity,
  action,
});
const text = (parts: ReturnType<typeof actionRowParts>) => parts?.map((part) => part.text).join("");

test("a row is composed from the act's record and the session's current name", () => {
  const sent = actionRowParts(line({ kind: ACTION_KIND.MESSAGE, runId: "r", text: "ship it" }), [
    lisbon,
  ]);
  assert.equal(text(sent), 'Sent a message to lisbon-v2: "ship it"');
  assert.deepEqual(sent?.[1], { text: "lisbon-v2", name: true });
  assert.equal(
    text(actionRowParts(line({ kind: ACTION_KIND.CONTROL, runId: "r", label: "Retry" }), [lisbon])),
    'Ran "Retry" on lisbon-v2',
  );
  assert.equal(
    text(actionRowParts(line({ kind: ACTION_KIND.OPEN, runId: "r" }), [lisbon])),
    "Opened lisbon-v2",
  );
  assert.equal(
    text(
      actionRowParts(line({ kind: ACTION_KIND.OPEN, runId: "r", applicationId: "cursor" }), [
        lisbon,
      ]),
    ),
    "Opened lisbon-v2 in Cursor",
  );
  assert.equal(
    text(
      actionRowParts(line({ kind: ACTION_KIND.ADD_AGENT, runId: "r", agent: "claude" }), [lisbon]),
    ),
    "Added a claude agent to lisbon-v2",
  );
  assert.equal(
    text(
      actionRowParts(line({ kind: ACTION_KIND.RENAME_WORKSPACE, runId: "r", name: "release" }), [
        lisbon,
      ]),
    ),
    'Renamed the workspace of lisbon-v2 to "release"',
  );
  // A renamed session is already called by its new name; the row repeats it only while they differ.
  assert.equal(
    text(
      actionRowParts(line({ kind: ACTION_KIND.RENAME_SESSION, runId: "r", name: "lisbon-v3" }), [
        lisbon,
      ]),
    ),
    'Renamed lisbon-v2 to "lisbon-v3"',
  );
  assert.equal(
    text(
      actionRowParts(line({ kind: ACTION_KIND.RENAME_SESSION, runId: "r", name: "lisbon-v2" }), [
        lisbon,
      ]),
    ),
    "Renamed lisbon-v2",
  );
  // The session is named as the roster calls it now, not as the line was recorded.
  assert.equal(
    text(
      actionRowParts(line({ kind: ACTION_KIND.MESSAGE, runId: "r", text: "go" }), [
        { ...lisbon, title: "lisbon-v3" },
      ]),
    ),
    'Sent a message to lisbon-v3: "go"',
  );
});

test("a creation names its provider as the roster's rows for that provider do", () => {
  const created = {
    kind: CONVERSATION_ENTRY_KIND.ACTION,
    words: "recorded",
    action: { kind: ACTION_KIND.CREATE_WORKSPACE, runId: "r", providerId: "codex", name: "Notch" },
  };
  assert.equal(text(actionRowParts(created, [lisbon])), 'Created a new workspace "Notch" in Codex');
  assert.equal(actionRowParts(created, []), undefined);
});

test("nothing is composed for a record that cannot be read back to a row", () => {
  // No record at all, from a build before the facts were written down.
  assert.equal(
    actionRowParts({ kind: CONVERSATION_ENTRY_KIND.ACTION, words: "opened a session" }, [lisbon]),
    undefined,
  );
  // A session the roster has let go.
  assert.equal(
    actionRowParts(line({ kind: ACTION_KIND.MESSAGE, runId: "r", text: "go" }), []),
    undefined,
  );
  // A record missing the fact its kind needs.
  assert.equal(
    actionRowParts(line({ kind: ACTION_KIND.MESSAGE, runId: "r" }), [lisbon]),
    undefined,
  );
});
