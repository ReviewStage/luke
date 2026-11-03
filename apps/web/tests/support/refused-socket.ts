/**
 * refused-socket.ts -- the web suite's own `WebSocket`: one that opens nothing and stands closed from the moment it is made, as a browser reads an upgrade the server refused.
 *
 * A signed-in tab opens the live reads' socket on its first read
 * (`@repo/host`'s `live-socket.ts`), and jsdom's socket, or Node's, would
 * dial the page's origin, a port on whatever machine runs the suite. With
 * this one every open reads as unreachable at once, so the host polls over
 * HTTP, which a test's fake service answers, and no test waits on a socket
 * or touches the network. The vitest config runs this before every file,
 * and it is assigned rather than stubbed, so `vi.unstubAllGlobals()` puts it
 * back after a test that stubs a socket of its own (`vi.stubGlobal`).
 */

class RefusedSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly readyState = RefusedSocket.CLOSED;
  binaryType = "blob";
  constructor(readonly url: string) {
    super();
  }
  send(): void {}
  close(): void {}
}

// SAFETY: the host reads only the constants, `readyState`, events, `send`, and `close` of a socket, which this stand-in has.
globalThis.WebSocket = RefusedSocket as unknown as typeof WebSocket;
