/**
 * web-browser-live.ts -- the web's door to a cloud Browser tab's live view: the socket opened from this page, on its own origin, under the session cookie the browser carries.
 *
 * The relay admits a page of the deployment's own origin by its cookie and
 * holds the `Origin` the browser names to its own (`browser-live-wire.ts`),
 * so the page opens the socket itself, as a plain same-origin `WebSocket`.
 * What the panel sends before the socket opens is held for it, up to a
 * bound; a socket refused or unreachable closes as a browser closes it,
 * abnormally, which the panel reads as a drop.
 */

import { browserLivePath } from "@luke/features/browser-live-acts";
import type { OpenBrowserLive } from "@luke/panel/app-platform";

/** The most text frames a socket holds while it opens; past it the newest are let go. */
const HELD_WHILE_OPENING = 32;

/** Opens one tab's live view socket on this page's own origin. */
export const openBrowserLiveOverWebSocket: OpenBrowserLive = (target, listener) => {
  const address = new URL(browserLivePath(target), location.origin);
  address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(address);
  const held: string[] = [];
  let done = false;
  socket.addEventListener("open", () => {
    for (const text of held.splice(0)) socket.send(text);
  });
  socket.addEventListener("message", (event) => {
    if (!done && typeof event.data === "string") listener.message(event.data);
  });
  socket.addEventListener("close", (event) => {
    if (done) return;
    done = true;
    listener.closed(event.code);
  });
  return {
    send: (text) => {
      if (done) return;
      if (socket.readyState === WebSocket.OPEN) socket.send(text);
      else if (socket.readyState === WebSocket.CONNECTING && held.length < HELD_WHILE_OPENING) {
        held.push(text);
      }
    },
    close: () => {
      done = true;
      socket.close();
    },
  };
};
