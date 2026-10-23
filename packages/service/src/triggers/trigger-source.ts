import { createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import type { TaskStoreFailure } from "@luke/database/models/task-store";
import type { IntegrationTriggerFilters } from "@luke/features/automation-wire";
import type {
  IntegrationTriggerFilter,
  SentryTriggerEvent,
  TriggerProvider,
} from "@luke/features/trigger-catalog";
import type { UnparsedWireValue } from "@luke/wire";
import { type Effect, type Option, Redacted } from "effect";

/**
 * trigger-source.ts -- what one integration's deliveries are to the trigger ingress: how a delivery is verified, which workspace it is for, and the events it is read as.
 *
 * A provider whose events may fire an automation (`trigger-catalog.ts`) is a
 * trigger source: a module that confirms a delivery came from the provider
 * before anything of it is read, handles the deliveries about its own
 * installation (an uninstall), names the workspace the installation stands
 * for, and reads the delivery as the catalog's events, each with the
 * subject it is about, the fields its trigger's filters read, and a short
 * summary the run hands its agent. A delivery it does not know is read as
 * no event, so a provider adding a resource fires nothing until a source
 * reads it. The ingress (`trigger-ingress-app.ts`) is the same for every
 * source; a provider added later is a source here and a row in the catalog.
 */

/** What a source's verification of a delivery came to. */
export const TRIGGER_VERIFICATION = {
  /** The delivery is the provider's own, signed under the secret this deployment holds. */
  VALID: "valid",
  /** The signature is missing, malformed, or does not hold. */
  INVALID: "invalid",
  /** This deployment holds no secret for the provider, so nothing it is sent can be trusted. */
  UNCONFIGURED: "unconfigured",
} as const;

type TriggerVerification = (typeof TRIGGER_VERIFICATION)[keyof typeof TRIGGER_VERIFICATION];

/** A delivery's request as a source reads it: its headers, every name lower case. */
export interface TriggerRequest {
  readonly headers: Readonly<Record<string, string | undefined>>;
}

/** A verified delivery: its headers, its bytes as they came, and its body read as JSON. */
export interface TriggerDelivery extends TriggerRequest {
  readonly body: Uint8Array;
  readonly payload: UnparsedWireValue;
}

/** What an event is about, by the provider's own id, which the trigger's cooldown keys on. */
interface TriggerSubject {
  readonly id: string;
  readonly title?: string;
  readonly url?: string;
}

/** The values of one event a trigger's filters read, by filter field; a field the event does not carry is absent. */
export type TriggerAttributes = Readonly<
  Partial<Record<IntegrationTriggerFilter, readonly string[]>>
>;

/** One delivery read as one of the catalog's events. */
export interface NormalizedEvent {
  readonly event: SentryTriggerEvent;
  /** The key the run is recorded under, the same on the provider's redelivery. */
  readonly dedupeKey: string;
  readonly subject: TriggerSubject;
  readonly attributes: TriggerAttributes;
  /** What the run's agent is told of the event, as text the provider's users chose: bounded, and fenced as data where it is handed on. */
  readonly summary: string;
}

/** One integration's deliveries as the ingress reads them. */
export interface TriggerSource<R> {
  readonly provider: TriggerProvider;
  /** The path the provider delivers to under the deployment's origin. */
  readonly path: `/api/${string}`;
  /** Whether the delivery is the provider's own, over the body's own bytes; read before anything of it is. */
  readonly verify: (
    request: TriggerRequest,
    body: Uint8Array,
  ) => Effect.Effect<TriggerVerification, never, R>;
  /** A delivery about the source's own installation, handled here; true where it was one, so it is read as no event. */
  readonly lifecycle?: (
    delivery: TriggerDelivery,
  ) => Effect.Effect<boolean, TaskStoreFailure, DatabaseServices>;
  /** The workspace whose installation the delivery came through; nothing for one unknown or uninstalled. */
  readonly workspaceOf: (
    delivery: TriggerDelivery,
  ) => Effect.Effect<Option.Option<string>, TaskStoreFailure, DatabaseServices>;
  /** The catalog's events the delivery is; none for a delivery the source does not read. */
  readonly normalize: (delivery: TriggerDelivery) => readonly NormalizedEvent[];
}

/** How an HMAC signature header is spelled: its name, its encoding, and what it leads with before the digest. */
export interface HmacSignature {
  readonly header: string;
  readonly encoding: "hex" | "base64";
  readonly prefix?: string;
}

const ENCODED_DIGEST = {
  hex: /^[0-9a-f]+$/iu,
  base64: /^[A-Za-z0-9+/]+={0,2}$/u,
} as const;

/**
 * A verifier of an HMAC-SHA256 signature over the body's own bytes, under
 * the secret given, compared in constant time. It fails closed: a missing
 * or malformed header, a digest of the wrong length, and a blank secret are
 * each refused rather than read leniently.
 */
export function hmacVerifier(signature: HmacSignature) {
  const prefix = signature.prefix ?? "";
  return (request: TriggerRequest, body: Uint8Array, secret: Redacted.Redacted): boolean => {
    const header = request.headers[signature.header.toLowerCase()]?.trim();
    if (header === undefined || !header.startsWith(prefix)) return false;
    const encoded = header.slice(prefix.length);
    if (!ENCODED_DIGEST[signature.encoding].test(encoded)) return false;
    // The secret is revealed here alone, into the HMAC the compare reads.
    const key = Redacted.value(secret);
    if (key.length === 0) return false;
    const offered = Buffer.from(encoded, signature.encoding);
    const wanted = createHmac("sha256", key).update(body).digest();
    return offered.length === wanted.length && timingSafeEqual(offered, wanted);
  };
}

/** One side of a filter, lower case. */
function valuesOf(values: readonly string[] | undefined): readonly string[] {
  return (values ?? []).map((each) => each.toLowerCase());
}

/**
 * Whether an event's attributes pass a trigger's filters: within a field any
 * value named matches, across fields every field named must, case aside,
 * and an empty or absent field keeps nothing out. An event that does not
 * carry a field a filter names does not pass it.
 */
export function integrationFiltersMatch(
  filters: IntegrationTriggerFilters | undefined,
  attributes: TriggerAttributes,
): boolean {
  if (filters === undefined) return true;
  return Object.entries(filters).every(([field, named]) => {
    const wanted = valuesOf(named);
    if (wanted.length === 0) return true;
    // SAFETY: the filters' keys are the catalog's filter fields, which the schema holds them to.
    const carried = valuesOf(attributes[field as IntegrationTriggerFilter]);
    return carried.some((value) => wanted.includes(value));
  });
}
