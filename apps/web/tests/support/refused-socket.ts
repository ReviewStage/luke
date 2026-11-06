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

globalThis.WebSocket = RefusedSocket as unknown as typeof WebSocket;
