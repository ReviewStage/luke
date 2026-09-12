/**
 * Every action's own field vocabulary, declared once: what the model is shown for
 * it and what admission reads out of what arrived. A hand-written JSON literal
 * beside a hand-written parser is two statements of one rule that drift a
 * field at a time; a `Schema` is one statement, so a field no admitter reads
 * is a field no model is offered.
 *
 * Every declaration here is a direct Effect `Schema`, read through
 * `@sidecar/wire/effect`'s `readEither` and shown through its `emitJsonSchema`,
 * rather than the `s.*` facade: a tool's request is the boundary
 * `definitionOf` (in `actions.ts`) shows a model, so it declares the schema a
 * model's own bytes are pinned to directly.
 */

import {
  APP_PANEL_TAB,
  APP_UPDATE_ACTION,
  FEEDBACK_COMPOSER_KIND,
  SESSION_LIST_SORT,
} from "@sidecar/guide";
import {
  maximumSessionMessageLength,
  maximumWorkspaceNameLength,
  PROVIDER_ID_LIST,
  SESSION_APPLICATION_ID,
  SESSION_LOCATION,
  SESSION_STATUS,
} from "@sidecar/session";
import {
  isWireString,
  type JsonSchemaNode,
  SCHEMA_REFUSAL,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { declareReader, describeWire } from "@sidecar/wire/effect";
import { Schema } from "effect";
import { SESSION_LIST_ALL, SESSION_LIST_VOICE } from "./action-kinds.js";

/** An identifier travels in a URL segment or a request field, never as prose. */
export const maximumIdentifierLength = 200;

/**
 * Every value a spoken narrowing may name, fixed by the build: the whole-list
 * scopes, every agent this build knows, and every app that associates with
 * sessions. The chips can hold no other value — a `SessionFilter` is drawn
 * from these same sets — so this enum is the whole vocabulary rather than a
 * convenience, and the model picks a token from it instead of echoing the
 * developer's words for a matcher to guess at. Which of these values narrow
 * to anything right now is the roster's question, answered by admission.
 */
export const SESSION_LIST_FILTER_VALUES: readonly string[] = [
  ...new Set<string>([
    SESSION_LIST_ALL,
    SESSION_LOCATION.LOCAL,
    SESSION_LOCATION.CLOUD,
    SESSION_LIST_VOICE,
    ...PROVIDER_ID_LIST,
    ...Object.values(SESSION_APPLICATION_ID),
  ]),
];

const SESSION_LIST_FILTER_DESCRIPTION =
  `The values to narrow the session list to: ${SESSION_LIST_ALL} for every session, ` +
  `${SESSION_LOCATION.LOCAL} or ${SESSION_LOCATION.CLOUD} for where work runs, ` +
  `${SESSION_LIST_VOICE} for voice chats, an agent's provider_id, or an associated app's id. ` +
  `Values combine — ${SESSION_LOCATION.LOCAL} with an agent keeps that agent's local ` +
  `sessions — and ${SESSION_LIST_ALL} stands alone.`;

/**
 * The narrowing vocabulary the phone's list holds: its chips read a row's
 * provider and status and nothing else, so a spoken narrowing there picks
 * from those two axes and the whole-list scope. Which values narrow to
 * anything is the observed roster's question, answered on the phone.
 */
const REMOTE_SESSION_LIST_FILTER_VALUES: readonly string[] = [
  ...new Set<string>([SESSION_LIST_ALL, ...PROVIDER_ID_LIST, ...Object.values(SESSION_STATUS)]),
];

const REMOTE_SESSION_LIST_FILTER_DESCRIPTION =
  `The values to narrow the session list to: ${SESSION_LIST_ALL} for every session, a ` +
  `provider_id for one provider's sessions, or a status (${Object.values(SESSION_STATUS).join(
    ", ",
  )}). Values combine — a provider with a status keeps that provider's sessions in that ` +
  `status — and ${SESSION_LIST_ALL} stands alone.`;

const SESSION_LIST_SORT_DESCRIPTION =
  `Reorders the session list: ${SESSION_LIST_SORT.URGENCY} puts what needs the ` +
  `developer first, ${SESSION_LIST_SORT.RECENCY} puts what moved last first.`;

/**
 * A text trimmed at both ends and refused for carrying nothing but
 * whitespace, past `max` too: the request field shape every action here
 * takes, with no combinator between the declaration and the AST it decodes.
 */
function boundedText(options: { max?: number; description?: string } = {}): Schema.Schema<string> {
  const { max, description } = options;
  const trimmed = Schema.transform(Schema.String, Schema.String, {
    strict: true,
    decode: (value: string) => value.trim(),
    encode: (value: string) => value,
  });
  const nonBlank = trimmed.pipe(
    Schema.filter((value) => value.length > 0, {
      schemaId: Schema.MinLengthSchemaId,
      jsonSchema: { minLength: 1 },
    }),
  );
  const bounded = max === undefined ? nonBlank : nonBlank.pipe(Schema.maxLength(max));
  return description === undefined ? bounded : describeWire(bounded, description);
}

const identifier = (description: string): Schema.Schema<string> =>
  boundedText({ max: maximumIdentifierLength, description });

/** The identity fields every session action names its target by. */
export const SESSION_IDENTITY_FIELDS = {
  provider_id: identifier("The session provider ID."),
  provider_session_id: identifier("The session ID."),
} as const;

/** The message and task bounds: refused rather than cut, one declaration each. */
export const MESSAGE_TEXT = boundedText({
  max: maximumSessionMessageLength,
  description: "The message to send.",
});
export const OPENING_TASK = boundedText({
  max: maximumSessionMessageLength,
  description: "An optional opening task.",
});
export const WORKSPACE_NAME = boundedText({ max: maximumWorkspaceNameLength });

/**
 * A spoken narrowing as it arrives: several values, or a lone string for a
 * narrowing of one. Blank entries are dropped rather than refused, and an
 * emptied list is no narrowing at all. Its node is the enum the model is
 * shown; which of those values narrow to anything now is admission's question.
 */
function filterValuesReader(
  values: readonly string[],
  description: string,
): Schema.Schema<readonly string[] | undefined, UnparsedWireValue> {
  const node: JsonSchemaNode = {
    type: "array",
    items: { type: "string", enum: values },
    description,
  };
  return declareReader<readonly string[] | undefined>((value: UnparsedWireValue) => {
    const entries = isWireString(value) ? [value] : value;
    if (!Array.isArray(entries) || !entries.every((entry) => isWireString(entry))) {
      return { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [] };
    }
    const cleaned = entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    return { ok: true, value: cleaned.length > 0 ? cleaned : undefined };
  }, node);
}

const PANEL_QUERY = boundedText({
  description: "Optional words to search the session list for; only rows saying every word stay.",
});

/** An enum member set as the emitter shows it: one `enum` node, described once. */
function enumLiteral<const Member extends string>(
  members: readonly Member[],
  description: string,
): Schema.Schema<Member> {
  return describeWire(Schema.Literal(...members), description);
}

export const PANEL_SORT = enumLiteral(
  Object.values(SESSION_LIST_SORT),
  SESSION_LIST_SORT_DESCRIPTION,
);

/** The tab, sort, and action enums, so the model reads the same value sets admission holds. */
export const PANEL_TAB = enumLiteral(
  Object.values(APP_PANEL_TAB),
  "The tab to show. Defaults to sessions.",
);
export const FEEDBACK_KIND = enumLiteral(
  Object.values(FEEDBACK_COMPOSER_KIND),
  "The feedback type.",
);
export const UPDATE_ACTION = enumLiteral(
  Object.values(APP_UPDATE_ACTION),
  "The action to run, as the guide's Updates line offers it.",
);
const AGENT_KIND = boundedText({ description: "The agent kind." });
const MODEL_TEXT = boundedText({ description: "An optional model." });
const EFFORT_TEXT = boundedText({ description: "An optional effort level." });

/**
 * A request's field table. Extra keys are ignored rather than refused: a model
 * that adds a field admission does not read has not asked for something wider,
 * and the emitted node still declines to invite one. Declared with the field
 * table's own concrete type — never erased here — so a caller that reads a
 * particular request directly, rather than through a `ToolSpec`, still reads
 * a typed record back; `actions.ts` erases it to the vocabulary `ToolSpec.request`
 * itself is declared in only where it is stored beside every other tool's.
 */
function record<Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });
}

