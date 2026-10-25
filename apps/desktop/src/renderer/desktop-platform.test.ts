import assert from "node:assert/strict";
import { ACT_KIND } from "@luke/host/acts";
import { fakeActPort } from "@luke/panel/testing/app-bridge";
import { test } from "vitest";
import { DESKTOP_PLATFORM } from "./desktop-platform";

/**
 * What the desktop's window tells main of its unsaved work: held while a
 * page stands its leave ask or a plan holds words not saved, and let go only
 * once neither does, so a quit, a restart to update, and a sign-out ask
 * about either.
 */

test("main hears unsaved work while a page's ask or a plan's words stand, and none once neither does", async () => {
  const told: boolean[] = [];
  fakeActPort({
    [ACT_KIND.WINDOW_UNSAVED_WORK]: async ({ holding }) => {
      told.push(holding);
    },
  });

  DESKTOP_PLATFORM.unsavedPlanWords?.(true);
  DESKTOP_PLATFORM.unsavedWork?.(() => undefined);
  DESKTOP_PLATFORM.unsavedWork?.(undefined);
  DESKTOP_PLATFORM.unsavedPlanWords?.(false);
  await Promise.resolve();

  assert.deepEqual(told, [true, true, true, false]);
});
