/**
 * The iOS and watchOS apps are Swift clients of contracts that live in
 * `packages/`, and every vocabulary they take part in is transcribed by hand.
 * This suite is the only thing that checks the transcription: each case lifts a
 * Swift declaration's values out of the source and diffs them against the
 * TypeScript set the declaration's own comment names, so a value added in a
 * package and forgotten in Swift fails `./scripts/check.sh` rather than
 * reaching a device as a refusal the phone cannot name.
 *
 * Some sets are deliberately narrower in Swift — the phone counts a subset of
 * the desktop's events, and offers a subset of its settings — so those rows
 * assert a subset. Everything the phone claims to mirror whole is compared as a
 * set, in both directions.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTION_FAMILY,
  ACTION_OUTPUT_STATUS,
  ACTION_TOOL,
  ACTIONS,
  REALTIME_VOICE,
  REALTIME_VOICE_SPEED,
  remoteRealtimeToolDefinitions,
} from "@sidecar/actions";
import {
  PRODUCT_ACCOUNT_ACTION,
  PRODUCT_EVENT,
  PRODUCT_EVENT_BATCH_LIMIT,
  PRODUCT_EVENT_CLIENT,
  PRODUCT_EVENT_CLIENT_HEADER,
  PRODUCT_RATED_MESSAGE_KIND,
  PRODUCT_SESSION_ACTION,
  PRODUCT_SETTING_VALUE,
} from "@sidecar/analytics";
import { APP_SETTING_ID } from "@sidecar/guide";
import {
  conversationMessageRatingPath,
  DEVICE_PLATFORM,
  DEVICE_TOKEN_BOUNDS,
  HOSTED_API_ERROR,
  HOSTED_SERVICE_PATH,
  PUSH_ENVIRONMENT,
  READ_PAGE_BOUNDS,
  VAULT_KEY_MAX_LENGTH,
} from "@sidecar/hosted";
import {
  CLOUD_AGENT_PROVIDER_ID,
  CONVERSATION_MESSAGE_AUTHOR,
  CONVERSATION_VIEW_ACTION_OUTCOME,
  CONVERSATION_VIEW_SOURCE,
  CONVERSATION_VIEW_TOOL_KIND,
  PROVIDER_ID,
  SESSION_CONTROL_KIND,
  TOOL_PART_STATE,
  WORKSPACE_TASK_SUPPORT,
} from "@sidecar/session";
import {
  ACTION_RESULT_STATUS,
  CONVERSATION_EVENT_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_RATING,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "@sidecar/wire";
import { test } from "vitest";

import {
  swiftEnumRawValues,
  swiftStaticNumber,
  swiftStaticString,
  swiftSwitchLiterals,
  swiftSwitchNumbers,
} from "./swift-source.js";

const IOS_ROOT = join(import.meta.dirname, "..", "..", "apps", "ios");
const KIT = "LukeKit/Sources/LukeKit";

const sources = new Map<string, string>();

function swift(path: string): string {
  const cached = sources.get(path);
  if (cached !== undefined) return cached;
  const source = readFileSync(join(IOS_ROOT, path), "utf8");
  sources.set(path, source);
  return source;
}

function assertSameValues(
  swiftValues: readonly string[],
  typeScriptValues: readonly string[],
  label: string,
): void {
  assert.deepEqual([...swiftValues].sort(), [...typeScriptValues].sort(), label);
}

function assertSameSet(
  swiftValues: readonly string[],
  typeScriptSet: Readonly<Record<string, string>>,
  label: string,
): void {
  assertSameValues(swiftValues, Object.values(typeScriptSet), label);
}

function assertSubset(
  swiftValues: readonly string[],
  typeScriptValues: readonly string[],
  label: string,
): void {
  const known = new Set(typeScriptValues);
  assert.deepEqual(
    swiftValues.filter((value) => !known.has(value)),
    [],
    label,
  );
}

test("RosterSessionControlKind is SESSION_CONTROL_KIND", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/RosterSession.swift`), "RosterSessionControlKind"),
    SESSION_CONTROL_KIND,
    "a control kind the phone cannot name is drawn as a plain action",
  );
});

test("ConversationAuthor is CONVERSATION_MESSAGE_AUTHOR", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ConversationClient.swift`), "ConversationAuthor"),
    CONVERSATION_MESSAGE_AUTHOR,
    "an author the phone cannot name drops the message off the chat screen",
  );
});

test("ProjectTaskSupport is WORKSPACE_TASK_SUPPORT", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ProjectsClient.swift`), "ProjectTaskSupport"),
    WORKSPACE_TASK_SUPPORT,
    "a task support the phone cannot name offers the wrong creation form",
  );
});

test("ProductProviderID is PROVIDER_ID", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ProductEvents.swift`), "ProductProviderID"),
    PROVIDER_ID,
    "a provider the phone cannot name is left uncounted",
  );
});

test("VaultProviderID is CLOUD_AGENT_PROVIDER_ID", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/VaultClient.swift`), "VaultProviderID"),
    CLOUD_AGENT_PROVIDER_ID,
    "a vault provider the phone cannot name cannot be offered a key field",
  );
});

test("HostedAPIError is HOSTED_API_ERROR", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/VaultClient.swift`), "HostedAPIError"),
    HOSTED_API_ERROR,
    "a refusal the phone cannot name is shown as a bare status instead of a reason",
  );
});

test("DevicePlatform is DEVICE_PLATFORM", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/DeviceClient.swift`), "DevicePlatform"),
    DEVICE_PLATFORM,
    "a platform the service does not name registers no row",
  );
});

test("PushEnvironment is PUSH_ENVIRONMENT", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/DeviceClient.swift`), "PushEnvironment"),
    PUSH_ENVIRONMENT,
    "a gateway name the service does not know refuses the registration whole",
  );
});

test("the device path and token bounds are the hosted contract's", () => {
  assert.equal(
    `/${swiftStaticString(swift(`${KIT}/DeviceClient.swift`), "path")}`,
    HOSTED_SERVICE_PATH.DEVICES,
    "a path the service does not answer registers nothing",
  );
  assert.equal(
    swiftStaticNumber(swift(`${KIT}/DeviceClient.swift`), "tokenMinLength"),
    DEVICE_TOKEN_BOUNDS.MIN_LENGTH,
  );
  assert.equal(
    swiftStaticNumber(swift(`${KIT}/DeviceClient.swift`), "tokenMaxLength"),
    DEVICE_TOKEN_BOUNDS.MAX_LENGTH,
  );
});

test("ActionResult is ACTION_RESULT_STATUS", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ActionClient.swift`), "ActionResult"),
    ACTION_RESULT_STATUS,
    "an action outcome the phone cannot name reads as a malformed answer",
  );
});

test("VoiceToolName is the remote tool set the mint declares", () => {
  assertSameValues(
    swiftEnumRawValues(swift(`${KIT}/VoiceAsks.swift`), "VoiceToolName"),
    remoteRealtimeToolDefinitions().map((tool) => tool.name),
    "a tool the mint declares and the phone cannot name is refused before it is looked at",
  );
});

test("every VoiceToolName is a ACTION_TOOL", () => {
  assertSubset(
    swiftEnumRawValues(swift(`${KIT}/VoiceAsks.swift`), "VoiceToolName"),
    Object.values(ACTION_TOOL),
    "a tool renamed in the actions table leaves the phone naming a tool that does not exist",
  );
});

test("RealtimeVoice is REALTIME_VOICE", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/VoiceSettings.swift`), "RealtimeVoice"),
    REALTIME_VOICE,
    "a voice outside the set is refused at mint time",
  );
});

test("RealtimeVoiceSpeed names the same paces as REALTIME_VOICE_SPEED", () => {
  assertSameValues(
    swiftEnumRawValues(swift(`${KIT}/VoiceSettings.swift`), "RealtimeVoiceSpeed"),
    Object.keys(REALTIME_VOICE_SPEED).map((key) => key.toLowerCase()),
    "a pace the phone stores by a name the contract does not have falls to the default",
  );
});

test("RealtimeVoiceSpeed multiplies by what REALTIME_VOICE_SPEED holds", () => {
  const multipliers = swiftSwitchNumbers(
    swift(`${KIT}/VoiceSettings.swift`),
    "RealtimeVoiceSpeed",
    "multiplier",
    "Double",
  );
  const expected = new Map(
    Object.entries(REALTIME_VOICE_SPEED).map(([key, speed]) => [key.toLowerCase(), speed]),
  );
  assert.deepEqual(
    [...multipliers].sort(),
    [...expected].sort(),
    "a pace whose multiplier drifted speaks at a rate the contract never offered",
  );
});

test("every ProductEvent name is a PRODUCT_EVENT", () => {
  assertSubset(
    swiftSwitchLiterals(swift(`${KIT}/ProductEvents.swift`), "ProductEvent", "name"),
    Object.values(PRODUCT_EVENT),
    "an event name outside the allowlist is refused by the service as a whole batch",
  );
});

test("every ProductEventClient is a PRODUCT_EVENT_CLIENT", () => {
  assertSubset(
    swiftEnumRawValues(swift(`${KIT}/ProductEvents.swift`), "ProductEventClient"),
    Object.values(PRODUCT_EVENT_CLIENT),
    "a client header value outside the set reads as the desktop's",
  );
});

test("ProductAccountAction is PRODUCT_ACCOUNT_ACTION", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ProductEvents.swift`), "ProductAccountAction"),
    PRODUCT_ACCOUNT_ACTION,
    "an account act outside the allowlist is refused with its batch",
  );
});

test("ProductSessionAction is PRODUCT_SESSION_ACTION", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ProductEvents.swift`), "ProductSessionAction"),
    PRODUCT_SESSION_ACTION,
    "a session action outside the allowlist is refused with its batch",
  );
});

test("every ProductSettingID is an APP_SETTING_ID", () => {
  assertSubset(
    swiftEnumRawValues(swift(`${KIT}/ProductEvents.swift`), "ProductSettingID"),
    Object.values(APP_SETTING_ID),
    "a setting id outside the shared vocabulary is refused with its batch",
  );
});

test("ProductSettingValue is PRODUCT_SETTING_VALUE", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ProductEvents.swift`), "ProductSettingValue"),
    PRODUCT_SETTING_VALUE,
    "a setting-change shape outside the allowlist is refused with its batch",
  );
});

test("the client header is PRODUCT_EVENT_CLIENT_HEADER", () => {
  assert.equal(
    swiftStaticString(swift(`${KIT}/ProductEventSender.swift`), "clientHeader"),
    PRODUCT_EVENT_CLIENT_HEADER,
    "a header the service does not read makes every phone batch the desktop's",
  );
});

test("the batch limit is PRODUCT_EVENT_BATCH_LIMIT", () => {
  assert.equal(
    swiftStaticNumber(swift(`${KIT}/ProductEventSender.swift`), "batchLimit"),
    PRODUCT_EVENT_BATCH_LIMIT,
    "a batch larger than the wire's bound is refused whole",
  );
});

test("the vault key bound is VAULT_KEY_MAX_LENGTH", () => {
  assert.equal(
    swiftStaticNumber(swift(`${KIT}/VaultClient.swift`), "keyMaxLength"),
    VAULT_KEY_MAX_LENGTH,
    "a bound looser than the server's lets an unusable key travel",
  );
});

/** The session family of the action table: the tools whose parts a Conversation row is drawn for. */
const SESSION_ACTION_TOOLS = Object.values(ACTIONS).filter(
  (tool) => tool.family === ACTION_FAMILY.SESSION,
);

