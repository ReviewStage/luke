import type { AccountSnapshot } from "@sidecar/credentials/snapshot";
import { ACCOUNT_PROVIDER } from "@sidecar/credentials/snapshot";
import {
  type FeedbackResult,
  type FeedbackSubmission,
  feedbackSubmission,
} from "@sidecar/feedback";
import {
  type VoiceCreateLiveSessionResult,
  voiceCreateLiveSessionParamsSchema,
  voiceCreateLiveSessionResultSchema,
  voiceEndLiveSessionParamsSchema,
  voiceReportLiveActivityParamsSchema,
  voiceReportLiveTransportParamsSchema,
} from "@sidecar/gateway";
import { PLAN_MARKDOWN_MAX_CHARS } from "@sidecar/hosted/plan-markdown";
import {
  type PlanningRepositoriesAnswer,
  type PlanningSetRepositoryAnswer,
  type PlanningStartAnswer,
  planningBoardSaveParamsSchema,
  planningRenameParamsSchema,
  planningRepositoriesAnswerSchema,
  planningSetRepositoryAnswerSchema,
  planningSetRepositoryParamsSchema,
  planningStartAnswerSchema,
  planningStartRequestSchema,
} from "@sidecar/hosted/planning-view";
import type { LiveDiagnostics } from "@sidecar/live";
import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  isAppSettingField,
  SETTINGS_RESET_SCOPE,
} from "@sidecar/settings";
import type { SettingsUpdateResult } from "@sidecar/settings/wire";
import type { WindowMode } from "@sidecar/surface";
import {
  EXCESS_KEYS,
  isRecord,
  isWireBoolean,
  isWireString,
  SCHEMA_REFUSAL,
  type SchemaPath,
  type SchemaRead,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Result } from "effect";
import type { MicrophoneRoute, MicrophoneStatus } from "./audio";
import type { UpdateSnapshot } from "./update";
import { VOICE_COMMAND } from "./voice-view";
import { isWireValue, type WireGuard, type WireGuardValue, wireResult } from "./wire-guard";

/**
 * Every effect a window may ask this build's main process for, named once.
 * There is no second way in: a press, a spoken setting change, and a row's
 * own control all mint one of these kinds and hand it to `app:act`, whose
 * router parses the kind's payload, runs that kind's trust checks, and
 * dispatches. Adding an effect is adding an entry here, its payload schema
 * below, its answer's guard beside it, and its one row in the router — a
 * command with no kind reaches nothing.
 *
 * A kind is what the window asks for, never what the main process does with
 * it: some are carried to the host over the operator client and some are the
 * desktop's own, and which is which is the router's business rather than the
 * vocabulary's.
 */
