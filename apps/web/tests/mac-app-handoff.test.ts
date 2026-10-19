import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  LINK_OPEN,
  LINK_PLATFORM,
  type LinkOpen,
  type LinkPlatform,
} from "@luke/features/link-open";
import { Effect } from "effect";
import { handOffToMacApp } from "../src/app/mac-app-handoff";
import { type FakeService, fakeService } from "./support/fake-service";

/**
 * A Luke link loaded in a tab, handed to Luke for Mac only where the
 * signed-in account chose the Mac app and the tab is on a Mac: the place
 * the address names goes to the app in its own scheme, and every other
 * load stays on the web. Synthetic ids.
 */

const ORIGIN = "http://localhost:3000";
const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const PLAN_ADDRESS = `${ORIGIN}/acme/plan/${TASK_ID}`;

/** What the browser was asked to open, after one load at the address given. */
const loaded = (
  service: FakeService,
  address: string,
  platform: LinkPlatform,
): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    const opened: string[] = [];
    yield* handOffToMacApp({ address, platform, open: (link) => opened.push(link) }, ORIGIN).pipe(
      Effect.provide(service.layer),
    );
    return opened;
  });

/** A service whose signed-in account chose the place given. */
const choosing = (linkOpen: LinkOpen) => fakeService({ signedIn: true, linkOpen });

/** Whether the service was asked for the account's preferences. */
const askedPreferences = (service: FakeService) =>
  service.seen().some((request) => request.path === "/api/account/preferences");

it.effect("an account that chose the Mac app hands a plan's link to the app, on a Mac", () =>
  Effect.gen(function* () {
    const opened = yield* loaded(choosing(LINK_OPEN.MAC_APP), PLAN_ADDRESS, LINK_PLATFORM.MAC);
    assert.equal(opened.length, 1);
    assert.match(opened[0] ?? "", /^tryluke:/u);
    assert.match(opened[0] ?? "", new RegExp(`/acme/plan/${TASK_ID}$`, "u"));
  }),
);

it.effect("an account that chose the browser stays on the web", () =>
  Effect.gen(function* () {
    assert.deepEqual(
      yield* loaded(choosing(LINK_OPEN.BROWSER), PLAN_ADDRESS, LINK_PLATFORM.MAC),
      [],
    );
  }),
);

it.effect("an account that never chose stays on the web", () =>
  Effect.gen(function* () {
    assert.deepEqual(
      yield* loaded(fakeService({ signedIn: true }), PLAN_ADDRESS, LINK_PLATFORM.MAC),
      [],
    );
  }),
);

it.effect("a visitor signed out stays on the web", () =>
  Effect.gen(function* () {
    const service = fakeService({ signedIn: false, linkOpen: LINK_OPEN.MAC_APP });
    assert.deepEqual(yield* loaded(service, PLAN_ADDRESS, LINK_PLATFORM.MAC), []);
  }),
);

it.effect(
  "off a Mac, or at an address naming no place, nothing is handed off and the service is not asked",
  () =>
    Effect.gen(function* () {
      for (const [address, platform] of [
        [PLAN_ADDRESS, LINK_PLATFORM.OTHER],
        [`${ORIGIN}/app`, LINK_PLATFORM.MAC],
      ] as const) {
        const service = choosing(LINK_OPEN.MAC_APP);
        assert.deepEqual(yield* loaded(service, address, platform), [], address);
        assert.equal(askedPreferences(service), false, address);
      }
    }),
);