test("MessageRole is MESSAGE_ROLE", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/UIMessage.swift`), "MessageRole"),
    MESSAGE_ROLE,
    "a role the phone cannot name refuses the stored message whole",
  );
});

test("MessageAuthor is MESSAGE_AUTHOR", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/UIMessage.swift`), "MessageAuthor"),
    MESSAGE_AUTHOR,
    "an author the phone cannot name refuses the stored message whole",
  );
});

test("MessageChannel is MESSAGE_CHANNEL", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/UIMessage.swift`), "MessageChannel"),
    MESSAGE_CHANNEL,
    "a channel the phone cannot name refuses the developer's own ask",
  );
});

test("ObservationSource is OBSERVATION_SOURCE", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/UIMessage.swift`), "ObservationSource"),
    OBSERVATION_SOURCE,
    "an observation source the phone cannot name refuses the brain's own note",
  );
});

test("ToolPartState is TOOL_PART_STATE", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/UIMessage.swift`), "ToolPartState"),
    TOOL_PART_STATE,
    "a stored tool state the phone cannot name refuses the message that carries it",
  );
});

test("TurnOrigin is TURN_ORIGIN", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ConversationReads.swift`), "TurnOrigin"),
    TURN_ORIGIN,
    "an origin the phone cannot name refuses the page and cannot mark Luke's own judgment",
  );
});

