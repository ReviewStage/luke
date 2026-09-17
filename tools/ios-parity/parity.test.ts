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
import { ACTION_FAMILY, ACTION_OUTPUT_STATUS, ACTIONS } from "@sidecar/actions";
import {
  PRODUCT_EVENT_BATCH_LIMIT,
  PRODUCT_EVENT_CLIENT_HEADER,
  PRODUCT_VOICE_SESSION_SOURCE,
  ProductAccountActionSchema,
  ProductEventClientSchema,
  ProductEventNameSchema,
  ProductRatedMessageKindSchema,
  ProductSessionActionSchema,
  ProductSettingValueSchema,
} from "@sidecar/analytics";
import { LIVE_TRANSPORT_STATE } from "@sidecar/gateway";
import { APP_SETTING_ID } from "@sidecar/guide";
import {
  BRIEFING_PUSH_PAYLOAD_KEY,
  conversationMessageRatingPath,
  DEVICE_PLATFORM,
  DEVICE_TOKEN_BOUNDS,
  HOSTED_API_ERROR,
  HOSTED_SERVICE_PATH,
  PUSH_ENVIRONMENT,
  READ_PAGE_BOUNDS,
  VAULT_KEY_MAX_LENGTH,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_HEADER,
  VOICE_SERVICE_PATH,
} from "@sidecar/hosted";
import {
  LIVE_AUDIO_ENCODING,
  LIVE_AUDIO_FORMAT,
  LIVE_CLIENT_EVENT,
  LIVE_CLOSE_REASON,
  LIVE_DEFAULT_AUDIO_FORMAT,
  LIVE_IDLE_WINDOW_MS,
  LIVE_INPUT_AUDIO_APPEND,
  LIVE_SERVER_EVENT,
  LIVE_STATUS,
  LIVE_VOICE,
  PROACTIVE_SPEECH_KIND,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
  TRANSCRIPT_SPEAKER,
  UTTERANCE_GAP_MS,
} from "@sidecar/live";
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
import { HOSTED_REATTACH_DELAYS_MS } from "@sidecar/voice";
import {
  ACTION_RESULT_STATUS,
  CONVERSATION_EVENT_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_RATING,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  RATING_WORD,
  TURN_ORIGIN,
  TURN_STATUS,
} from "@sidecar/wire";
import { Schema, SchemaAST } from "effect";
import { test } from "vitest";

import {
  swiftEnumCases,
  swiftEnumRawValues,
  swiftStaticCase,
  swiftStaticNumber,
  swiftStaticNumberList,
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

const readsStringLiteral = Schema.is(Schema.String);

/** Every literal an Effect Schema declares, in the order it declares them. */
function schemaLiterals<A extends string>(schema: Schema.Codec<A>): readonly string[] {
  const nodes = SchemaAST.isUnion(schema.ast) ? schema.ast.types : [schema.ast];
  return nodes.flatMap((node) =>
    SchemaAST.isLiteral(node) && readsStringLiteral(node.literal) ? [node.literal] : [],
  );
}

/** The analytics vocabulary's own comparisons run through its Effect Schema declarations. */
function assertSameSchemaSet<A extends string>(
  swiftValues: readonly string[],
  schema: Schema.Codec<A>,
  label: string,
): void {
  assertSameValues(swiftValues, schemaLiterals(schema), label);
}

function assertSchemaSubset<A extends string>(
  swiftValues: readonly string[],
  schema: Schema.Codec<A>,
  label: string,
): void {
  const isMember = Schema.is(schema);
  assert.deepEqual(
    swiftValues.filter((value) => !isMember(value)),
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

test("a briefing's tap reads the payload key the push writes", () => {
  assert.equal(
    swiftStaticString(swift(`${KIT}/BriefingPush.swift`), "messageIdKey"),
    BRIEFING_PUSH_PAYLOAD_KEY.MESSAGE_ID,
    "a key the phone does not read opens the Conversation at no briefing",
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

test("LiveVoice is LIVE_VOICE", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/VoiceSettings.swift`), "LiveVoice"),
    LIVE_VOICE,
    "a voice the desktop synced that the phone cannot name refuses the whole snapshot",
  );
});

test("LiveClientEventType is RENDERER_CLIENT_EVENTS", () => {
  assertSameValues(
    swiftEnumRawValues(swift(`${KIT}/LiveEvents.swift`), "LiveClientEventType"),
    RENDERER_CLIENT_EVENTS,
    "a command outside what an untrusted peer may send is refused by the session's permissions",
  );
});

test("LiveServerEventType is RENDERER_SERVER_EVENTS", () => {
  assertSameValues(
    swiftEnumRawValues(swift(`${KIT}/LiveEvents.swift`), "LiveServerEventType"),
    RENDERER_SERVER_EVENTS.map((selector) => selector.type),
    "an event the channel shows the device and the phone cannot name is dropped unread",
  );
});

test("LiveCloseReason is LIVE_CLOSE_REASON", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/LiveEvents.swift`), "LiveCloseReason"),
    LIVE_CLOSE_REASON,
    "a close reason the phone cannot name refuses the closed event and leaves the hang-up to its bound",
  );
});

test("LiveStatus is LIVE_STATUS", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/LivePeer.swift`), "LiveStatus"),
    LIVE_STATUS,
    "a status the desktop reports that the phone cannot name has no screen state to draw",
  );
});

test("LiveTransportState is LIVE_TRANSPORT_STATE", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/LivePeer.swift`), "LiveTransportState"),
    LIVE_TRANSPORT_STATE,
    "a transport state outside the report's schema is a state the desktop never tells its host about either",
  );
});

