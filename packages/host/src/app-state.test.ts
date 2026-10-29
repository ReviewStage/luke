import assert from "node:assert/strict";
import { INBOX_SCOPE_KIND } from "@luke/features/agent-view";
import { INBOX_STATUS, INBOX_WIRE_VERSION, type InboxItem } from "@luke/features/inbox-wire";
import { LIVE_READ } from "@luke/features/live-wire";
import { HOST_CAPABILITY } from "@luke/settings";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import type { WireValue } from "@luke/wire";
import { RPCSerializer } from "@orpc/client";
import { describe, test } from "vitest";
import {
  type AppInboxItems,
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

  test("crosses a change to the account's feed as the holders it moved alone, a holder emptied kept as empty, every other holder's list kept the very one the window held", () => {
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
    const quiet = [item("quiet", "Rotate the key?")];
    const fed = (plans: AppInboxItems["plan"]): AppStateSnapshot => ({
      ...document,
      [LIVE_READ.INBOX_ITEMS]: {
        rows: { [INBOX_SCOPE_KIND.PLAN]: plans, [INBOX_SCOPE_KIND.AGENT]: {} },
      },
    });
    const before = { quiet, moved: [item("moved", "Ship?")], emptied: [item("emptied", "Merge?")] };
    const held = withAppStateDelivery(
      fed({}),
      acrossTheWire(appStateDelivery(undefined, fed(before))),
    );
    const sent = fed(before);
    const next = {
      ...fed({ quiet, moved: [item("moved", "Ship tonight?")], emptied: [] }),
      version: 2,
    };

    const delivered = acrossTheWire(appStateDelivery(sent, next));
    const adopted = withAppStateDelivery(held, delivered);

    assert.deepEqual(Object.keys(delivered.entries), []);
    assert.deepEqual(Object.keys(delivered.inboxHolders?.[INBOX_SCOPE_KIND.PLAN] ?? {}), [
      "moved",
      "emptied",
    ]);
    const plans = adopted[LIVE_READ.INBOX_ITEMS].rows?.[INBOX_SCOPE_KIND.PLAN];
    assert.equal(plans?.quiet, held[LIVE_READ.INBOX_ITEMS].rows?.[INBOX_SCOPE_KIND.PLAN].quiet);
    assert.deepEqual(plans, { quiet, moved: [item("moved", "Ship tonight?")], emptied: [] });
  });
});
