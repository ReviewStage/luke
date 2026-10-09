import assert from "node:assert/strict";
import { test } from "vitest";
import {
  BRAIN_TURN_TRIGGER,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  type StoredUIMessage,
  userMetadataOf,
} from "../server/core";
import { publishedInTranscript } from "../server/hosted/coder-host/published";

/**
 * What an agent's own rows name of its branch and its pull request: read
 * off the commands it ran and the addresses in its words and its tools'
 * answers, the newest naming winning, on the agent's repository alone and
 * never from the plan it was handed. Synthetic rows throughout.
 */

const REPOSITORY = "Acme/Relay";

type Part = StoredUIMessage["parts"][number];

function plan(text: string): StoredUIMessage {
  return {
    id: "m-plan",
    role: MESSAGE_ROLE.USER,
    metadata: userMetadataOf(BRAIN_TURN_TRIGGER.ASK, undefined),
    parts: [{ type: "text", text }],
  };
}

function turn(parts: readonly Part[]): StoredUIMessage {
  return {
    id: "m-turn",
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    parts: [...parts],
  };
}

/** A shell call as the row holds it: its command, and what it printed. */
function bash(command: string, stdout = ""): Part {
  return {
    type: "tool-bash",
    toolCallId: `call-${command.length}`,
    state: "output-available",
    input: { command },
    output: { status: "completed", exitCode: 0, stdout, stderr: "" },
  };
}

function text(words: string): Part {
  return { type: "text", text: words };
}

test("the branch is the one the agent's commands name last, from a push, a branch cut, a head given to gh, or the prefix anywhere; HEAD alone names nothing", () => {
  const named = (command: string) =>
    publishedInTranscript([turn([bash(command)])], REPOSITORY).branch;
  assert.equal(named("git switch -c luke/teammate-invitations"), "luke/teammate-invitations");
  assert.equal(named("git checkout -b feature/invites && pnpm test"), "feature/invites");
  assert.equal(named("git push -u origin feature/invites"), "feature/invites");
  assert.equal(named('git push --force-with-lease origin HEAD:"luke/invites"'), "luke/invites");
  assert.equal(named("git push -u origin HEAD"), undefined);
  assert.equal(named("gh pr create --fill --head luke/invites --base main"), "luke/invites");
  assert.equal(named("git log --oneline -3 luke/other-work"), "luke/other-work");
  assert.equal(named("cat AGENTS.md"), undefined);
  // Across calls, the newest naming wins.
  const rows = [turn([bash("git switch -c luke/first"), bash("git switch -c luke/second")])];
  assert.equal(publishedInTranscript(rows, REPOSITORY).branch, "luke/second");
});

test("the pull request is the last one addressed on the agent's repository, case aside, in a tool's answer or in its words; another repository's is not", () => {
  const rows = [
    plan("See https://github.com/Acme/Relay/pull/3 for the last attempt."),
    turn([
      bash("gh pr create --fill", "https://github.com/acme/relay/pull/41\n"),
      text(
        "Opened https://github.com/Acme/Relay/pull/41, after https://github.com/acme/ledger/pull/9.",
      ),
    ]),
  ];
  assert.equal(publishedInTranscript(rows, REPOSITORY).pullRequestNumber, 41);
  // The plan's own words name nothing: it is the developer's, not the agent's.
  assert.equal(publishedInTranscript(rows.slice(0, 1), REPOSITORY).pullRequestNumber, undefined);
  assert.equal(
    publishedInTranscript([turn([text("https://github.com/acme/ledger/pull/9")])], REPOSITORY)
      .pullRequestNumber,
    undefined,
  );
});

test("a branch spelled in a tool's answer, as a file read or a log may spell one, names nothing", () => {
  const rows = [turn([bash("cat CHANGELOG.md", "merged luke/older-work last week\n")])];
  assert.deepEqual(publishedInTranscript(rows, REPOSITORY), {
    branch: undefined,
    pullRequestNumber: undefined,
  });
});
