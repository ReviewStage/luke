import assert from "node:assert/strict";
import { HOST_CAPABILITY } from "@luke/settings";
import type { WireValue } from "@luke/wire";
import { describe, test } from "vitest";
import { isAppStateSnapshot } from "./app-state.js";

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
      isAppStateSnapshot(delivered([HOST_CAPABILITY.VOICE, HOST_CAPABILITY.TERMINALS])),
      true,
    );
    assert.equal(isAppStateSnapshot(delivered([])), true);
  });

  test("are refused when one is unknown, one is not a word, or there is no list", () => {
    assert.equal(isAppStateSnapshot(delivered([HOST_CAPABILITY.VOICE, "teleport"])), false);
    assert.equal(isAppStateSnapshot(delivered([7])), false);
    assert.equal(isAppStateSnapshot(delivered(HOST_CAPABILITY.VOICE)), false);
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
