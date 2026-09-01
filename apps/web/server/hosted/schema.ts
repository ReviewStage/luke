import type { AttentionPromptUpdate } from "@sidecar/attention";
import type { RealtimeVoice, RealtimeVoiceSpeed } from "@sidecar/realtime";
import { ParseResult, Schema } from "effect";
import {
  attentionPromptUpdateFromWire,
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  isRecord,
  isVaultProviderId,
  isWireString,
  type ProductEventBatch,
  productEventBatchFromWire,
  text,
  type UnparsedWireValue,
  VAULT_PROVIDER_ID,
  vaultKeyIsStorable,
} from "../core.js";

/** Delegates to the catalog reader until analytics owns the schema branch. */
export const ProductEventBatchSchema: Schema.Schema<ProductEventBatch> = Schema.transformOrFail(
  Schema.Unknown,
  Schema.Unknown,
  {
    strict: true,
    decode: (input, _, ast) => {
      const parsed = productEventBatchFromWire(input as UnparsedWireValue);
      return parsed
        ? ParseResult.succeed(parsed)
        : ParseResult.fail(new ParseResult.Type(ast, input, "invalid product event batch"));
    },
    encode: (batch) => ParseResult.succeed(batch),
  },
) as Schema.Schema<ProductEventBatch>;

/** Delegates to the attention wire reader until attention owns the schema branch. */
export const AttentionPromptUpdateSchema = Schema.transformOrFail(Schema.Unknown, Schema.Unknown, {
  strict: true,
  decode: (input, _, ast) => {
    const parsed = attentionPromptUpdateFromWire(input as UnparsedWireValue);
    return parsed
      ? ParseResult.succeed(parsed)
      : ParseResult.fail(new ParseResult.Type(ast, input, "invalid attention update"));
  },
  encode: (update) => ParseResult.succeed(update),
}) as Schema.Schema<AttentionPromptUpdate>;

export interface VoiceMintPreferences {
  voice?: RealtimeVoice;
  speed?: RealtimeVoiceSpeed;
}

const vaultProviderIdLiterals = Object.values(VAULT_PROVIDER_ID).map((value) =>
  Schema.Literal(value),
);

export const VaultProviderIdSchema = Schema.Union(...vaultProviderIdLiterals);

export const VaultKeyStoreBodySchema = Schema.Struct({
  providerId: VaultProviderIdSchema,
  key: Schema.String.pipe(
    Schema.filter((key) => vaultKeyIsStorable(key), { message: () => "invalid vault key" }),
  ),
});

export const VaultKeyDeleteBodySchema = Schema.Struct({
  providerId: VaultProviderIdSchema,
});

function recordKeys(value: Record<string, unknown>): readonly string[] {
  return Object.keys(value);
}

/** Voice and pace only; optional strict allowlist rejects extras on introduction mint. */
export function voiceMintPreferencesSchema(
  strictFields?: readonly string[],
): Schema.Schema<VoiceMintPreferences> {
  return Schema.transformOrFail(Schema.Unknown, Schema.Unknown, {
    strict: true,
    decode: (input, _, ast) => {
      if (input === null || input === undefined) {
        return ParseResult.succeed({});
      }
      if (!isRecord(input as UnparsedWireValue)) {
        return ParseResult.fail(new ParseResult.Type(ast, input, "expected record"));
      }
      const wire = input as Record<string, UnparsedWireValue>;
      if (strictFields && recordKeys(wire).some((key) => !strictFields.includes(key))) {
        return ParseResult.fail(new ParseResult.Type(ast, input, "unexpected field"));
      }
      if (wire.voice !== undefined && !isRealtimeVoice(wire.voice)) {
        return ParseResult.fail(new ParseResult.Type(ast, input, "invalid voice"));
      }
      if (wire.speed !== undefined && !isRealtimeVoiceSpeed(wire.speed)) {
        return ParseResult.fail(new ParseResult.Type(ast, input, "invalid speed"));
      }
      const preferences: VoiceMintPreferences = {};
      if (wire.voice !== undefined) preferences.voice = wire.voice as VoiceMintPreferences["voice"];
      if (wire.speed !== undefined) preferences.speed = wire.speed as VoiceMintPreferences["speed"];
      return ParseResult.succeed(preferences);
    },
    encode: (preferences) => ParseResult.succeed(preferences),
  }) as Schema.Schema<VoiceMintPreferences>;
}

export function decodeUnknown<A, I>(schema: Schema.Schema<A, I>, value: unknown): A | undefined {
  const decoded = Schema.decodeUnknownEither(schema)(value);
  return decoded._tag === "Right" ? decoded.right : undefined;
}

/** Parses provider id from an untrusted record field. */
export function parseVaultProviderId(value: UnparsedWireValue): string | undefined {
  const providerId = text(value);
  return isVaultProviderId(providerId) ? providerId : undefined;
}

export function parseProviderKey(value: UnparsedWireValue): string | undefined {
  if (!isWireString(value) || !vaultKeyIsStorable(value)) return undefined;
  return value;
}
