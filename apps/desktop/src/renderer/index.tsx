/**
 * index.tsx -- the panel window's entry: `App`, with the avatar's voice playing beside it.
 *
 * Loaded by `index.html` alone. The panel is the one window that records
 * (`App` is where session replay starts) and the one that runs Luke's
 * avatar, so neither the voice window's nor the call window's entry mounts
 * either. The avatar's voice plays beside `App`, so no tab it shows cuts it.
 */

import { App } from "@luke/panel/app";
import { SideBundlesContext } from "@luke/panel/bundle-loader";
import { callAvatarAtom } from "@luke/panel/call/call-avatar";
import { PanelAvatarVoice } from "@luke/panel/call/panel-avatar";
import { installWindowHistory } from "@luke/panel/navigation-history";
import { rendererRegistry } from "@luke/panel/renderer-runtime";
import { installShellBundles } from "@luke/panel/shell-bundles";
import { memoryHistory } from "@luke/ui/history-adapter";
import { DESKTOP_BUNDLES, DESKTOP_SIDE_BUNDLES } from "./desktop-bundles";
import { mountWindow } from "./window-root";

// The Factory's worlds and a call's avatar are the desktop's own bundles, and so is its scene below.
installShellBundles(DESKTOP_BUNDLES);
// The panel's back and forward live in memory for as long as the window is open.
installWindowHistory(memoryHistory());

mountWindow(
  <>
    <PanelAvatarVoice />
    <SideBundlesContext value={DESKTOP_SIDE_BUNDLES}>
      <App />
    </SideBundlesContext>
  </>,
);

// The avatar is subscribed to before anything is drawn, because main hands
// the page the standing grant once it has drawn its first frame; the draw
// waits on the window's first read, so this lands before it.
rendererRegistry.mount(callAvatarAtom);