export const ACT_KIND = {
  ACCOUNT_BEGIN_SIGN_IN: "account.beginSignIn",
  ACCOUNT_CANCEL_SIGN_IN: "account.cancelSignIn",
  ACCOUNT_SIGN_OUT: "account.signOut",
  ACCOUNT_DELETE: "account.delete",
  SETTING_UPDATE: "setting.update",
  SETTINGS_RESET: "settings.reset",
  UPDATE_CHECK: "update.check",
  UPDATE_INSTALL: "update.install",
  UPDATE_OPEN_RELEASE: "update.openRelease",
  UPDATE_OPEN_CHANGELOG: "update.openChangelog",
  /**
   * The panel's Plans tab asking the host: the plan list and the active
   * document read as the tab shows, one plan made the active one, the open
   * plan left, a plan started on a repository, and a plan renamed, given its
   * repository, or deleted. The view arrives on the document rather than as
   * an answer; nothing here writes a plan's document, which the plan's
   * notetaker alone saves.
   */
  PLANNING_REFRESH: "planning.refresh",
  PLANNING_SELECT: "planning.select",
  PLANNING_CLOSE: "planning.close",
  PLANNING_START: "planning.start",
  PLANNING_DELETE: "planning.delete",
  PLANNING_RENAME: "planning.rename",
  /** The repository chip's read: the repositories the account reaches through the Luke GitHub App, as the service answers them now. */
  PLANNING_REPOSITORIES: "planning.repositories",
  /** A plan given its repository on the service, or none; answers the repository as kept, or why it is unchanged. */
  PLANNING_SET_REPOSITORY: "planning.setRepository",
  /** A page of GitHub's opened in the browser: a repository, or where the Luke GitHub App is installed. No other address opens through it. */
  GITHUB_OPEN: "github.open",
  /** The Plans tab's microphone button: a call about the plan the panel has open, opened, or its microphone toggled. */
  PLANNING_TALK: "planning.talk",
  /** The open plan's whiteboard scene, saved whole with the number of Luke's drawing it holds. */
  PLANNING_BOARD_SAVE: "planning.boardSave",
  VOICE_COMMAND: "voice.command",
  /**
   * The voice window as a GPT Live peer: its SDP offer handed to the host,
   * which creates the one session and answers the SDP; the hang-up it asks
   * the host to decide; and the two reports the host reads its transport and
   * its idle from. No credential travels in any of them.
   */
  VOICE_CREATE_LIVE_SESSION: "voice.createLiveSession",
  VOICE_END_LIVE_SESSION: "voice.endLiveSession",
  VOICE_REPORT_LIVE_TRANSPORT: "voice.reportLiveTransport",
  VOICE_REPORT_LIVE_ACTIVITY: "voice.reportLiveActivity",
  VOICE_STOP_SPEAKING: "voice.stopSpeaking",
  VOICE_DIAGNOSTICS: "voice.diagnostics",
  MICROPHONE_REQUEST: "microphone.request",
  /**
   * Where the developer's voice would be captured from, read afresh: the act
   * probes the native watcher rather than answering the document, because the
   * route decides which device a press opens and macOS moves it between
   * presses.
   */
  MICROPHONE_ROUTE: "microphone.route",
  MICROPHONE_OPEN_SETTINGS: "microphone.openSettings",
  WINDOW_SET_EXPANDED: "window.setExpanded",
  WINDOW_FOCUS_PANEL: "window.focusPanel",
  WINDOW_COPY_TEXT: "window.copyText",
  WINDOW_QUIT: "window.quit",
  FEEDBACK_SEND: "feedback.send",
} as const;

export type ActKind = (typeof ACT_KIND)[keyof typeof ACT_KIND];

/**
 * One act payload's parser. The `s` combinators from `@sidecar/wire` satisfy
 * it, and every structural payload below is declared as one. It is the
 * reading alone rather than the whole `Schema` because no model is ever
 * offered an act: a JSON Schema node written here would be a second statement
 * of a rule the parser already holds, free to drift from it.
 */
interface ActSchema<Value> {
  read(value: UnparsedWireValue): SchemaRead<Value>;
}

/** One kind's whole declaration: what its payload takes, what its answer is, and what its refusal says. */
interface ActDeclaration<Payload, Result> {
  readonly payload: ActSchema<Payload>;
  readonly result: WireGuard<Result>;
  readonly refusal: string;
}

function malformed(path: SchemaPath = []): SchemaRead<never> {
  return { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path };
}

/**
 * A kind that carries nothing. The schema admits absence alone, so a payload
 * sent to a kind that takes none is refused at the boundary rather than
 * silently dropped.
 */
const noPayload: ActSchema<undefined> = {
  read: (value) => (value === undefined ? { ok: true, value: undefined } : malformed()),
};

/**
 * A whole payload whose shape its own domain already parses, where restating
 * it as a field table here would be a second statement of the same rule free
 * to drift from the parser that admits the value.
 */
function guarded<Value>(admits: (value: UnparsedWireValue) => boolean): ActSchema<Value> {
  return {
    read: (value) =>
      // SAFETY: the domain parser above is what this payload's type is defined by.
      admits(value) ? { ok: true, value: value as Value } : malformed(),
  };
}

/**
 * A payload named field by field, each field admitted by the parser its own
 * domain owns. What `record` is for a payload whose fields are texts and
 * counts, for the payloads whose fields are whole domain values instead.
 */
