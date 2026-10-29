/**
 * large-messages.ts -- a window's act port as main serves it, noting each large message it sends the window: the act it answers or the push it carries, and its length.
 *
 * A message large enough to hold the window's page while it reads it is
 * noted as it leaves, before the page starts on it, so a freeze the page
 * reports next names what it was reading. Note that the port reads oRPC's
 * wire text by its head alone and only where it can name what it reads: a
 * request names its procedure (`"url"`), a push its name (`"push"`). A
 * message whose head reads otherwise is still noted, by its length alone, so
 * an oRPC release that writes its messages differently loses the name and
 * never the note.
 */

import type { MessagePortMainLike } from "@orpc/client/message-port";

/**
 * How long a message must be to be noted: half a mebibyte of text, which a
 * page takes a frame or more to read, where the port's ordinary answers and
 * pushes run to a few kibibytes.
 */
const LARGE_ACT_PORT_MESSAGE_LENGTH = 512 * 1024;

/** How much of a message's head is read for what it carries. */
const HEAD_LENGTH = 512;

/**
 * How many calls the port remembers the procedure of at once. Note that a
 * plain answer forgets its call as it is sent, so what stands is the streams
 * still open, which a window holds a few of; the bound only keeps a stream
 * the window walked away from from standing for the port's life.
 */
const REMEMBERED_CALLS = 256;

const REQUEST_HEAD = /^\{"id":"([^"]+)","kind":"request","json":\{"url":"([\w./-]+)"/;
const MESSAGE_ID = /"id":"([^"]+)"/;
const MESSAGE_KIND = /"kind":"([\w-]+)"/;
const STREAM_ANSWER = /"standard-server":"event-stream"/;
const PUSH_NAME = /"data":\{"json":\{"push":"([\w:./-]+)"/;

/** One message the port sent its window past the length above, with what could be read of what it carries. */
export interface LargeActPortMessage {
  /** The procedure whose call it answers or streams for, as the window called it. */
  readonly procedure: string | undefined;
  /** The push it carries, where it is one. */
  readonly push: string | undefined;
  /** Its length: a text message's characters, or a binary one's bytes. */
  readonly length: number;
}

/** A message's length and the head it is read by, text or binary alike. */
function measured(data: unknown): { readonly length: number; readonly head: string } | undefined {
  if (typeof data === "string") return { length: data.length, head: data.slice(0, HEAD_LENGTH) };
  if (!(data instanceof Uint8Array)) return undefined;
  const head = new TextDecoder().decode(data.subarray(0, HEAD_LENGTH));
  return { length: data.byteLength, head };
}

/** Remembers the procedure of the call `data` opens, where it is a request, forgetting the oldest call past the bound. */
function rememberCall(procedures: Map<string, string>, data: unknown): void {
  const request = typeof data === "string" ? REQUEST_HEAD.exec(data) : null;
  if (request === null) return;
  const [, id = "", procedure = ""] = request;
  procedures.delete(id);
  procedures.set(id, procedure);
  const oldest = procedures.keys().next();
  if (procedures.size > REMEMBERED_CALLS && !oldest.done) procedures.delete(oldest.value);
}

/**
 * What `data` carries where it is past the length above, none where it is
 * shorter; either way a plain answer forgets its call, while a stream's
 * first answer only opens it, so its call is remembered for its events.
 */
function largeMessage(
  procedures: Map<string, string>,
  data: unknown,
): LargeActPortMessage | undefined {
  const message = measured(data);
  if (message === undefined) return undefined;
  const id = MESSAGE_ID.exec(message.head)?.[1];
  const procedure = id === undefined ? undefined : procedures.get(id);
  const answer = MESSAGE_KIND.exec(message.head)?.[1] === "response";
  if (id !== undefined && answer && !STREAM_ANSWER.test(message.head)) procedures.delete(id);
  if (message.length < LARGE_ACT_PORT_MESSAGE_LENGTH) return undefined;
  return { procedure, push: PUSH_NAME.exec(message.head)?.[1], length: message.length };
}

/**
 * The port oRPC's handler is upgraded with in `port`'s place: every request
 * the window sends has its procedure remembered by its call, and every
 * message sent back past the length above is handed to `note` as it leaves.
 */
export function noteLargeActPortMessages(
  port: MessagePortMainLike,
  note: (message: LargeActPortMessage) => void,
): MessagePortMainLike {
  const procedures = new Map<string, string>();
  return {
    on: (event, callback) => {
      if (event !== "message") return port.on(event, callback);
      port.on(event, (message) => {
        rememberCall(procedures, message?.data);
        callback(message);
      });
    },
    postMessage: (data, transfer) => {
      const large = largeMessage(procedures, data);
      if (large !== undefined) note(large);
      if (transfer === undefined) port.postMessage(data);
      else port.postMessage(data, transfer);
    },
  };
}
