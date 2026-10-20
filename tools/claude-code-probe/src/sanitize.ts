/**
 * sanitize.ts -- the SDK's messages made safe to commit as fixtures: no token, no account, no email, and stable ids.
 *
 * A fixture outlives the run that recorded it and is read by every later PR
 * (P05's runner tests, P09's projection), so what it keeps is the shape of
 * the stream, never who ran it. The secrets the run held are removed by
 * value wherever they appear; anything shaped like a provider credential or
 * an email is removed by shape, in case the stream carries one the run did
 * not hold; account and organization fields are removed by name; and every
 * UUID is replaced by a placeholder numbered in the order it first appears,
 * so a session id that recurs across a resume still recurs, and the fixture
 * is the same bytes for the same stream.
 */

import { isRecord, isWireString, type WireValue } from "@luke/wire";

export const REDACTED = {
  SECRET: "[redacted-secret]",
  CREDENTIAL: "[redacted-credential]",
  EMAIL: "[redacted-email]",
  ACCOUNT: "[redacted-account]",
} as const;

/** Fields that name an account, an organization, or a person, whatever their value. */
const ACCOUNT_FIELDS: ReadonlySet<string> = new Set([
  "email",
  "organization",
  "organizationName",
  "organization_name",
  "organizationUuid",
  "organization_uuid",
  "organizationId",
  "organization_id",
  "orgId",
  "org_id",
  "accountUuid",
  "account_uuid",
  "accountId",
  "account_id",
  "userId",
  "user_id",
  "displayName",
  "display_name",
]);

/**
 * Credential shapes: Anthropic keys and OAuth tokens, GitHub's tokens, a
 * bearer or basic authorization's value. Note that each is a shape, never a
 * value, so this file holds no credential.
 */
const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /\b(Bearer|Basic) [A-Za-z0-9._~+/=-]{16,}/g,
];

const EMAIL_SHAPE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const UUID_SHAPE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** The placeholder's width: twelve hex digits, the UUID's last group. */
const PLACEHOLDER_DIGITS = 12;

export interface SanitizeOptions {
  /** Values the run held that must not survive anywhere: the tokens. Empty ones are ignored. */
  readonly secrets: readonly string[];
  /** Literal replacements for what names the developer, such as the repository's owner. */
  readonly replacements: readonly (readonly [from: string, to: string])[];
}

/** A sanitizer for one run's messages; its UUID numbering is shared by every value it is handed. */
export type Sanitizer = (value: WireValue) => WireValue;

function placeholderOf(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(PLACEHOLDER_DIGITS, "0")}`;
}

export function sanitizer(options: SanitizeOptions): Sanitizer {
  const secrets = options.secrets.filter((secret) => secret.length > 0);
  const uuids = new Map<string, string>();

  const stableUuid = (uuid: string): string => {
    const key = uuid.toLowerCase();
    const known = uuids.get(key);
    if (known !== undefined) return known;
    const placeholder = placeholderOf(uuids.size + 1);
    uuids.set(key, placeholder);
    return placeholder;
  };

  const text = (value: string): string => {
    let out = value;
    for (const secret of secrets) out = out.replaceAll(secret, REDACTED.SECRET);
    for (const shape of CREDENTIAL_SHAPES) out = out.replace(shape, REDACTED.CREDENTIAL);
    out = out.replace(EMAIL_SHAPE, REDACTED.EMAIL);
    for (const [from, to] of options.replacements) {
      if (from.length > 0) out = out.replaceAll(from, to);
    }
    return out.replace(UUID_SHAPE, stableUuid);
  };

  const walk = (value: WireValue): WireValue => {
    if (isWireString(value)) return text(value);
    if (isRecord(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, field]) => [
          text(key),
          ACCOUNT_FIELDS.has(key) && field !== null ? REDACTED.ACCOUNT : walk(field),
        ]),
      );
    }
    return Array.isArray(value) ? value.map(walk) : value;
  };

  return walk;
}

/** A placeholder `sanitizer` numbered; every other UUID is a real id. */
const PLACEHOLDER_SHAPE = /^00000000-0000-4000-8000-\d{12}$/;

/**
 * What survived in text about to be written as a fixture, by kind and
 * never by value: a secret the run held, a credential or email shape, a
 * real id, or an account field holding anything but its redaction. The
 * probe writes nothing while this names anything, and the committed
 * fixtures are held to it too, so the developer can commit the output as
 * written.
 */
export function fixtureLeaks(text: string, secrets: readonly string[]): readonly string[] {
  const leaks: string[] = [];
  if (secrets.some((secret) => secret.length > 0 && text.includes(secret))) {
    leaks.push("a secret the run held");
  }
  if (CREDENTIAL_SHAPES.some((shape) => new RegExp(shape.source).test(text))) {
    leaks.push("a credential shape");
  }
  if (new RegExp(EMAIL_SHAPE.source).test(text)) leaks.push("an email");
  if ((text.match(UUID_SHAPE) ?? []).some((uuid) => !PLACEHOLDER_SHAPE.test(uuid))) {
    leaks.push("a real id");
  }
  for (const field of ACCOUNT_FIELDS) {
    const unredacted = new RegExp(`"${field}":\\s*"(?!\\[redacted)`);
    if (unredacted.test(text)) leaks.push(`an account field (${field})`);
  }
  return leaks;
}
