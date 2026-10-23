import { lazyRoute } from "./lazy-route.js";

/**
 * experiments-on-demand.ts -- the surfaces of the features behind Settings › Experimental, each a chunk of its own read the first time it is drawn, so a window whose account has them off never parses them.
 *
 * Every surface here is drawn only behind its experiment's gate
 * (`useExperiment`, `chat-gate.ts`), so the bundle every launch parses
 * carries the gate and none of what it guards: Chat's place and its plan
 * tab, a cloud Browser tab, and a video call's tile, toggle, and the
 * avatar's voice. Each is drawn under a `Suspense`; the chunk is a local
 * file, so it stands a frame later. The avatar's session itself is reached
 * the same way, through its gate's atom (`call/panel-avatar.tsx`).
 */

/** The window's Chat, in the plan's place (`desktop/desktop-chat.tsx`). */
export const CHAT_PLACE = lazyRoute(() =>
  import("./desktop/desktop-chat.js").then((loaded) => loaded.DesktopChat),
);

/** A plan's own Chat tab (`desktop/desktop-chat.tsx`). */
export const TASK_CHAT_TAB = lazyRoute(() =>
  import("./desktop/desktop-chat.js").then((loaded) => loaded.TaskChatTab),
);

/** A cloud Browser tab in the side panel (`tasks/cloud-browser-pane.tsx`). */
export const CLOUD_BROWSER_TAB = lazyRoute(() =>
  import("./tasks/cloud-browser-pane.js").then((loaded) => loaded.CloudBrowserPane),
);

/** A cloud Browser tab's draft, which opens nothing until its bar opens an address (`tasks/cloud-browser-pane.tsx`). */
export const CLOUD_BROWSER_DRAFT = lazyRoute(() =>
  import("./tasks/cloud-browser-pane.js").then((loaded) => loaded.CloudBrowserDraftPane),
);

/** The avatar's voice, played from the panel's root (`call/video-calls.tsx`). */
export const AVATAR_VOICE = lazyRoute(() =>
  import("./call/video-calls.js").then((loaded) => loaded.AvatarVoicePlayer),
);

/** Luke's video above the composer of the call's own agent's tab (`call/video-calls.tsx`). */
export const AGENT_CALL_VIDEO = lazyRoute(() =>
  import("./call/video-calls.js").then((loaded) => loaded.AgentCallVideoFrame),
);

/** The avatar's tile on a call card (`call/call-video-tile.tsx`). */
export const CALL_VIDEO_TILE = lazyRoute(() =>
  import("./call/call-video-tile.js").then((loaded) => loaded.CallVideoTile),
);

/** A call card's Video on, once the avatar is down (`call/call-video-tile.tsx`). */
export const VIDEO_TOGGLE = lazyRoute(() =>
  import("./call/call-video-tile.js").then((loaded) => loaded.VideoToggle),
);