test("VoiceServiceFrame is VOICE_SERVICE_FRAME", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/VoiceServiceContract.swift`), "VoiceServiceFrame"),
    VOICE_SERVICE_FRAME,
    "a service frame the phone cannot name is read as a session event it is not",
  );
});

test("LiveClientEventName is LIVE_CLIENT_EVENT", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/VoiceServiceContract.swift`), "LiveClientEventName"),
    LIVE_CLIENT_EVENT,
    "a client event the phone names by another word is refused by the route, which closes the socket",
  );
});

test("VoiceServiceHeader is VOICE_SERVICE_HEADER", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/VoiceServiceContract.swift`), "VoiceServiceHeader"),
    VOICE_SERVICE_HEADER,
    "a header the service does not read leaves the session naming no device",
  );
});

test("ProactiveSpeechKind is PROACTIVE_SPEECH_KIND", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/VoiceServiceContract.swift`), "ProactiveSpeechKind"),
    PROACTIVE_SPEECH_KIND,
    "a spoken kind the phone cannot name drops the service's word that it was spoken",
  );
});

test("the sessions socket path, idle window, and reattach cadence are the desktop's", () => {
  const source = swift(`${KIT}/VoiceServiceContract.swift`);
  assert.equal(
    `/${swiftStaticString(source, "sessionsPath")}`,
    VOICE_SERVICE_PATH.SESSIONS,
    "a path the service does not answer opens no session",
  );
  assert.equal(
    swiftStaticNumber(source, "liveIdleWindowMs"),
    LIVE_IDLE_WINDOW_MS,
    "an idle window of the phone's own reports idle on another clock than the Mac's",
  );
  assert.deepEqual(
    swiftStaticNumberList(source, "reattachDelaysMs"),
    HOSTED_REATTACH_DELAYS_MS,
    "a cadence of the phone's own tries a lost connection on other terms than the Mac's",
  );
});

test("LiveTranscriptSpeaker is TRANSCRIPT_SPEAKER", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/LiveCaptions.swift`), "LiveTranscriptSpeaker"),
    TRANSCRIPT_SPEAKER,
    "a speaker the phone cannot name draws a caption row under nobody",
  );
});

test("the caption rows group on the desktop's gap", () => {
  const source = swift(`${KIT}/LiveCaptions.swift`);
  assert.equal(
    swiftStaticNumber(source, "utteranceGapMs"),
    UTTERANCE_GAP_MS,
    "a gap of the phone's own splits an utterance the record keeps whole",
  );
});

test("every ProductVoiceSessionSource is a PRODUCT_VOICE_SESSION_SOURCE", () => {
  assertSubset(
    swiftEnumRawValues(swift(`${KIT}/ProductEvents.swift`), "ProductVoiceSessionSource"),
    Object.values(PRODUCT_VOICE_SESSION_SOURCE),
    "a session source outside the allowlist is refused with its batch",
  );
});

test("the audio socket path and its two audio event types are the contract's", () => {
  const source = swift(`${KIT}/VoiceServiceContract.swift`);
  assert.equal(
    `/${swiftStaticString(source, "audioPath")}`,
    VOICE_SERVICE_PATH.AUDIO,
    "a path the service does not answer opens no session for the watch",
  );
  assert.equal(
    swiftStaticString(source, "inputAudioAppend"),
    LIVE_INPUT_AUDIO_APPEND,
    "audio sent under another type is refused by the route, which closes the socket",
  );
  assert.equal(
    swiftStaticString(source, "outputAudioDelta"),
    LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA,
    "Luke's audio relayed under a type the watch does not read plays nothing",
  );
});

test("LiveAudioEncoding is LIVE_AUDIO_ENCODING", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/VoiceServiceContract.swift`), "LiveAudioEncoding"),
    LIVE_AUDIO_ENCODING,
    "an encoding named otherwise is refused by the format schema at the door",
  );
});

