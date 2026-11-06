import { browserLivePath } from "@repo/features/browser-live-acts";
import type { OpenBrowserLive } from "@repo/panel/app-platform";

const HELD_WHILE_OPENING = 32;

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
