import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_KIND,
  CONVERSATION_ENTRY_KIND,
  SESSION_APPLICATION_SCOPE,
  SESSION_CONTROL_KIND,
} from "@sidecar/session";
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
  // The name is a chip wearing the mark its roster row wears: the provider's,
  // or the agent's where the provider hosts agents.
  assert.deepEqual(sent?.[1], { text: "lisbon-v2", name: { markId: "codex" } });
  const hosted = actionRowParts(line({ kind: ACTION_KIND.MESSAGE, runId: "r", text: "go" }), [
    { ...lisbon, agentId: "cursor", agent: "Cursor" },
  ]);
  assert.deepEqual(hosted?.[1]?.name, { markId: "cursor" });
  assert.equal(
    text(actionRowParts(line({ kind: ACTION_KIND.CONTROL, runId: "r", label: "Retry" }), [lisbon])),
    'Ran "Retry" on lisbon-v2',
  );
  // A control whose adapter said what it does is worded as that act.
  assert.equal(
    text(
      actionRowParts(
        line({
          kind: ACTION_KIND.CONTROL,
          runId: "r",
          label: "Archive",
          controlKind: SESSION_CONTROL_KIND.ARCHIVE,
        }),
        [lisbon],
      ),
    ),
    "Archived lisbon-v2",
  );
  assert.equal(
    text(
      actionRowParts(
        line({
          kind: ACTION_KIND.CONTROL,
          runId: "r",
          label: "Stop",
          controlKind: SESSION_CONTROL_KIND.STOP,
        }),
        [lisbon],
      ),
    ),
    "Stopped lisbon-v2",
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

test("a creation names the workspace it made as a chip, with no roster to consult", () => {
  const created = {
    kind: CONVERSATION_ENTRY_KIND.ACTION,
    words: "recorded",
    action: { kind: ACTION_KIND.CREATE_WORKSPACE, runId: "r", providerId: "codex", name: "Notch" },
  };
  const parts = actionRowParts(created, []);
  assert.equal(text(parts), "Created a new workspace Notch");
  assert.deepEqual(parts?.[1], { text: "Notch", name: {} });
  assert.equal(
    text(actionRowParts({ ...created, action: { ...created.action, name: undefined } }, [])),
    "Created a new workspace",
  );
});

test("a chat the roster has let go is still named, by the title the record kept", () => {
  const archived = actionRowParts(
    line({
      kind: ACTION_KIND.CONTROL,
      runId: "r",
      label: "Archive",
      controlKind: SESSION_CONTROL_KIND.ARCHIVE,
      title: "lisbon-v2",
    }),
    [],
  );
  assert.equal(text(archived), "Archived lisbon-v2");
  assert.deepEqual(archived?.[1], { text: "lisbon-v2", name: { markId: "codex" } });
  // A hosted chat the roster let go keeps its agent's mark from the record.
  const hostedGone = actionRowParts(
    line({ kind: ACTION_KIND.MESSAGE, runId: "r", text: "go", title: "cloud", agentId: "cursor" }),
    [],
  );
  assert.deepEqual(hostedGone?.[1], { text: "cloud", name: { markId: "cursor" } });
  // The roster's name wins while the roster holds the chat.
  assert.equal(
    text(
      actionRowParts(
        line({ kind: ACTION_KIND.MESSAGE, runId: "r", text: "go", title: "old-name" }),
        [lisbon],
      ),
    ),
    'Sent a message to lisbon-v2: "go"',
  );
});

test("nothing is composed for a record that cannot be read back to a row", () => {
  // No record at all, from a build before the facts were written down.
  assert.equal(
    actionRowParts({ kind: CONVERSATION_ENTRY_KIND.ACTION, words: "opened a session" }, [lisbon]),
    undefined,
  );
  // A session the roster has let go, whose line kept no name for it.
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
