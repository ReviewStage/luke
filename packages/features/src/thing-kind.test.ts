import assert from "node:assert/strict";
import { test } from "vitest";
import { THING_KIND, thingWordHeard } from "./thing-kind.js";

test("a place labeled with words of its own still says its kind", () => {
  assert.equal(thingWordHeard(THING_KIND.INBOX, "my queue"), "Inbox");
  assert.equal(thingWordHeard(THING_KIND.AUTOMATIONS, "the nightly jobs"), "automations");
  assert.equal(thingWordHeard(THING_KIND.CHANGES, "Ada's diff"), "changes");
});

test("a name that already starts with its kind says it once", () => {
  assert.equal(thingWordHeard(THING_KIND.INBOX, "Inbox"), undefined);
  assert.equal(thingWordHeard(THING_KIND.APP, "Vespin"), undefined);
  assert.equal(thingWordHeard(THING_KIND.CHANGES, "Changes by Ada"), undefined);
  assert.equal(thingWordHeard(THING_KIND.MESSAGE, "Message from Ada"), undefined);
  assert.equal(thingWordHeard(THING_KIND.INBOX, "Inbox (team)"), undefined);
  assert.equal(thingWordHeard(THING_KIND.AUTOMATIONS, "Automations."), undefined);
});

test("a name that only begins with the kind's letters still says its kind", () => {
  assert.equal(thingWordHeard(THING_KIND.PLAN, "Taskbar polish"), "task");
  assert.equal(thingWordHeard(THING_KIND.PULL_REQUEST, "#42 Fix the refresh"), "pull request");
});
