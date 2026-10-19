/**
 * index.tsx -- the panel window's entry: `App`, with the avatar's voice playing beside it.
 *
 * Loaded by `index.html` alone. The panel is the one window that records
 * (`App` is where session replay starts) and the one that runs Luke's
 * avatar, so neither the voice window's nor the call window's entry mounts
 * either. The avatar's voice plays beside `App`, so no tab it shows cuts it.
 */

import { App } from "@luke/panel/app";
import { callAvatarAtom } from "@luke/panel/call/call-avatar";
import { PanelAvatarVoice } from "@luke/panel/call/panel-avatar";
import { installWindowHistory } from "@luke/panel/navigation-history";
import { rendererRegistry } from "@luke/panel/renderer-runtime";
import { installShellBundles } from "@luke/panel/shell-bundles";
import { memoryHistory } from "@luke/ui/history-adapter";
import { DESKTOP_BUNDLES } from "./desktop-bundles";
import { mountWindow } from "./window-root";

// A call's avatar is the desktop's own bundle.
installShellBundles(DESKTOP_BUNDLES);
// The panel's back and forward live in memory for as long as the window is open.
installWindowHistory(memoryHistory());

mountWindow(
  <>
    <PanelAvatarVoice />
    <App />
  </>,
);

// The avatar is subscribed to before anything is drawn, because main hands
// the page the standing grant once it has drawn its first frame; the draw
// waits on the window's first read, so this lands before it.
rendererRegistry.mount(callAvatarAtom);
