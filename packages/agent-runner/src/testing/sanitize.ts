import { isRecord, isWireString, type WireRecord, type WireValue } from "@repo/wire";

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

export interface KnownSecret {
  readonly kind: SecretKind;
  readonly value: string;
}

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

const HOME_OWNER = /\/(Users|home)\/(?!agent\b)([\w.-]+)/gu;

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

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export class Sanitizer {
  private readonly secrets: readonly KnownSecret[];
  private readonly ids = new Map<string, string>();

  constructor(secrets: readonly KnownSecret[]) {
    this.secrets = secrets
      .filter((secret) => secret.value.length >= 4)
      .toSorted((a, b) => b.value.length - a.value.length);
  }

  private placeholderOf(id: string): string {
    const key = id.toLowerCase();
    const known = this.ids.get(key);
    if (known !== undefined) return known;
    const placeholder = `00000000-0000-4000-8000-${String(this.ids.size + 1).padStart(12, "0")}`;
    this.ids.set(key, placeholder);
    return placeholder;
  }

  text(value: string): string {
    let out = value;
    for (const secret of this.secrets) {
      out = out.replace(new RegExp(escapeRegExp(secret.value), "gu"), `<redacted:${secret.kind}>`);
    }
    for (const shape of SECRET_SHAPES) out = out.replace(shape.pattern, shape.replacement);
    out = out.replace(HOME_OWNER, "/$1/<user>");
    return out.replace(UUID, (id) => this.placeholderOf(id));
  }

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