test("TurnStatus is TURN_STATUS", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ConversationReads.swift`), "TurnStatus"),
    TURN_STATUS,
    "a status the phone cannot name refuses the page and cannot fold a running turn",
  );
});

test("ConversationViewSourceKind is CONVERSATION_VIEW_SOURCE", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ConversationReads.swift`), "ConversationViewSourceKind"),
    CONVERSATION_VIEW_SOURCE,
    "a source the phone cannot name refuses the page",
  );
});

test("ConversationViewToolKind is CONVERSATION_VIEW_TOOL_KIND", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ConversationReads.swift`), "ConversationViewToolKind"),
    CONVERSATION_VIEW_TOOL_KIND,
    "a tool kind the phone cannot name refuses the page",
  );
});

test("ConversationActionOutcome is CONVERSATION_VIEW_ACTION_OUTCOME", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ConversationReads.swift`), "ConversationActionOutcome"),
    CONVERSATION_VIEW_ACTION_OUTCOME,
    "the outcomes the phone words are the outcomes the view decides, or a row lies about an action",
  );
});

test("ConversationEventKind is CONVERSATION_EVENT_KIND", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ConversationReads.swift`), "ConversationEventKind"),
    CONVERSATION_EVENT_KIND,
    "an event kind the phone cannot name refuses the events page",
  );
});

test("ActionOutputStatus is ACTION_OUTPUT_STATUS", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ActionOutputEnvelope.swift`), "ActionOutputStatus"),
    ACTION_OUTPUT_STATUS,
    "an envelope status the phone cannot name reads as an unreadable answer",
  );
});