const optional = <A, I>(field: Schema.Schema<A, I>) => Schema.optionalWith(field, { exact: true });

export const MESSAGE_REQUEST = record({ ...SESSION_IDENTITY_FIELDS, text: MESSAGE_TEXT });

export const CONTROL_REQUEST = record({
  ...SESSION_IDENTITY_FIELDS,
  control_id: boundedText({ description: "The control ID." }),
});

export const OPEN_REQUEST = record({
  ...SESSION_IDENTITY_FIELDS,
  application: optional(
    boundedText({
      description:
        "The app to open the session in, as its roster line's opens_in lists it — only " +
        "when the developer named one. Omitted, the session opens at its own address.",
    }),
  ),
});

export const REMOTE_OPEN_REQUEST = record({ ...SESSION_IDENTITY_FIELDS });

export const CREATE_WORKSPACE_REQUEST = record({
  provider_id: optional(
    boundedText({ description: "The provider ID; omit it to create in the default provider." }),
  ),
  project_id: optional(
    boundedText({
      description: "The project ID; omit it to create in that provider's default project.",
    }),
  ),
  target_id: optional(
    boundedText({
      description:
        "The target ID of the host, exactly as the projects list gives it, and only for a " +
        "project whose line carries a target_id; a project listed without one takes none.",
    }),
  ),
  agent: optional(AGENT_KIND),
  name: optional(
    describeWire(
      WORKSPACE_NAME,
      "The workspace's name: the developer's own when they chose one, otherwise a short, " +
        "specific name composed from what the workspace is for, in a few words with no " +
        "punctuation. Always supply one, except in a project listed as naming its own " +
        "workspaces, which takes none.",
    ),
  ),
  task: optional(OPENING_TASK),
  model: optional(MODEL_TEXT),
  effort: optional(EFFORT_TEXT),
});

