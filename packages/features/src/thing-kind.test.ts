import assert from "node:assert/strict";
import { test } from "vitest";
import { NOTHING_SAID, THING_KIND, thingName, thingWordHeard } from "./thing-kind.js";

/**
 * thing-kind.test.ts -- a screen reader hears a thing's kind before its name,
 * unless the name already starts with it: a place named for its kind says it
 * once, and one labelled with words of its own still says what it is; and a
 * channel is called by its name now.
 */

test("a place labelled with words of its own still says its kind", () => {
  assert.equal(thingWordHeard(THING_KIND.INBOX, "my queue"), "Inbox");
  assert.equal(thingWordHeard(THING_KIND.AUTOMATIONS, "the nightly jobs"), "automations");
  assert.equal(thingWordHeard(THING_KIND.CHANGES, "Ada's diff"), "changes");
});

test("a name that already starts with its kind says it once", () => {
  assert.equal(thingWordHeard(THING_KIND.INBOX, "Inbox"), undefined);
  assert.equal(thingWordHeard(THING_KIND.LUKE, "Luke"), undefined);
  assert.equal(thingWordHeard(THING_KIND.CHANGES, "Changes by Ada"), undefined);
  assert.equal(thingWordHeard(THING_KIND.MESSAGE, "Message from Ada"), undefined);
  assert.equal(thingWordHeard(THING_KIND.INBOX, "Inbox (team)"), undefined);
  assert.equal(thingWordHeard(THING_KIND.AUTOMATIONS, "Automations."), undefined);
});

test("a name that only begins with the kind's letters still says its kind", () => {
  assert.equal(thingWordHeard(THING_KIND.PLAN, "Taskbar polish"), "task");
  assert.equal(thingWordHeard(THING_KIND.PULL_REQUEST, "#42 Fix the refresh"), "pull request");
});

test("a channel is called by its name now, without the # its glyph already says, and by the words it was written with where the window holds none", () => {
  const channel = { kind: THING_KIND.CHANNEL, channelId: "channel-1" } as const;
  const known = {
    tasks: new Map(),
    agents: new Map(),
    agentModels: new Map(),
    pages: new Map(),
    pagesTaskId: undefined,
    inboxItems: new Map(),
    people: new Map(),
    automations: new Map(),
  };

  assert.deepEqual(
    thingName(channel, { ...known, channels: new Map([["channel-1", "app-v2"]]) }, NOTHING_SAID),
    { live: true, held: "app-v2" },
  );
  assert.deepEqual(thingName(channel, known, NOTHING_SAID), { live: true, held: undefined });
});
