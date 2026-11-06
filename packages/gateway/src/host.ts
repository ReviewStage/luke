import type { WireRecord, WireValue } from "@repo/wire";
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

export type GatewayCallResult =
  | { ok: true; result: WireValue | undefined }
  | { ok: false; error: GatewayError };

export type GatewayEventListener = (payload: WireValue) => void;

export interface GatewayClient {
  call(method: GatewayMethod, params?: WireRecord): Effect.Effect<GatewayCallResult>;
  on(kind: GatewayEventKind, listener: GatewayEventListener): () => void;
}

export interface GatewayHost extends GatewayClient {
  emit(kind: GatewayEventKind, payload: WireValue): void;
}

export interface GatewayHostOptions {
  methods: GatewayMethodTable;
  client: GatewayClientIdentity;
}

function refused(refusal: GatewayRefusal): GatewayCallResult {
  return { ok: false, error: { code: refusal.code, message: refusal.message } };
}

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
          Effect.withErrorReporting({ defectsOnly: true }),
          Effect.map((result): GatewayCallResult => ({ ok: true, result })),
          Effect.catch((refusal) => Effect.succeed(refused(refusal))),
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