export const ADD_AGENT_REQUEST = record({
  ...SESSION_IDENTITY_FIELDS,
  agent: AGENT_KIND,
  name: optional(describeWire(WORKSPACE_NAME, "An optional agent name.")),
  task: optional(OPENING_TASK),
  model: optional(MODEL_TEXT),
  effort: optional(EFFORT_TEXT),
});

export const RENAME_WORKSPACE_REQUEST = record({
  ...SESSION_IDENTITY_FIELDS,
  name: describeWire(
    WORKSPACE_NAME,
    "The workspace's new name, exactly as the developer chose it.",
  ),
});

export const RENAME_SESSION_REQUEST = record({
  ...SESSION_IDENTITY_FIELDS,
  name: describeWire(WORKSPACE_NAME, "The chat's new name, exactly as the developer chose it."),
});

export const SETTING_REQUEST = record({
  setting_id: boundedText({ description: "The setting ID." }),
  value: boundedText({ description: "The new value." }),
  effort: optional(
    describeWire(
      EFFORT_TEXT,
      "An effort level, only when the developer named one and the setting's guide line lists " +
        "efforts for the value; omit it everywhere else.",
    ),
  ),
});

/** The narrowing as it arrives on each surface; absent is no narrowing at all. */
const PANEL_FILTERS_READER = filterValuesReader(
  SESSION_LIST_FILTER_VALUES,
  SESSION_LIST_FILTER_DESCRIPTION,
);

/** Read standalone (admission reads `fields.filters` directly), so a missing key decodes at once. */
export const PANEL_FILTERS: Schema.Schema<readonly string[] | undefined, UnparsedWireValue> =
  Schema.UndefinedOr(PANEL_FILTERS_READER);

const REMOTE_PANEL_FILTERS_READER = filterValuesReader(
  REMOTE_SESSION_LIST_FILTER_VALUES,
  REMOTE_SESSION_LIST_FILTER_DESCRIPTION,
);

export const PANEL_REQUEST = record({
  tab: optional(PANEL_TAB),
  filters: optional(PANEL_FILTERS_READER),
  sort: optional(PANEL_SORT),
  query: optional(PANEL_QUERY),
});

export const REMOTE_PANEL_REQUEST = record({
  filters: optional(REMOTE_PANEL_FILTERS_READER),
  sort: optional(PANEL_SORT),
  query: optional(PANEL_QUERY),
});

export const FEEDBACK_REQUEST = record({
  kind: FEEDBACK_KIND,
  draft: optional(boundedText({ description: "An optional draft." })),
});

export const UPDATE_REQUEST = record({ action: UPDATE_ACTION });

export const REMEMBER_REQUEST = record({
  // The words are flattened and cut to their bound rather than refused past
  // it, which no text combinator says, so the bound stays `rememberedFactText`'s.
  words: boundedText({ description: "A concise durable fact about the developer." }),
  replaces: optional(
    boundedText({
      description: "The id of the remembered entry this one stands in for, when it changes one.",
    }),
  ),
});

export const FORGET_REQUEST = record({
  id: boundedText({ description: "The remembered entry's id." }),
});
