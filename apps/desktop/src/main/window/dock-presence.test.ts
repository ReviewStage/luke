import assert from "node:assert/strict";
import test from "node:test";
import { DOCK_ICON_FILES, DockPresence, type DockTile } from "./dock-presence";

function harness(options: { visible?: boolean; ignoreFirstHide?: boolean } = {}) {
  let visible = options.visible ?? false;
  let hideAttempts = 0;
  const icons: string[] = [];
  const focused: Array<number | undefined> = [];
  const delays: number[] = [];
  let themeUpdated: (() => void) | undefined;
  let dark = false;

  const dock: DockTile = {
    isVisible: () => visible,
    show: async () => {
      visible = true;
    },
    hide: () => {
      hideAttempts += 1;
      if (options.ignoreFirstHide && hideAttempts < 2) return;
      visible = false;
    },
    setIcon: () => {
      icons.push(dark ? DOCK_ICON_FILES.DARK : DOCK_ICON_FILES.LIGHT);
    },
  };

  const presence = new DockPresence({
    focusExpanded: (displayId) => focused.push(displayId),
    iconDirectory: "/unused",
    dock,
    theme: {
      get shouldUseDarkColors() {
        return dark;
      },
      on: (_event, listener) => {
        themeUpdated = listener;
      },
    },
    loadIcon: () => {
      // SAFETY: Test double implements only NativeImage.isEmpty used by DockPresence.
      return {
        isEmpty: () => false,
        // SAFETY: Test double implements only the NativeImage surface this test reads.
      } as Electron.NativeImage;
    },
    delay: async (ms) => {
      delays.push(ms);
    },
    settleMs: 11,
  });

  return {
    presence,
    icons: () => icons,
    focused: () => focused,
    delays: () => delays,
    hideAttempts: () => hideAttempts,
    isVisible: () => visible,
    setDark(next: boolean) {
      dark = next;
    },
    themeChange() {
      themeUpdated?.();
    },
  };
}

test("a hide macOS ignores is asked again until the Dock matches", async () => {
  const context = harness({ visible: true, ignoreFirstHide: true });
  context.presence.apply(false, 7);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(context.hideAttempts(), 2);
  assert.equal(context.isVisible(), false);
  assert.deepEqual(context.focused(), [7, 7]);
  assert.deepEqual(context.delays(), [11, 11]);
});

test("a show puts Luke's face back on the tile the show forgot", async () => {
  const context = harness({ visible: false });
  context.presence.apply(true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(context.isVisible(), true);
  assert.deepEqual(context.icons(), [DOCK_ICON_FILES.LIGHT]);
});

test("the tile follows the desktop through light and dark", () => {
  const context = harness();
  context.presence.applyIcon();
  assert.deepEqual(context.icons(), [DOCK_ICON_FILES.LIGHT]);
  context.setDark(true);
  context.presence.watchTheme();
  context.themeChange();
  assert.deepEqual(context.icons(), [DOCK_ICON_FILES.LIGHT, DOCK_ICON_FILES.DARK]);
});