test("ConversationActionKind is the session family of ACTION_KIND", () => {
  assertSameValues(
    swiftEnumRawValues(swift(`${KIT}/ConversationToolRow.swift`), "ConversationActionKind"),
    SESSION_ACTION_TOOLS.map((tool) => tool.kind),
    "the kinds the phone words are the kinds the desktop words, so the two rows say the same set of things",
  );
});

test("ConversationActionTool names the session family's tools", () => {
  assertSameValues(
    swiftEnumRawValues(swift(`${KIT}/ConversationToolRow.swift`), "ConversationActionTool"),
    SESSION_ACTION_TOOLS.map((tool) => tool.name),
    "a session action tool the phone cannot name folds into the turn's details instead of drawing its row",
  );
});

test("the read paths and page bound are the hosted contract's", () => {
  const source = swift(`${KIT}/ConversationReadClient.swift`);
  assert.equal(
    `/${swiftStaticString(source, "messagesPath")}`,
    HOSTED_SERVICE_PATH.CONVERSATION_MESSAGES,
  );
  assert.equal(
    `/${swiftStaticString(source, "eventsPath")}`,
    HOSTED_SERVICE_PATH.CONVERSATION_EVENTS,
  );
  assert.equal(`/${swiftStaticString(source, "turnsPath")}`, HOSTED_SERVICE_PATH.BRAIN_TURNS);
  assert.equal(`/${swiftStaticString(source, "changesPath")}`, HOSTED_SERVICE_PATH.CHANGES);
  assert.equal(swiftStaticNumber(source, "maximumPageLimit"), READ_PAGE_BOUNDS.MAX_LIMIT);
});

test("MessageRating is MESSAGE_RATING", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/MessageRatingClient.swift`), "MessageRating"),
    MESSAGE_RATING,
    "a verdict the phone cannot name is refused by the rating route and cannot draw the control's state",
  );
});

test("ProductRatedMessageKind is PRODUCT_RATED_MESSAGE_KIND", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/ProductEvents.swift`), "ProductRatedMessageKind"),
    PRODUCT_RATED_MESSAGE_KIND,
    "a message kind outside the allowlist is refused with its batch",
  );
});

test("the rating path is conversationMessageRatingPath around the message's id", () => {
  const source = swift(`${KIT}/MessageRatingClient.swift`);
  const id = "2b000000-0000-4000-8000-000000000012";
  assert.equal(
    `/${swiftStaticString(source, "pathHead")}/${id}/${swiftStaticString(source, "pathTail")}`,
    conversationMessageRatingPath(id),
    "a path the service does not answer records no rating",
  );
});

test("a case with no raw value contributes its own name", () => {
  const source = "public enum Kind: String, Sendable {\n    case codex\n    case omp\n}\n";
  assert.deepEqual(swiftEnumRawValues(source, "Kind"), ["codex", "omp"]);
});

test("an explicit raw value wins over the case name", () => {
  const source = 'enum Kind: String {\n    case claudeCode = "claude-code"\n}\n';
  assert.deepEqual(swiftEnumRawValues(source, "Kind"), ["claude-code"]);
});

test("several cases on one line are several values", () => {
  const source = 'enum Method: String, Sendable { case get = "GET", post = "POST" }\n';
  assert.deepEqual(swiftEnumRawValues(source, "Method"), ["GET", "POST"]);
});

test("a computed property inside the body is not part of the case list", () => {
  const source = [
    "public enum Speed: String, CaseIterable, Sendable, Identifiable {",
    "    case slow",
    "    case fast",
    "",
    "    /// A brace in a comment { does not close the body.",
    "    public var multiplier: Double {",
    "        switch self {",
    "        case .slow: 0.75",
    "        case .fast: 1.5",
    "        }",
    "    }",
    "}",
  ].join("\n");
  assert.deepEqual(swiftEnumRawValues(source, "Speed"), ["slow", "fast"]);
  assert.deepEqual(
    [...swiftSwitchNumbers(source, "Speed", "multiplier", "Double")],
    [
      ["slow", 0.75],
      ["fast", 1.5],
    ],
  );
});

test("a declaration that is not there is a failure, never an empty set", () => {
  assert.throws(() => swiftEnumRawValues("enum Other: String { case a }", "Kind"), /no .*Kind/u);
  assert.throws(() => swiftSwitchLiterals("", "Kind", "name"), /no type Kind/u);
});
