// @vitest-environment jsdom
import assert from "node:assert/strict";
import type { ReadLink } from "@luke/features/luke-link";
import { RUN_PROFILE } from "@luke/host/app-state";
import { appStateFirstRead } from "@luke/panel/use-app-state";
import { Effect } from "effect";
import { afterEach, test } from "vitest";
import { browserHistory } from "../src/app/browser-history";
import { withLoadLink } from "../src/app/load-link";
import {
  addressBar,
  drawPanel,
  fixtureBridge,
  installPanelDoors,
  openAt,
  travel,
  unmountPanels,
} from "./support/web-panel";

/**
 * The tab's own history as the panel's: each step the panel records is an
 * entry of the browser's history at its address, the browser's Back and
 * Forward take the panel back and forward without a step of their own, and
 * the address a tab is opened at opens its place. The panel is drawn on the
 * fixture run's document, as the web root draws it before a host runs in the
 * tab, and jsdom keeps the history and fires `popstate` as a browser does.
 */

afterEach(unmountPanels);

/** The links the tab's address is said as, to one subscriber of the bridge. */
function linksSaid(): ReadLink[] {
  const said: ReadLink[] = [];
  withLoadLink(fixtureBridge(RUN_PROFILE.IDLE)).onShowLink((link) => said.push(link));
  return said;
}

test("a visit pushes an entry at its address and a step taken in place replaces it, each saving its state, and every entry's state stays readable", () => {
  openAt("/app");
  const history = browserHistory<string>();
  const before = window.history.length;

  history.push({ address: "/acme/inbox", state: "inbox" });
  history.push({ address: "/acme/settings", state: "settings" });
  history.replace({ address: "/acme/settings/appearance", state: "appearance" });

  assert.equal(addressBar(), "/acme/settings/appearance");
  assert.equal(window.history.length, before + 1, "the first visit takes the page's own entry");
  assert.deepEqual(
    history.current().entries.map((entry) => entry.state),
    ["inbox", "appearance"],
  );
  assert.equal(history.current().at, 1);
});

test("the browser's Back stands the entry before and tells every listener, and its Forward the entry after", async () => {
  openAt("/app");
  const history = browserHistory<string>();
  history.push({ address: "/acme/inbox", state: "inbox" });
  history.push({ address: "/acme/settings", state: "settings" });
  const heard: number[] = [];
  history.subscribe(() => heard.push(history.current().at));

  await travel(() => window.history.back());
  assert.equal(addressBar(), "/acme/inbox");
  assert.deepEqual(heard, [0]);

  await travel(() => window.history.forward());
  assert.equal(addressBar(), "/acme/settings");
  assert.deepEqual(heard, [0, 1]);
  assert.equal(history.current().entries.length, 2, "moving along the entries writes none");
});

test("a step written while a move of the panel's is still travelling lands on the entry it went to, not the one it left", async () => {
  openAt("/app");
  const history = browserHistory<string>();
  history.push({ address: "/acme/inbox", state: "inbox" });
  history.push({ address: "/acme/settings", state: "settings" });

  await travel(() => {
    history.go(-1);
    history.replace({ address: "/personal/inbox", state: "personal inbox" });
  });

  assert.equal(addressBar(), "/personal/inbox");
  await travel(() => window.history.forward());
  assert.equal(addressBar(), "/acme/settings", "the entry left keeps its own address");
});

test("a tab reloaded on an entry the history saved starts on it, and learns the entry behind it as the browser lands there", async () => {
  openAt("/app");
  const first = browserHistory<string>();
  first.push({ address: "/acme/inbox", state: "inbox" });
  first.push({ address: "/acme/settings", state: "settings" });

  const reloaded = browserHistory<string>();
  assert.deepEqual(reloaded.current(), {
    entries: [{ address: "/acme/settings", state: "settings" }],
    at: 0,
  });

  await travel(() => window.history.back());
  assert.deepEqual(reloaded.current(), {
    entries: [
      { address: "/acme/inbox", state: "inbox" },
      { address: "/acme/settings", state: "settings" },
    ],
    at: 0,
  });
});

test("the panel's own paths, and an entry holding a saved step, say no link as the page loads; a Luke link's path says its place once", () => {
  for (const address of ["/app", "/app.html", "/app/"]) {
    openAt(address);
    assert.deepEqual(linksSaid(), [], `${address} opens Home`);
  }
  window.history.replaceState({ state: "settings", idx: 0 }, "", "/acme/settings");
  assert.deepEqual(linksSaid(), [], "a saved step is reopened from its state instead");

  openAt("/acme/settings/appearance");
  const bridge = withLoadLink(fixtureBridge(RUN_PROFILE.IDLE));
  const said: ReadLink[] = [];
  bridge.onShowLink((link) => said.push(link));
  bridge.onShowLink((link) => said.push(link));
  assert.deepEqual(said, [{ workspace: "acme", place: { kind: "settings", page: "appearance" } }]);
});

test("a tab opened at a link opens its place, the browser's Back lands on the screen before without a step of its own, and Forward opens the place again", async () => {
  openAt("/personal/settings/appearance");
  installPanelDoors();
  await Effect.runPromise(appStateFirstRead);
  const panel = await drawPanel();
  assert.ok(panel.shows("Settings pages"), "the link opens Settings on its page");
  assert.equal(addressBar(), "/personal/settings/appearance");
  const entries = window.history.length;

  await travel(() => window.history.back());
  assert.ok(panel.shows("Home"), "Back lands on Home");
  assert.equal(addressBar(), "/app");
  assert.equal(window.history.length, entries, "and pushes nothing");

  await travel(() => window.history.forward());
  assert.ok(panel.shows("Settings pages"), "Forward opens Settings again");
  assert.equal(addressBar(), "/personal/settings/appearance");
  assert.equal(window.history.length, entries);
});
