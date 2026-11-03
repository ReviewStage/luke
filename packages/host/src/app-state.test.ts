import assert from "node:assert/strict";
import { RPCSerializer } from "@orpc/client";
import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { INBOX_STATUS, INBOX_WIRE_VERSION, type InboxItem } from "@repo/features/inbox-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { PAGE_OWNER, type PageLine } from "@repo/features/page-wire";
import { HOST_CAPABILITY } from "@repo/settings";
import { appSettingsWire, settingsView } from "@repo/settings/testing";
import type { WireValue } from "@repo/wire";
import { describe, test } from "vitest";
import {
  type AppHolderInboxes,
  type AppInboxItems,
  type AppPages,
  type AppStateDelivery,
  type AppStateSnapshot,
  appStateDelivery,
  isAppStateSnapshot,
  withAppStateDelivery,
} from "./app-state.js";
import { initialAppState } from "./client/app-state-store.js";
import { PUSH, PUSH_GUARD } from "./contract/index.js";
import { runModeFor } from "./run-mode.js";

/**
 * The boundary parse a window's bridge holds every delivered snapshot to: a
 * snapshot naming what its platform offers is taken, and one naming a
 * capability this build does not know, or none at all, is refused, since a
 * bridge other than the desktop's may hand it.
 */

/** The parts of a delivered snapshot the parse reads, with the run's capabilities as given. */
function delivered(capabilities: WireValue) {
  return {
    version: 3,
    run: { capabilities },
    window: { fullScreen: false },
  };
}

describe("a delivered snapshot's capabilities", () => {
  test("are taken when each is one this build knows, none included", () => {
    assert.equal(
      isAppStateSnapshot(delivered([HOST_CAPABILITY.MICROPHONE, HOST_CAPABILITY.TERMINALS])),
      true,
    );
    assert.equal(isAppStateSnapshot(delivered([])), true);
  });

  test("are refused when one is unknown, one is not a word, or there is no list", () => {
    assert.equal(isAppStateSnapshot(delivered([HOST_CAPABILITY.MICROPHONE, "teleport"])), false);
    assert.equal(isAppStateSnapshot(delivered([7])), false);
    assert.equal(isAppStateSnapshot(delivered(HOST_CAPABILITY.MICROPHONE)), false);
    assert.equal(isAppStateSnapshot({ ...delivered([]), run: {} }), false);
  });
});

describe("a delivered snapshot's version and window facts", () => {
  test("are taken with the slices the declaration does not name beside them", () => {
    assert.equal(
      isAppStateSnapshot({
        ...delivered([]),
        run: { capabilities: [], platform: "darwin", packaged: true },
        tasks: { list: [] },
      }),
      true,
    );
    assert.equal(isAppStateSnapshot({ ...delivered([]), version: 0 }), true);
  });

  test("are refused when the version is not a whole count or the window says nothing of full screen", () => {
    assert.equal(isAppStateSnapshot({ ...delivered([]), version: -1 }), false);
    assert.equal(isAppStateSnapshot({ ...delivered([]), version: 1.5 }), false);
    assert.equal(isAppStateSnapshot({ ...delivered([]), window: {} }), false);
    assert.equal(isAppStateSnapshot({ ...delivered([]), window: { fullScreen: "yes" } }), false);
    assert.equal(isAppStateSnapshot("a snapshot"), false);
  });
});

/**
 * A delivery as a window's push stream carries it: encoded by oRPC's RPC
 * serializer as the act port encodes every push, sent as text, decoded, and
 * read by the guard the window holds a push to.
 */
function acrossTheWire(delivery: AppStateDelivery | undefined): AppStateDelivery {
  if (delivery === undefined) throw new Error("nothing was delivered");
  const serializer = new RPCSerializer();
  const decoded: unknown = serializer.deserialize(
    JSON.parse(JSON.stringify(serializer.serialize(delivery))),
  );
  if (!PUSH_GUARD[PUSH.APP_STATE](decoded)) throw new Error("the window refused the delivery");
  // SAFETY: the window's own guard for the push admitted it above.
  return decoded as AppStateDelivery;
}

