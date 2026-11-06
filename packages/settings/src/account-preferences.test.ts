import assert from "node:assert/strict";
import { LINK_OPEN } from "@repo/features/link-open";
import { test } from "vitest";
import { AGENT_ENTER } from "./agent-enter.js";
import { COMMIT_AUTHOR } from "./commit-author.js";
import {
  type AccountPreferences,
  accountPreferencesParts,
  accountPreferencesToPush,
  accountPreferencesToWrite,
} from "./schema-access.js";

const V0_18_0_PREFERENCE_KEYS: readonly string[] = ["voice"];

test("a link choice cleared since the last sync is written as the browser", () => {
  const written = accountPreferencesToWrite({}, { linkOpen: LINK_OPEN.MAC_APP });
  assert.deepEqual(accountPreferencesParts(written), {
    preferences: {},
    linkOpen: LINK_OPEN.BROWSER,
  });
});

test("a link choice never held is left out of the write, whatever was synced", () => {
  for (const baseline of [undefined, {}]) {
    const written = accountPreferencesToWrite({}, baseline);
    assert.deepEqual(accountPreferencesParts(written), { preferences: {} });
  }
});

test("a link choice held is written as it stands", () => {
  const written = accountPreferencesToWrite({ linkOpen: LINK_OPEN.MAC_APP }, {});
  assert.deepEqual(accountPreferencesParts(written), {
    preferences: {},
    linkOpen: LINK_OPEN.MAC_APP,
  });
});

test("a push leaves out a link part a Mac has not changed since it synced, so the web's newer choice stands", () => {
  const pushed = accountPreferencesToPush(
    { linkOpen: LINK_OPEN.MAC_APP },
    { linkOpen: LINK_OPEN.MAC_APP },
  );
  assert.deepEqual(accountPreferencesParts(pushed), { preferences: {} });
});

test("a push carries a link choice changed or cleared since the last sync", () => {
  const changed = accountPreferencesToPush(
    { linkOpen: LINK_OPEN.BROWSER },
    { linkOpen: LINK_OPEN.MAC_APP },
  );
  assert.equal(accountPreferencesParts(changed).linkOpen, LINK_OPEN.BROWSER);

  const first = accountPreferencesToPush({ linkOpen: LINK_OPEN.MAC_APP }, undefined);
  assert.equal(accountPreferencesParts(first).linkOpen, LINK_OPEN.MAC_APP);

  const cleared = accountPreferencesToPush({}, { linkOpen: LINK_OPEN.MAC_APP });
  assert.equal(accountPreferencesParts(cleared).linkOpen, LINK_OPEN.BROWSER);
});

test("the snapshot's preferences part carries only the keys v0.18.0 reads, whatever the account holds", () => {
  const everything = {
    linkOpen: LINK_OPEN.MAC_APP,
    agentEnter: AGENT_ENTER.QUEUE,
    commitAuthor: COMMIT_AUTHOR.APP,
    setupFinished: true,
    setupPlace: '{"audience":"me","at":1}',
  } satisfies Required<AccountPreferences>;
  const shared = Object.keys(accountPreferencesParts(everything).preferences);
  assert.deepEqual(
    shared.filter((key) => !V0_18_0_PREFERENCE_KEYS.includes(key)),
    [],
  );
});