test("LiveAudioFormat is LIVE_AUDIO_FORMAT, rate for rate, with the same default", () => {
  const source = swift(`${KIT}/VoiceServiceContract.swift`);
  const cases = swiftEnumCases(source, "LiveAudioFormat");
  assertSameValues(
    [...cases.values()],
    Object.keys(LIVE_AUDIO_FORMAT),
    "a format the watch names that the table does not is refused at startup",
  );
  const rates = swiftSwitchNumbers(source, "LiveAudioFormat", "rate", "Int");
  const formats = new Map(Object.entries(LIVE_AUDIO_FORMAT));
  for (const [caseName, key] of cases) {
    assert.equal(
      rates.get(caseName),
      formats.get(key)?.rate,
      `${key}: a rate the guide does not pair with the encoding is refused at startup`,
    );
  }
  const defaultKey = cases.get(swiftStaticCase(source, "default"));
  assert.deepEqual(
    defaultKey === undefined ? undefined : formats.get(defaultKey),
    LIVE_DEFAULT_AUDIO_FORMAT,
    "a default of the watch's own would speak at another rate than the one ruled",
  );
});

test("every ProductEvent name is a PRODUCT_EVENT", () => {
  assertSchemaSubset(
    swiftSwitchLiterals(swift(`${KIT}/ProductEvents.swift`), "ProductEvent", "name"),
    ProductEventNameSchema,
    "an event name outside the allowlist is refused by the service as a whole batch",
  );
});

test("every ProductEventClient is a PRODUCT_EVENT_CLIENT", () => {
  assertSchemaSubset(
    swiftEnumRawValues(swift(`${KIT}/ProductEvents.swift`), "ProductEventClient"),
    ProductEventClientSchema,
    "a client header value outside the set reads as the desktop's",
  );
});

test("ProductAccountAction is PRODUCT_ACCOUNT_ACTION", () => {
  assertSameSchemaSet(
    swiftEnumRawValues(swift(`${KIT}/ProductEvents.swift`), "ProductAccountAction"),
    ProductAccountActionSchema,
    "an account act outside the allowlist is refused with its batch",
  );
});

test("ProductSessionAction is PRODUCT_SESSION_ACTION", () => {
  assertSameSchemaSet(
    swiftEnumRawValues(swift(`${KIT}/ProductEvents.swift`), "ProductSessionAction"),
    ProductSessionActionSchema,
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
  assertSameSchemaSet(
    swiftEnumRawValues(swift(`${KIT}/ProductEvents.swift`), "ProductSettingValue"),
    ProductSettingValueSchema,
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

test("RatingWord is RATING_WORD", () => {
  assertSameSet(
    swiftEnumRawValues(swift(`${KIT}/MessageRatingClient.swift`), "RatingWord"),
    RATING_WORD,
    "a word the phone cannot say is refused by the rating route, and one it cannot read leaves a thumb it should have taken off",
  );
});

test("ProductRatedMessageKind is PRODUCT_RATED_MESSAGE_KIND", () => {
  assertSameSchemaSet(
    swiftEnumRawValues(swift(`${KIT}/ProductEvents.swift`), "ProductRatedMessageKind"),
    ProductRatedMessageKindSchema,
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

test("an enum's cases are read with their raw values, and a static case by its name", () => {
  const source = [
    "public enum Format: String, CaseIterable, Sendable {",
    '    case pcm16At24k = "PCM16_24K"',
    "    case ulaw",
    "",
    "    public static let `default`: Format = .ulaw",
    "}",
  ].join("\n");
  assert.deepEqual(
    [...swiftEnumCases(source, "Format")],
    [
      ["pcm16At24k", "PCM16_24K"],
      ["ulaw", "ulaw"],
    ],
  );
  assert.equal(swiftStaticCase(source, "default"), "ulaw");
  assert.throws(() => swiftStaticCase(source, "other"), /found 0/u);
});

test("a static list reads its numbers in order", () => {
  assert.deepEqual(
    swiftStaticNumberList("static let delays = [0, 3_000, 7000]", "delays"),
    [0, 3000, 7000],
  );
  assert.throws(() => swiftStaticNumberList("static let delays = []", "delays"), /not a list/u);
  assert.throws(() => swiftStaticNumberList("static let other = [1]", "delays"), /found 0/u);
});

test("a declaration that is not there is a failure, never an empty set", () => {
  assert.throws(() => swiftEnumRawValues("enum Other: String { case a }", "Kind"), /no .*Kind/u);
  assert.throws(() => swiftSwitchLiterals("", "Kind", "name"), /no type Kind/u);
});
