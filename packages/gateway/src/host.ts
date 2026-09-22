/**
 * host.ts -- the Gateway as one process reaches it: a method table dispatched
 * directly, and a listener set the host's events are handed to.
 *
 * The client and the host are the same process and the same build, so a call
 * is the handler's own effect and an event is a synchronous fan-out on the
 * tick it is emitted. Nothing is serialized, numbered, replayed, or retried:
 * a refusal is the typed failure the handler failed with, read back as its
 * code and message, and a handler that throws refuses that one call as
 * internal and nothing else.
 */
import type { WireRecord, WireValue } from "@sidecar/wire";
import { Effect } from "effect";
import type { GatewayMethodTable } from "./methods.js";
import {
  type GatewayClientIdentity,
  type GatewayError,
  type GatewayEventKind,
  type GatewayMethod,
  type GatewayRefusal,
  InternalRefusal,
  UnknownMethodRefusal,
} from "./protocol.js";

/** A call's answer as the client reads it: the result, or the typed error. */
export type GatewayCallResult =
  | { ok: true; result: WireValue | undefined }
  | { ok: false; error: GatewayError };

export type GatewayEventListener = (payload: WireValue) => void;

/** What a client holds to reach the host: every method, and every event of one kind. */
export interface GatewayClient {
  call(method: GatewayMethod, params?: WireRecord): Effect.Effect<GatewayCallResult>;
  /** Hears every event of one kind, on the tick the host emits it, until the returned function is called. */
  on(kind: GatewayEventKind, listener: GatewayEventListener): () => void;
}

/** The host's side of the same object: the client's two verbs, and the one door the host's changes become events through. */
export interface GatewayHost extends GatewayClient {
  emit(kind: GatewayEventKind, payload: WireValue): void;
}

export interface GatewayHostOptions {
  methods: GatewayMethodTable;
  /** The one client this host answers; every handler is handed this identity. */
  client: GatewayClientIdentity;
}

function refused(refusal: GatewayRefusal): GatewayCallResult {
  return { ok: false, error: { code: refusal.code, message: refusal.message } };
}

/** The whole Gateway for one process: the table, dispatched, and the listeners, told. */
export function gatewayHost(options: GatewayHostOptions): GatewayHost {
  const listeners = new Map<GatewayEventKind, Set<GatewayEventListener>>();
  const context = { client: options.client };
  return {
    call: (method, params = {}) =>
      Effect.suspend(() => {
        const handler = options.methods[method];
        if (!handler) {
          return Effect.succeed(
            refused(new UnknownMethodRefusal({ message: `no handler stands for ${method}` })),
          );
        }
        return Effect.suspend(() => handler(params, context)).pipe(
          Effect.map((result): GatewayCallResult => ({ ok: true, result })),
          Effect.catch((refusal) => Effect.succeed(refused(refusal))),
          // A handler that throws rather than failing refuses that one call and no other.
          Effect.catchDefect((defect) =>
            Effect.succeed(
              refused(
                new InternalRefusal({
                  message: defect instanceof Error ? defect.message : String(defect),
                }),
              ),
            ),
          ),
        );
      }),
    on: (kind, listener) => {
      const held = listeners.get(kind) ?? new Set<GatewayEventListener>();
      held.add(listener);
      listeners.set(kind, held);
      return () => {
        held.delete(listener);
      };
    },
    emit: (kind, payload) => {
      for (const listener of [...(listeners.get(kind) ?? [])]) listener(payload);
    },
  };
}
