import { createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import type { TaskStoreFailure } from "@repo/database/models/task-store";
import type { IntegrationTriggerFilters } from "@repo/features/automation-wire";
import type {
  IntegrationTriggerFilter,
  SentryTriggerEvent,
  TriggerProvider,
} from "@repo/features/trigger-catalog";
import type { UnparsedWireValue } from "@repo/wire";
import { type Effect, type Option, Redacted } from "effect";

export const TRIGGER_VERIFICATION = {
  VALID: "valid",
  INVALID: "invalid",
  UNCONFIGURED: "unconfigured",
} as const;

type TriggerVerification = (typeof TRIGGER_VERIFICATION)[keyof typeof TRIGGER_VERIFICATION];

export interface TriggerRequest {
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export interface TriggerDelivery extends TriggerRequest {
  readonly body: Uint8Array;
  readonly payload: UnparsedWireValue;
}

interface TriggerSubject {
  readonly id: string;
  readonly title?: string;
  readonly url?: string;
}

export type TriggerAttributes = Readonly<
  Partial<Record<IntegrationTriggerFilter, readonly string[]>>
>;

export interface NormalizedEvent {
  readonly event: SentryTriggerEvent;
  readonly dedupeKey: string;
  readonly subject: TriggerSubject;
  readonly attributes: TriggerAttributes;
  readonly summary: string;
}

export interface TriggerSource<R> {
  readonly provider: TriggerProvider;
  readonly path: `/api/${string}`;
  readonly verify: (
    request: TriggerRequest,
    body: Uint8Array,
  ) => Effect.Effect<TriggerVerification, never, R>;
  readonly lifecycle?: (
    delivery: TriggerDelivery,
  ) => Effect.Effect<boolean, TaskStoreFailure, DatabaseServices>;
  readonly workspaceOf: (
    delivery: TriggerDelivery,
  ) => Effect.Effect<Option.Option<string>, TaskStoreFailure, DatabaseServices>;
  readonly normalize: (delivery: TriggerDelivery) => readonly NormalizedEvent[];
}

export interface HmacSignature {
  readonly header: string;
  readonly encoding: "hex" | "base64";
  readonly prefix?: string;
}

const ENCODED_DIGEST = {
  hex: /^[0-9a-f]+$/iu,
  base64: /^[A-Za-z0-9+/]+={0,2}$/u,
} as const;

export function hmacVerifier(signature: HmacSignature) {
  const prefix = signature.prefix ?? "";
  return (request: TriggerRequest, body: Uint8Array, secret: Redacted.Redacted): boolean => {
    const header = request.headers[signature.header.toLowerCase()]?.trim();
    if (header === undefined || !header.startsWith(prefix)) return false;
    const encoded = header.slice(prefix.length);
    if (!ENCODED_DIGEST[signature.encoding].test(encoded)) return false;
    const key = Redacted.value(secret);
    if (key.length === 0) return false;
    const offered = Buffer.from(encoded, signature.encoding);
    const wanted = createHmac("sha256", key).update(body).digest();
    return offered.length === wanted.length && timingSafeEqual(offered, wanted);
  };
}

function valuesOf(values: readonly string[] | undefined): readonly string[] {
  return (values ?? []).map((each) => each.toLowerCase());
}

export function integrationFiltersMatch(
  filters: IntegrationTriggerFilters | undefined,
  attributes: TriggerAttributes,
): boolean {
  if (filters === undefined) return true;
  return Object.entries(filters).every(([field, named]) => {
    const wanted = valuesOf(named);
    if (wanted.length === 0) return true;
    const carried = valuesOf(attributes[field as IntegrationTriggerFilter]);
    return carried.some((value) => wanted.includes(value));
  });
}
