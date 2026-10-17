/**
 * index.tsx -- the panel window's entry: `App`, with the avatar's voice playing beside it.
 *
 * Loaded by `index.html` alone. The panel is the one window that records
 * (`App` is where session replay starts) and the one that runs Luke's
 * avatar, so neither the voice window's nor the call window's entry mounts
 * either. The avatar's voice plays beside `App`, so no tab it shows cuts it.
 */

import { memoryHistory } from "@luke/ui/history-adapter";
import { App } from "./app";
import { callAvatarAtom } from "./call/call-avatar";
import { PanelAvatarVoice } from "./call/panel-avatar";
import { installWindowHistory } from "./navigation-history";
import { rendererRegistry } from "./renderer-runtime";
import { mountWindow } from "./window-root";

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
