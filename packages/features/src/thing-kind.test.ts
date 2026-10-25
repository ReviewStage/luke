import assert from "node:assert/strict";
import { test } from "vitest";
import { THING_KIND, thingWordHeard } from "./thing-kind.js";

/**
 * thing-kind.test.ts -- a screen reader hears a thing's kind before its name,
 * unless the name already starts with it: a place named for its kind says it
 * once, and one labelled with words of its own still says what it is.
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
});

test("a name that only begins with the kind's letters still says its kind", () => {
  assert.equal(thingWordHeard(THING_KIND.PLAN, "Taskbar polish"), "task");
  assert.equal(thingWordHeard(THING_KIND.PULL_REQUEST, "#42 Fix the refresh"), "pull request");
});