function fields<Value>(guards: {
  readonly [key: string]: (value: UnparsedWireValue) => boolean;
}): ActSchema<Value> {
  const named = Object.keys(guards);
  return guarded<Value>((value) => {
    if (!isRecord(value)) return false;
    for (const key of Object.keys(value)) if (!named.includes(key)) return false;
    return named.every((key) => guards[key]?.(value[key]) === true);
  });
}

/** An `ActSchema` read through an Effect `Schema`, so `.read()` answers the same word and path `readEither` does. */
function actSchema<Value, Encoded>(schema: EffectSchema.Codec<Value, Encoded>): ActSchema<Value> {
  const read = readEither(schema);
  return {
    read: (value) =>
      Result.match(read(value), {
        onFailure: ({ refusal, path }) => ({ ok: false, refusal, path }),
        onSuccess: (value) => ({ ok: true, value }),
      }),
  };
}

/**
 * Whether a value reads under a schema at all, for a result the payload's own
 * row only checks admits. Every schema read here is a Gateway answer, so a key
 * a newer host added is dropped rather than refused: which keys a read tolerates
 * is the read's to say now that a declaration carries no parse options of its own.
 */
const isReadable =
  <Value, Encoded>(schema: EffectSchema.Codec<Value, Encoded>) =>
  (value: UnparsedWireValue): boolean =>
    Result.isSuccess(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));

/** A payload's field table as a struct, refusing a key it did not name. */
function record<Fields extends EffectSchema.Struct.Fields>(
  fields: Fields,
): ActSchema<EffectSchema.Schema.Type<EffectSchema.Struct<Fields>>> {
  type Value = EffectSchema.Schema.Type<EffectSchema.Struct<Fields>>;
  const struct = EffectSchema.Struct(fields);
  return actSchema(EffectSchema.make<EffectSchema.Codec<Value, UnparsedWireValue>>(struct.ast));
}

/** An identifier's ends, admitted as written rather than trimmed, and refused when it carries nothing. */
function exactText(max: number): EffectSchema.Codec<string, string> {
  return EffectSchema.String.check(
    EffectSchema.makeFilter((value) => value.trim().length > 0),
    EffectSchema.isMaxLength(max),
  );
}

/** An identifier's ends, admitted as written and admitting nothing at all. */
function exactTextAllowingEmpty(max: number): EffectSchema.Codec<string, string> {
  return EffectSchema.String.check(EffectSchema.isMaxLength(max));
}

/**
 * An identifier that has to match the one it names elsewhere — a plan or an
 * account — so its ends are admitted as written rather than trimmed into a
 * value the host would not hold.
 */
const exactId = exactText(512);

/** The one host the browser is sent to from a plan: a repository's page, or the App's installation page. */
const GITHUB_ADDRESS = /^https:\/\/github\.com\//u;

/** An address on GitHub, and nowhere else: what a repository link or the installation link opens. */
const githubAddress = EffectSchema.String.check(
  EffectSchema.isMaxLength(2_048),
  EffectSchema.isPattern(GITHUB_ADDRESS),
);

/** A setting and a value already parsed for it, which is the pair its field types. */
export type SettingUpdatePayload = {
  [Field in AppSettingField]: {
    field: Field;
    value: AppSettingValue<Field>;
  };
}[AppSettingField];

/**
 * The one payload whose value is parsed by the field beside it. The parsed
 * value is what the payload carries, so the router's row receives the value
 * its field's own schema admitted rather than the one that arrived — there is
 * no second guard to disagree with this one.
 */
const settingUpdatePayload: ActSchema<SettingUpdatePayload> = {
  read: (raw) => {
    if (!isRecord(raw) || Object.keys(raw).some((key) => key !== "field" && key !== "value")) {
      return malformed();
    }
    const value = raw;
    const field = value.field;
    if (!isWireString(field) || !isAppSettingField(field)) return malformed(["field"]);
    const parsed = APP_SETTING_SCHEMA[field].guard(value.value);
    if (!parsed.valid) return malformed(["value"]);
    // SAFETY: the field's own schema guard admitted this value for this field.
    return { ok: true, value: { field, value: parsed.value } as SettingUpdatePayload };
  },
};