describe("a delivery that crosses the wire", () => {
  const document: AppStateSnapshot = {
    ...initialAppState(
      {
        launch: { profile: "idle", captureMode: false, fixtureMode: false },
        runMode: runModeFor({ capture: false, fixture: false }),
        appVersion: "1.2.3",
        packaged: true,
        platform: "darwin",
      },
      true,
      [],
    ),
    version: 1,
    window: { fullScreen: false },
  };

  test("still says a slice went, which a key holding undefined would not", () => {
    const held: AppStateSnapshot = { ...document, settings: appSettingsWire(settingsView()) };
    const { settings: _settings, ...signedOut } = held;
    const delivered = acrossTheWire(appStateDelivery(held, { ...signedOut, version: 2 }));
    assert.equal("settings" in withAppStateDelivery(held, delivered), false);
  });

  /** One inbox item, its title the words it is told apart by. */
  const item = (id: string, title: string): InboxItem => ({
    id,
    agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    key: id,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1,
    updatedAt: 1,
  });
  const page = (id: string, title: string): PageLine => ({ id, title, version: 1, at: 1 });
  const quietItem = item("quiet", "Rotate the key?");
  const quietPage = page("4b0c8e9a-9f61-4c1e-9d1a-2f7f3c6b5a10", "Rotate the key");
  const [alpha, bravo, charlie] = [
    item("alpha", "Alpha?"),
    item("bravo", "Bravo?"),
    item("charlie", "Charlie?"),
  ];
  const feed = (plans: AppInboxItems["plan"]): AppStateSnapshot => ({
    ...document,
    [LIVE_READ.INBOX_ITEMS]: {
      rows: { [INBOX_SCOPE_KIND.PLAN]: plans, [INBOX_SCOPE_KIND.AGENT]: {} },
    },
  });
  const held = (plans: AppHolderInboxes["plan"]): AppStateSnapshot => ({
    ...document,
    [LIVE_READ.HOLDER_INBOX]: { [INBOX_SCOPE_KIND.PLAN]: plans, [INBOX_SCOPE_KIND.AGENT]: {} },
  });
  const pages = (tasks: AppPages["task"]): AppStateSnapshot => ({
    ...document,
    [LIVE_READ.PAGES]: { [PAGE_OWNER.TASK]: tasks, [PAGE_OWNER.AGENT]: {} },
  });
  const quietList = [quietItem];
  const quietInbox = { rows: quietList };
  const quietPages = { rows: [quietPage] };

  test.each([
    {
      name: "the account's feed, a holder moved, one gone, and one kept",
      sent: feed({ quiet: quietList, moved: [item("moved", "Ship?")], gone: [alpha] }),
      next: feed({ quiet: quietList, moved: [item("moved", "Ship tonight?")] }),
      kept: (state: AppStateSnapshot) =>
        state[LIVE_READ.INBOX_ITEMS].rows?.[INBOX_SCOPE_KIND.PLAN].quiet,
      quiet: quietItem.title,
    },
    {
      name: "the held inboxes, a holder moved, one let go, and one kept",
      sent: held({ quiet: quietInbox, moved: { rows: [alpha] }, gone: { failed: true } }),
      next: held({ quiet: quietInbox, moved: { rows: [] } }),
      kept: (state: AppStateSnapshot) => state[LIVE_READ.HOLDER_INBOX][INBOX_SCOPE_KIND.PLAN].quiet,
      quiet: quietItem.title,
    },
    {
      name: "the held pages, an owner's moved, one let go, and one kept",
      sent: pages({
        quiet: quietPages,
        moved: { rows: [page("9d3f7a2c-1b4e-4f6a-8c2d-5e7b9a1c3d4f", "Draft")] },
        gone: { rows: [] },
      }),
      next: pages({
        quiet: quietPages,
        moved: { rows: [page("9d3f7a2c-1b4e-4f6a-8c2d-5e7b9a1c3d4f", "Final")] },
      }),
      kept: (state: AppStateSnapshot) => state[LIVE_READ.PAGES][PAGE_OWNER.TASK].quiet,
      quiet: quietPage.title,
    },
    {
      name: "a held inbox's rows, one retitled, one gone, one come at the head, and one kept",
      sent: held({ moved: { rows: [alpha, bravo, charlie] } }),
      next: held({
        moved: { rows: [item("delta", "Delta?"), alpha, item("bravo", "Bravo now?")] },
      }),
      kept: (state: AppStateSnapshot) =>
        state[LIVE_READ.HOLDER_INBOX][INBOX_SCOPE_KIND.PLAN].moved?.rows?.find(
          (row) => row.id === alpha.id,
        ),
      quiet: alpha.title,
    },
  ])(
    "crosses a change to $name as what moved alone, what it kept the very one the window held",
    ({ sent, next, kept, quiet }) => {
      const window = withAppStateDelivery(
        document,
        acrossTheWire(appStateDelivery(undefined, sent)),
      );
      const delivered = acrossTheWire(appStateDelivery(sent, { ...next, version: 2 }));
      const adopted = withAppStateDelivery(window, delivered);

      assert.deepEqual(adopted, { ...next, version: 2 });
      assert.notEqual(kept(window), undefined);
      assert.equal(kept(adopted), kept(window));
      assert.equal(JSON.stringify(delivered).includes(quiet), false);
    },
  );
});
