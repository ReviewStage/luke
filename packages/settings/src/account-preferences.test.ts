import assert from "node:assert/strict";
import { LINK_OPEN } from "@luke/features/link-open";
import { LIVE_VOICE } from "@luke/live";
import { test } from "vitest";
import { accountPreferencesParts, accountPreferencesToWrite } from "./schema-access.js";

/**
 * What a device writes of its preferences: a link choice it let go of
 * since it last synced is written as the browser, so the service's earlier
 * choice does not come back; one it never held is left out, so it clears
 * no other device's.
 */

test("a link choice cleared since the last sync is written as the browser", () => {
  const written = accountPreferencesToWrite(
    { voice: LIVE_VOICE.CEDAR },
    { voice: LIVE_VOICE.CEDAR, linkOpen: LINK_OPEN.MAC_APP },
  );
  assert.deepEqual(accountPreferencesParts(written), {
    preferences: { voice: LIVE_VOICE.CEDAR },
    linkOpen: LINK_OPEN.BROWSER,
  });
});

test("a link choice never held is left out of the write, whatever was synced", () => {
  for (const baseline of [undefined, {}, { voice: LIVE_VOICE.CEDAR }]) {
    const written = accountPreferencesToWrite({ voice: LIVE_VOICE.CEDAR }, baseline);
    assert.deepEqual(accountPreferencesParts(written), {
      preferences: { voice: LIVE_VOICE.CEDAR },
    });
  }
});

test("a link choice held is written as it stands", () => {
  const written = accountPreferencesToWrite({ linkOpen: LINK_OPEN.MAC_APP }, {});
  assert.deepEqual(accountPreferencesParts(written), {
    preferences: {},
    linkOpen: LINK_OPEN.MAC_APP,
  });
});