const answersNothing = wireResult<void>();
const answersSettings = wireResult<SettingsUpdateResult>();
const answersAccount = wireResult<AccountSnapshot>();

/**
 * A press: a kind that carries nothing and answers nothing, which is what
 * most of them are. The sentence is the only thing such a row has to say.
 */
const press = (refusal: string): ActDeclaration<undefined, void> => ({
  payload: noPayload,
  result: answersNothing,
  refusal,
});

/**
 * Every act, one row per kind, and everything this build says about a kind in
 * that one row: the parser its payload has to pass, the guard its answer has
 * to pass, and the sentence its refusal carries. One row rather than three
 * tables, so a kind is read and added in one place and a kind missing any of
 * the three does not build.
 *
 * The payload's parser is the whole of what the boundary admits: it runs in
 * the main process before the act is dispatched and again in the router, so a
 * caller inside the main process cannot reach a row with a payload the window
 * could not have sent. The answer's guard is checked where the answer is
 * read — in the router before the outcome is minted, and in the window that
 * asked before its caller sees a value — and a kind whose answer has a domain
 * reader of its own names it, while the rest carry the structured-clone shape
 * alone, which is all a `void` or a snapshot the host composed needs. The
 * refusal is fixed by the build, so what reaches the window is something its
 * row can draw rather than whatever message an exception happened to carry.
 */
