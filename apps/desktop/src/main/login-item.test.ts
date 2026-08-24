import assert from "node:assert/strict";
import test from "node:test";
import { LoginItem, type LoginItemSurface, reconcileLoginItem } from "./login-item";

function harness(options: {
  packaged: boolean;
  platform: NodeJS.Platform;
  openAtLogin?: boolean;
  enabled?: boolean;
}) {
  let openAtLogin = options.openAtLogin ?? false;
  const writes: boolean[] = [];
  const surface: LoginItemSurface = {
    getLoginItemSettings: () => ({ openAtLogin }),
    setLoginItemSettings: (settings) => {
      openAtLogin = settings.openAtLogin;
      writes.push(settings.openAtLogin);
    },
  };
  return {
    loginItem: new LoginItem({
      surface,
      packaged: options.packaged,
      platform: options.platform,
      enabled: options.enabled,
    }),
    writes,
  };
}

test("a packaged Mac observes and changes its own login item", () => {
  const context = harness({ packaged: true, platform: "darwin", openAtLogin: false });

  assert.equal(context.loginItem.observed(), false);
  context.loginItem.apply(true);
  assert.equal(context.loginItem.observed(), true);
  assert.deepEqual(context.writes, [true]);
});

test("an unpackaged run neither observes nor changes a login item", () => {
  const context = harness({ packaged: false, platform: "darwin", openAtLogin: false });

  assert.equal(context.loginItem.observed(), undefined);
  context.loginItem.apply(true);
  assert.deepEqual(context.writes, []);
});

test("a packaged non-Mac run neither observes nor changes a login item", () => {
  const context = harness({ packaged: true, platform: "linux", openAtLogin: false });

  assert.equal(context.loginItem.observed(), undefined);
  context.loginItem.apply(true);
  assert.deepEqual(context.writes, []);
});

test("a packaged fixture or evidence run neither observes nor changes a login item", () => {
  const context = harness({
    packaged: true,
    platform: "darwin",
    openAtLogin: false,
    enabled: false,
  });

  assert.equal(context.loginItem.observed(), undefined);
  context.loginItem.apply(true);
  assert.deepEqual(context.writes, []);
});

test("the first packaged launch spends the default exactly once", async () => {
  const context = harness({ packaged: true, platform: "darwin", openAtLogin: false });
  const persisted: boolean[] = [];

  await reconcileLoginItem(context.loginItem, undefined, true, async (value) => {
    persisted.push(value);
  });

  assert.deepEqual(context.writes, [true]);
  assert.deepEqual(persisted, [true]);
});

test("a later removal in System Settings is mirrored instead of re-imposed", async () => {
  const context = harness({ packaged: true, platform: "darwin", openAtLogin: false });
  const persisted: boolean[] = [];

  await reconcileLoginItem(context.loginItem, true, true, async (value) => {
    persisted.push(value);
  });

  assert.deepEqual(context.writes, []);
  assert.deepEqual(persisted, [false]);
});

test("an unsupported run leaves both system and stored state alone", async () => {
  const context = harness({ packaged: false, platform: "darwin", openAtLogin: false });
  const persisted: boolean[] = [];

  await reconcileLoginItem(context.loginItem, undefined, true, async (value) => {
    persisted.push(value);
  });

  assert.deepEqual(context.writes, []);
  assert.deepEqual(persisted, []);
});
