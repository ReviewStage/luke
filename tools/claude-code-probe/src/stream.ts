import {
  EXCESS_KEYS,
  isWireString,
  type UnparsedWireValue,
  valueFromJsonText,
  type WireValue,
  WireValueSchema,
} from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Result, Schema } from "effect";
import { DRIVER_EVENT, LEAK_CHECK_MARKER } from "./pins.js";

const InitSchema = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("init"),
  session_id: Schema.String,
  apiKeySource: Schema.String,
  claude_code_version: Schema.String,
  tools: Schema.Array(Schema.String),
});
export type SessionInit = typeof InitSchema.Type;

const AccountSchema = Schema.Struct({
  type: Schema.Literal(DRIVER_EVENT.ACCOUNT),
  subscriptionType: Schema.optional(Schema.String),
  tokenSource: Schema.optional(Schema.String),
  apiKeySource: Schema.optional(Schema.String),
  apiProvider: Schema.optional(Schema.String),
});
export type AccountReading = typeof AccountSchema.Type;

const ToolUseSchema = Schema.Struct({
  type: Schema.Literal("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Struct({
    run_in_background: Schema.optional(Schema.Boolean),
    command: Schema.optional(Schema.String),
  }),
});
const TextBlockSchema = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });

const AssistantSchema = Schema.Struct({
  type: Schema.Literal("assistant"),
  message: Schema.Struct({ content: Schema.Array(WireValueSchema) }),
});

const ToolResultSchema = Schema.Struct({
  type: Schema.Literal("tool_result"),
  content: Schema.Union([Schema.String, Schema.Array(WireValueSchema)]),
});

const UserSchema = Schema.Struct({
  type: Schema.Literal("user"),
  message: Schema.Struct({
    content: Schema.Union([Schema.String, Schema.Array(WireValueSchema)]),
  }),
});

const ResultSchema = Schema.Struct({
  type: Schema.Literal("result"),
  subtype: Schema.String,
  is_error: Schema.Boolean,
  session_id: Schema.String,
});
export type TurnResult = typeof ResultSchema.Type;

const LeakReportSchema = Schema.Struct({
  user: Schema.String,
  sudo: Schema.Boolean,
  env_token: Schema.Boolean,
  env_token_shaped: Schema.Boolean,
  proc_environ_with_token: Schema.Number,
  proc_environ_token_shaped: Schema.Number,
  files_with_token_shape: Schema.Number,
  agent_home_listable: Schema.Boolean,
  cap_eff: Schema.String,
  shadow_readable: Schema.Boolean,
  anthropic_http: Schema.String,
});
export type LeakReport = typeof LeakReportSchema.Type;

export interface ToolCall {
  readonly name: string;
  readonly command: string;
  readonly background: boolean;
}

const lenient = { excess: EXCESS_KEYS.DROP } as const;
const readInit = readEither(InitSchema, lenient);
const readAccount = readEither(AccountSchema, lenient);
const readAssistant = readEither(AssistantSchema, lenient);
const readToolUse = readEither(ToolUseSchema, lenient);
const readText = readEither(TextBlockSchema, lenient);
const readUser = readEither(UserSchema, lenient);
const readToolResult = readEither(ToolResultSchema, lenient);
const readResult = readEither(ResultSchema, lenient);
const readLeakReport = readEither(LeakReportSchema, lenient);
type Reader<Value> = (value: UnparsedWireValue) => Result.Result<Value, Error>;

function each<Value>(values: readonly WireValue[], read: Reader<Value>): readonly Value[] {
  return values.flatMap((value) => {
    const decoded = read(value);
    return Result.isSuccess(decoded) ? [decoded.success] : [];
  });
}

export function sessionInit(messages: readonly WireValue[]): SessionInit | undefined {
  return each(messages, readInit)[0];
}

export function accountReading(messages: readonly WireValue[]): AccountReading | undefined {
  return each(messages, readAccount)[0];
}

export function toolCalls(messages: readonly WireValue[]): readonly ToolCall[] {
  return each(messages, readAssistant).flatMap((assistant) =>
    each(assistant.message.content, readToolUse).map((use) => ({
      name: use.name,
      command: use.input.command ?? "",
      background: use.input.run_in_background === true,
    })),
  );
}

export function assistantText(messages: readonly WireValue[]): string {
  return each(messages, readAssistant)
    .flatMap((assistant) => each(assistant.message.content, readText).map((block) => block.text))
    .join("\n");
}

export function turnResults(messages: readonly WireValue[]): readonly TurnResult[] {
  return each(messages, readResult);
}

export function toolResultTexts(messages: readonly WireValue[]): readonly string[] {
  return each(messages, readUser).flatMap((user) => {
    const content = user.message.content;
    if (isWireString(content)) return [];
    return each(content, readToolResult).map((result) =>
      isWireString(result.content)
        ? result.content
        : each(result.content, readText)
            .map((block) => block.text)
            .join("\n"),
    );
  });
}

export function leakReportIn(output: string): LeakReport | undefined {
  for (const line of output.split("\n")) {
    const at = line.indexOf(LEAK_CHECK_MARKER);
    if (at === -1) continue;
    const json = line.slice(at + LEAK_CHECK_MARKER.length).trim();
    const report = readLeakReport(valueFromJsonText(json));
    if (Result.isSuccess(report)) return report.success;
  }
  return undefined;
}
