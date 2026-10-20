/**
 * stream.ts -- what the probe reads off the SDK's message stream: the session's start, the account it bills, the tools it called, its words, and the leak check's report.
 *
 * Each reader decodes only the fields it needs, dropping the rest, so a
 * newer CLI that adds fields reads the same; a message of another shape is
 * skipped, never a failure, because the verdict is what decides whether
 * something the probe needed was missing.
 */

import {
  EXCESS_KEYS,
  isWireString,
  type UnparsedWireValue,
  valueFromJsonText,
  type WireValue,
  WireValueSchema,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Result, Schema } from "effect";
import { DRIVER_EVENT, LEAK_CHECK_MARKER } from "./pins.js";

/** The session's start, as the CLI reports it once per launch. */
const InitSchema = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("init"),
  session_id: Schema.String,
  apiKeySource: Schema.String,
  claude_code_version: Schema.String,
  tools: Schema.Array(Schema.String),
});
export type SessionInit = typeof InitSchema.Type;

/** The account the CLI is signed in as, which the driver asks for after the start; only the fields that say who pays. */
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

/** What a leak check found, as its script prints it: counts and flags, never a value it read. */
const LeakReportSchema = Schema.Struct({
  user: Schema.String,
  sudo: Schema.Boolean,
  env_token: Schema.Boolean,
  proc_environ_with_token: Schema.Number,
  files_with_token_shape: Schema.Number,
  agent_home_listable: Schema.Boolean,
  cap_eff: Schema.String,
  shadow_readable: Schema.Boolean,
  anthropic_http: Schema.String,
});
export type LeakReport = typeof LeakReportSchema.Type;

/** A tool the agent called, by name, with the command a Bash call ran and whether it ran it in the background. */
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
/** A decode of one message or block: the value, or why it is another shape. */
type Reader<Value> = (value: UnparsedWireValue) => Result.Result<Value, Error>;

/** Every value a reader answered, in order, skipping the messages or blocks of another shape. */
function each<Value>(values: readonly WireValue[], read: Reader<Value>): readonly Value[] {
  return values.flatMap((value) => {
    const decoded = read(value);
    return Result.isSuccess(decoded) ? [decoded.success] : [];
  });
}

/** The session's start, the first one the launch reported. */
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

/** Everything the agent said, in order, as one text. */
export function assistantText(messages: readonly WireValue[]): string {
  return each(messages, readAssistant)
    .flatMap((assistant) => each(assistant.message.content, readText).map((block) => block.text))
    .join("\n");
}

export function turnResults(messages: readonly WireValue[]): readonly TurnResult[] {
  return each(messages, readResult);
}

/** The text of every tool result the CLI handed back to the model, in order. */
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

/** The leak check's report in a command's output, the line after its marker; none where it printed none. */
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
