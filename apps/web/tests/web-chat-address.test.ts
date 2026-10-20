// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { RUN_PROFILE } from "@luke/host/app-state";
import { appStateFirstRead } from "@luke/panel/use-app-state";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, vi } from "vitest";
import {
  addressBar,
  drawPanel,
  installPanelDoors,
  openAt,
  unmountPanels,
} from "./support/web-panel";

/**
 * Chat and Settings at addresses of their own in the tab: Chat at its
 * workspace's `/chat`, a channel at `/chat/<channelId>`, each written as
 * the panel goes there and opened again from the address a tab loads at;
 * a channel the chat does not hold, as a stale link's, opens Chat on For
 * you at `/chat`, and a Settings page the window does not know opens
 * Settings on its first page. Drawn on the chat profile's staged chat, in
 * its workspace, `personal`; each load is the panel drawn again over a tab
 * standing at the address with no step saved, as a page first loaded there.
 */

/** The staged chat's topic channel, `members-schema`, by the id the fixture mints it (`chat-fixture.ts`). */
const SCHEMA_CHANNEL = "0e1f2a3b-4c5d-4e6f-8a7b-8c9d0e1f2a3b";

/** A channel id the staged chat holds none of. */
const GONE_CHANNEL = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

afterEach(() => {
  unmountPanels();
  vi.restoreAllMocks();
});

/** The panel drawn afresh over a tab loaded at `address`. */
async function loadedAt(address: string) {
  unmountPanels();
  openAt(address);
  installPanelDoors(RUN_PROFILE.CHAT);
  return drawPanel();
}

/** Presses the button whose words are `words`, as the Chat rail draws a channel's row. */
async function pressRow(words: string): Promise<void> {
  const row = [...document.querySelectorAll("button")].find((one) =>
    one.textContent?.includes(words),
  );
  assert.ok(row !== undefined, `a ${words} row stands`);
  await act(async () => row.click());
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

it.effect(
  "Chat and a channel chosen in it write their addresses, a loaded channel's address opens it, and a stale channel or Settings page falls back to its root",
  () =>
    Effect.gen(function* () {
      openAt("/app");
      installPanelDoors(RUN_PROFILE.CHAT);
      yield* appStateFirstRead;
      yield* Effect.promise(async () => {
        const panel = await drawPanel();
        // The staged chat is imported apart from the panel's bundle, so it lands on its own time.
        // The staged chat is imported apart from the panel's bundle, so it lands on its own time.
        await vi.waitFor(() =>
          assert.ok(panel.shows("For you"), "the chat profile opens Chat on For you"),
        );
        assert.equal(addressBar(), "/personal/chat");

        await pressRow("members-schema");
        assert.ok(panel.shows("# members-schema"), "the channel chosen is shown");
        assert.equal(addressBar(), `/personal/chat/${SCHEMA_CHANNEL}`);

        // A wide room's Chat is one step whichever place it shows, so the channel takes For you's entry in place.
        assert.equal(window.history.length, 1);

        const reloaded = await loadedAt(`/personal/chat/${SCHEMA_CHANNEL}`);
        assert.ok(reloaded.shows("# members-schema"), "a channel's address opens it");
        assert.equal(addressBar(), `/personal/chat/${SCHEMA_CHANNEL}`);

        const stale = await loadedAt(`/personal/chat/${GONE_CHANNEL}`);
        assert.ok(stale.shows("For you"), "a channel the chat does not hold opens For you");
        assert.equal(addressBar(), "/personal/chat", "and the address names Chat alone");

        const unknownPage = await loadedAt("/personal/settings/billing");
        assert.ok(unknownPage.shows("Settings pages"), "a page Settings does not know opens it");
        assert.equal(addressBar(), "/personal/settings/account", "on its first page");
      });
    }),
);