export const ACT = {
  [ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: {
    payload: record({
      provider: EffectSchema.Literals(Object.values(ACCOUNT_PROVIDER)),
    }),
    result: answersAccount,
    refusal: "Could not start signing in on this system.",
  },
  [ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: press("Could not cancel that sign-in on this system."),
  [ACT_KIND.ACCOUNT_SIGN_OUT]: {
    payload: noPayload,
    result: answersAccount,
    refusal: "Could not sign out on this system.",
  },
  [ACT_KIND.ACCOUNT_DELETE]: {
    payload: noPayload,
    result: answersAccount,
    refusal: "Could not delete that account on this system.",
  },
  [ACT_KIND.SETTING_UPDATE]: {
    payload: settingUpdatePayload,
    result: answersSettings,
    refusal: "Could not save that setting on this system.",
  },
  [ACT_KIND.SETTINGS_RESET]: {
    payload: record({
      scope: EffectSchema.Literals(Object.values(SETTINGS_RESET_SCOPE)),
    }),
    result: answersSettings,
    refusal: "Could not reset those settings on this system.",
  },
  [ACT_KIND.UPDATE_CHECK]: {
    payload: noPayload,
    result: wireResult<UpdateSnapshot>(),
    refusal: "Could not check for updates on this system.",
  },
  [ACT_KIND.UPDATE_INSTALL]: press("Could not install that update on this system."),
  [ACT_KIND.UPDATE_OPEN_RELEASE]: press("Could not open the releases page."),
  [ACT_KIND.UPDATE_OPEN_CHANGELOG]: press("Could not open the changelog."),
  [ACT_KIND.PLANNING_REFRESH]: press("Could not read your plans on this system."),
  [ACT_KIND.PLANNING_SELECT]: {
    payload: record({ planId: exactId }),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not open that plan on this system.",
  },
  [ACT_KIND.PLANNING_CLOSE]: press("Could not leave that plan on this system."),
  [ACT_KIND.PLANNING_START]: {
    payload: actSchema(planningStartRequestSchema),
    result: wireResult<PlanningStartAnswer>(isReadable(planningStartAnswerSchema)),
    refusal: "Could not start that plan on this system.",
  },
  [ACT_KIND.PLANNING_DELETE]: {
    payload: record({ planId: exactId }),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not delete that plan on this system.",
  },
  [ACT_KIND.PLANNING_RENAME]: {
    payload: actSchema(planningRenameParamsSchema),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not rename that plan on this system.",
  },
  [ACT_KIND.PLANNING_REPOSITORIES]: {
    payload: noPayload,
    result: wireResult<PlanningRepositoriesAnswer>(isReadable(planningRepositoriesAnswerSchema)),
    refusal: "Could not read your GitHub repositories on this system.",
  },
  [ACT_KIND.PLANNING_SET_REPOSITORY]: {
    payload: actSchema(planningSetRepositoryParamsSchema),
    result: wireResult<PlanningSetRepositoryAnswer>(isReadable(planningSetRepositoryAnswerSchema)),
    refusal: "Could not change that plan's repository on this system.",
  },
  [ACT_KIND.GITHUB_OPEN]: {
    payload: record({ url: githubAddress }),
    result: answersNothing,
    refusal: "Could not open GitHub on this system.",
  },
  [ACT_KIND.PLANNING_TALK]: press("Could not talk about that plan on this system."),
  [ACT_KIND.PLANNING_BOARD_SAVE]: {
    payload: actSchema(planningBoardSaveParamsSchema),
    result: answersNothing,
    refusal: "Could not save the board on this system.",
  },
  [ACT_KIND.VOICE_COMMAND]: {
    payload: record({
      command: EffectSchema.Literals(Object.values(VOICE_COMMAND)),
    }),
    result: answersNothing,
    refusal: "Could not carry that command on this system.",
  },
  [ACT_KIND.VOICE_CREATE_LIVE_SESSION]: {
    payload: actSchema(voiceCreateLiveSessionParamsSchema),
    result: wireResult<VoiceCreateLiveSessionResult | undefined>(
      (value) => value === undefined || isReadable(voiceCreateLiveSessionResultSchema)(value),
    ),
    refusal: "Could not open a voice session on this system.",
  },
  [ACT_KIND.VOICE_END_LIVE_SESSION]: {
    payload: actSchema(voiceEndLiveSessionParamsSchema),
    result: wireResult<undefined>((value) => value === undefined),
    refusal: "Could not end the voice session on this system.",
  },
  [ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT]: {
    payload: actSchema(voiceReportLiveTransportParamsSchema),
    result: wireResult<undefined>((value) => value === undefined),
    refusal: "Could not report the voice transport on this system.",
  },
  [ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY]: {
    payload: actSchema(voiceReportLiveActivityParamsSchema),
    result: wireResult<undefined>((value) => value === undefined),
    refusal: "Could not report the voice activity on this system.",
  },
  [ACT_KIND.VOICE_STOP_SPEAKING]: {
    payload: noPayload,
    result: wireResult<boolean>((value) =>
      Result.isSuccess(readEither(EffectSchema.Boolean)(value)),
    ),
    refusal: "Could not tell Luke to stop speaking on this system.",
  },
  [ACT_KIND.VOICE_DIAGNOSTICS]: {
    payload: noPayload,
    result: wireResult<LiveDiagnostics | undefined>(),
    refusal: "Could not read the voice diagnostics on this system.",
  },
  [ACT_KIND.MICROPHONE_REQUEST]: {
    payload: noPayload,
    result: wireResult<MicrophoneStatus>(),
    refusal: "Could not ask for the microphone on this system.",
  },
  [ACT_KIND.MICROPHONE_ROUTE]: {
    payload: noPayload,
    result: wireResult<MicrophoneRoute | undefined>(),
    refusal: "Could not read the microphone route on this system.",
  },
  [ACT_KIND.MICROPHONE_OPEN_SETTINGS]: press("Could not open the microphone privacy settings."),
  [ACT_KIND.WINDOW_SET_EXPANDED]: {
    payload: record({
      expanded: EffectSchema.Boolean,
      focus: EffectSchema.optionalKey(EffectSchema.Boolean),
    }),
    result: wireResult<WindowMode>(),
    refusal: "Could not resize the panel on this system.",
  },
  [ACT_KIND.WINDOW_FOCUS_PANEL]: press("Could not focus the panel on this system."),
  [ACT_KIND.WINDOW_COPY_TEXT]: {
    // A plan's whole document is copied through this act, so it admits the
    // longest one the store can hold, and an empty document copies as the empty text it is.
    payload: record({ words: exactTextAllowingEmpty(PLAN_MARKDOWN_MAX_CHARS) }),
    result: answersNothing,
    refusal: "Could not copy that to the clipboard on this system.",
  },
  [ACT_KIND.WINDOW_QUIT]: press("Could not quit on this system."),
  [ACT_KIND.FEEDBACK_SEND]: {
    payload: fields<{ submission: FeedbackSubmission }>({
      submission: (value) => feedbackSubmission(value) !== undefined,
    }),
    result: wireResult<FeedbackResult>(),
    refusal: "Could not send that on this system.",
  },
} as const satisfies Record<ActKind, ActDeclaration<unknown, unknown>>;

type SchemaValue<Declaration> = Declaration extends ActSchema<infer Value> ? Value : never;

/** What one kind's payload is, read from that kind's own schema. */
export type ActPayload<Kind extends ActKind> = SchemaValue<(typeof ACT)[Kind]["payload"]>;

/** What one kind answers with, read from that kind's own guard. */
export type ActResultFor<Kind extends ActKind> = WireGuardValue<(typeof ACT)[Kind]["result"]>;

/**
 * One command as it crosses: the kind, and the payload its kind takes. A kind
 * that carries nothing has no `payload` key at all, so a payload sent to one
 * is a shape this type cannot describe and the boundary refuses.
 */
export type Act = {
  [Kind in ActKind]: ActPayload<Kind> extends undefined
    ? { readonly kind: Kind }
    : { readonly kind: Kind; readonly payload: ActPayload<Kind> };
}[ActKind];

/** What became of one act. Every answer is a value; nothing here is a throw. */
export const ACT_OUTCOME_STATUS = {
  DONE: "done",
  /** The act was admitted and refused, with a sentence its row can draw. */
  REFUSED: "refused",
  /** No kind by that name, which a build in step with its windows never sees. */
  UNKNOWN_ACT: "unknown-act",
} as const;

export type ActOutcome<Kind extends ActKind = ActKind> =
  | { readonly status: typeof ACT_OUTCOME_STATUS.DONE; readonly value: ActResultFor<Kind> }
  | { readonly status: typeof ACT_OUTCOME_STATUS.REFUSED; readonly reason: string }
  | { readonly status: typeof ACT_OUTCOME_STATUS.UNKNOWN_ACT };

const ACT_KINDS: readonly string[] = Object.values(ACT_KIND);

function isActKind(value: UnparsedWireValue): value is ActKind {
  return isWireString(value) && ACT_KINDS.includes(value);
}

/**
 * One act as its kind's own schema admits it, or nothing. The whole envelope
 * is read: an unnamed kind, a key beside `kind` and `payload`, a payload a
 * kind takes none of, and a payload its schema refuses are each refused here.
 */
export function parsedAct(value: UnparsedWireValue): Act | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of Object.keys(value)) if (key !== "kind" && key !== "payload") return undefined;
  const kind = value.kind;
  if (!isActKind(kind)) return undefined;
  const read = ACT[kind].payload.read(value.payload);
  if (!read.ok) return undefined;
  // SAFETY: the kind's own schema admitted this payload, which is the pairing Act declares.
  return (read.value === undefined ? { kind } : { kind, payload: read.value }) as Act;
}

/** Whether an answer is one of the three outcomes, whatever its kind's own value is. */
export function isActOutcome(value: UnparsedWireValue): boolean {
  if (!isRecord(value)) return false;
  if (value.status === ACT_OUTCOME_STATUS.UNKNOWN_ACT) return Object.keys(value).length === 1;
  if (value.status === ACT_OUTCOME_STATUS.REFUSED) {
    return Object.keys(value).length === 2 && isWireString(value.reason);
  }
  if (value.status !== ACT_OUTCOME_STATUS.DONE) return false;
  for (const key of Object.keys(value)) if (key !== "status" && key !== "value") return false;
  return isWireValue(value.value);
}
