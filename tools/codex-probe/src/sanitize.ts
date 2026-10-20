/**
 * sanitize.ts -- the app-server's messages made safe to commit as fixtures: no token, no account id, no email, and every id renamed consistently so P20 and P22 can still follow a thread through them.
 *
 * Three passes over every string, in order: the secrets this run knows by
 * value (the access, refresh and ID tokens, the issued client id, the host
 * id, the account's subject) are replaced wherever they appear; then
 * anything shaped like a credential or an address (a JWT, an API key, an
 * issued client id, an email, a home directory's owner) is; then each UUID
 * is renamed to a stable placeholder of the same shape, the same id always
 * becoming the same placeholder across the whole recording. Fields whose
 * name says they identify an account are blanked whatever they hold. The
 * guard at the end refuses a recording in which anything secret-shaped
 * survived, so a new field the passes do not know cannot leak by accident.
 */

import { isRecord, isWireString, type WireRecord, type WireValue } from "@luke/wire";

/** What a known secret is, which names its placeholder. */
export const SECRET_KIND = {
  ACCESS_TOKEN: "access-token",
  REFRESH_TOKEN: "refresh-token",
  ID_TOKEN: "id-token",
  CLIENT_ID: "issued-client-id",
  HOST_ID: "ext-agent-host-id",
  SUBJECT: "account-subject",
  GITHUB_TOKEN: "github-token",
} as const;

type SecretKind = (typeof SECRET_KIND)[keyof typeof SECRET_KIND];

/** A value this run knows to be secret, by what it is. */
export interface KnownSecret {
  readonly kind: SecretKind;
  readonly value: string;
}

/** Shapes that are secret whatever run they come from, with what replaces each. */
const SECRET_SHAPES: readonly {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}[] = [
  { name: "jwt", pattern: /eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/gu, replacement: "<redacted:jwt>" },
  { name: "api-key", pattern: /\bsk-[\w-]{16,}/gu, replacement: "<redacted:api-key>" },
  {
    name: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/gu,
    replacement: "<redacted:github-token>",
  },
  {
    name: "issued-client-id",
    pattern: /\boaiapp_[\w-]+/gu,
    replacement: "<redacted:issued-client-id>",
  },
  { name: "email", pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, replacement: "user@example.com" },
  { name: "sha256", pattern: /\b[0-9a-f]{64}\b/gu, replacement: "<sha256>" },
];

/** A home directory names its owner; the owner is replaced, the path kept. */
const HOME_OWNER = /\/(Users|home)\/(?!agent\b)([\w.-]+)/gu;

/** Field names that identify an account or carry a credential, whatever their value looks like. */
const IDENTIFYING_KEYS: ReadonlySet<string> = new Set([
  "email",
  "accountid",
  "account_id",
  "userid",
  "user_id",
  "sub",
  "subject",
  "authorization",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "idtoken",
  "id_token",
  "chatgptaccountid",
  "chatgpt_account_id",
]);

/** A UUID of any version, as Codex's ids (UUIDv7) and installation ids are written. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

/** Escapes a value for use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** One sanitizer for one recording, so an id renamed in one message is renamed the same in every other. */
export class Sanitizer {
  private readonly secrets: readonly KnownSecret[];
  private readonly ids = new Map<string, string>();

  constructor(secrets: readonly KnownSecret[]) {
    // Note that we replace longer secrets first, because one may contain another.
    this.secrets = secrets
      .filter((secret) => secret.value.length >= 4)
      .toSorted((a, b) => b.value.length - a.value.length);
  }

  /** A UUID's stable stand-in: the nth distinct id seen, in UUID shape. */
  private placeholderOf(id: string): string {
    const key = id.toLowerCase();
    const known = this.ids.get(key);
    if (known !== undefined) return known;
    const placeholder = `00000000-0000-4000-8000-${String(this.ids.size + 1).padStart(12, "0")}`;
    this.ids.set(key, placeholder);
    return placeholder;
  }

  /** A string with every known secret, secret shape, home owner and id replaced. */
  text(value: string): string {
    let out = value;
    for (const secret of this.secrets) {
      out = out.replace(new RegExp(escapeRegExp(secret.value), "gu"), `<redacted:${secret.kind}>`);
    }
    for (const shape of SECRET_SHAPES) out = out.replace(shape.pattern, shape.replacement);
    out = out.replace(HOME_OWNER, "/$1/<user>");
    return out.replace(UUID, (id) => this.placeholderOf(id));
  }

  /** A JSON value with every string sanitized and every identifying field blanked. */
  value(value: WireValue): WireValue {
    if (isWireString(value)) return this.text(value);
    if (Array.isArray(value)) return value.map((one) => this.value(one));
    if (!isRecord(value)) return value;
    const out: { [key: string]: WireValue } = {};
    for (const [key, field] of Object.entries(value)) {
      const blank = IDENTIFYING_KEYS.has(key.toLowerCase()) && field !== null;
      out[this.text(key)] = blank ? "<redacted>" : this.value(field);
    }
    return out satisfies WireRecord;
  }
}

/**
 * What in a text still looks secret: a known secret by value, or any secret
 * shape. Empty is the one answer under which a recording may be written.
 */
export function findLeaks(text: string, secrets: readonly KnownSecret[]): readonly string[] {
  const known = secrets
    .filter((secret) => secret.value.length >= 4 && text.includes(secret.value))
    .map((secret) => secret.kind);
  const shaped = SECRET_SHAPES.filter(
    (shape) =>
      shape.name !== "sha256" &&
      text.replaceAll("user@example.com", "").match(shape.pattern) !== null,
  ).map((shape) => shape.name);
  return [...known, ...shaped];
}
