import assert from "node:assert/strict";
import { ACT_KIND } from "@repo/host/acts";
import { fakeActPort } from "@repo/panel/testing/app-bridge";
import { test } from "vitest";
import { DESKTOP_PLATFORM } from "./desktop-platform";

test("main hears unsaved work while a page's ask or a description's words stand, and none once neither does", async () => {
  const told: boolean[] = [];
  fakeActPort({
    [ACT_KIND.WINDOW_UNSAVED_WORK]: async ({ holding }) => {
      told.push(holding);
    },
  });

  DESKTOP_PLATFORM.unsavedDescriptionWords?.(true);
  DESKTOP_PLATFORM.unsavedWork?.(() => undefined);
  DESKTOP_PLATFORM.unsavedWork?.(undefined);
  DESKTOP_PLATFORM.unsavedDescriptionWords?.(false);
  await Promise.resolve();

  assert.deepEqual(told, [true, true, true, false]);
});
