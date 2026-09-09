/**
 * Every act's own field vocabulary, declared once: what the model is shown for
 * it and what admission reads out of what arrived. A hand-written JSON literal
 * beside a hand-written parser is two statements of one rule that drift a
 * field at a time; a `Schema` is one statement, so a field no admitter reads
 * is a field no model is offered.
 */

import {
  APP_PANEL_TAB,
  APP_UPDATE_ACT,
  FEEDBACK_COMPOSER_KIND,
  SESSION_LIST_SORT,
} from "@sidecar/guide";
import {
  maximumIssueCommentLength,
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
  RECORD_EXTRA_KEYS,
  SCHEMA_REFUSAL,
  type Schema,
  type SchemaFields,
  s,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { SESSION_LIST_ALL, SESSION_LIST_VOICE } from "./act-kinds.js";

/** An identifier travels in a URL segment or a request field, never as prose. */
const maximumIdentifierLength = 200;

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

const identifier = (description: string): Schema<string> =>
  s.text({ max: maximumIdentifierLength, description });

/** The identity fields every session act names its target by. */
export const SESSION_IDENTITY_FIELDS = {
  provider_id: identifier("The session provider ID."),
  provider_session_id: identifier("The session ID."),
} as const;

/** The identity fields every issue act names its target by. */
export const ISSUE_IDENTITY_FIELDS = {
  tracker_id: identifier("The tracker ID."),
  issue_id: identifier("The issue ID."),
} as const;

/** The message, task, and comment bounds: refused rather than cut, one declaration each. */
export const MESSAGE_TEXT = s.text({
  max: maximumSessionMessageLength,
  description: "The message to send.",
});
export const OPENING_TASK = s.text({
  max: maximumSessionMessageLength,
  description: "An optional opening task.",
});
export const COMMENT_BODY = s.text({
  max: maximumIssueCommentLength,
  description: "The comment to add.",
});
export const WORKSPACE_NAME = s.text({ max: maximumWorkspaceNameLength });

/**
 * A spoken narrowing as it arrives: several values, or a lone string for a
 * narrowing of one. Blank entries are dropped rather than refused, and an
 * emptied list is no narrowing at all. Its node is the enum the model is
 * shown; which of those values narrow to anything now is admission's question.
 */
function filterValues(
  values: readonly string[],
  description: string,
): Schema<readonly string[] | undefined> {
  const node: JsonSchemaNode = {
    type: "array",
    items: { type: "string", enum: values },
    description,
  };
  return s.reader<readonly string[] | undefined>({
    read: (value: UnparsedWireValue) => {
      const entries = isWireString(value) ? [value] : value;
      if (!Array.isArray(entries) || !entries.every((entry) => isWireString(entry))) {
        return { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [] };
      }
      const cleaned = entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
      return { ok: true, value: cleaned.length > 0 ? cleaned : undefined };
    },
    jsonSchema: () => node,
  });
}

const PANEL_QUERY = s.text({
  description: "Optional words to search the session list for; only rows saying every word stay.",
});

export const PANEL_SORT = s.enumOf(Object.values(SESSION_LIST_SORT), {
  description: SESSION_LIST_SORT_DESCRIPTION,
});

/** The tab, sort, and act enums, so the model reads the same value sets admission holds. */
export const PANEL_TAB = s.enumOf(Object.values(APP_PANEL_TAB), {
  description: "The tab to show. Defaults to sessions.",
});
export const FEEDBACK_KIND = s.enumOf(Object.values(FEEDBACK_COMPOSER_KIND), {
  description: "The feedback type.",
});
export const UPDATE_ACT = s.enumOf(Object.values(APP_UPDATE_ACT), {
  description: "The act to run, as the guide's Updates line offers it.",
});
const AGENT_KIND = s.text({ description: "The agent kind." });
const OPTIONAL_MODEL = s.text({ description: "An optional model." }).optional();
const OPTIONAL_EFFORT = s.text({ description: "An optional effort level." }).optional();

/**
 * A request's field table. Extra keys are ignored rather than refused: a model
 * that adds a field admission does not read has not asked for something wider,
 * and the emitted node still declines to invite one.
 */
const record = <Fields extends SchemaFields>(fields: Fields) =>
  s.record(fields, { extraKeys: RECORD_EXTRA_KEYS.IGNORE });

export const MESSAGE_REQUEST = record({ ...SESSION_IDENTITY_FIELDS, text: MESSAGE_TEXT });

export const CONTROL_REQUEST = record({
  ...SESSION_IDENTITY_FIELDS,
  control_id: s.text({ description: "The control ID." }),
});

export const OPEN_REQUEST = record({
  ...SESSION_IDENTITY_FIELDS,
  application: s
    .text({
      description:
        "The app to open the session in, as its roster line's opens_in lists it — only " +
        "when the developer named one. Omitted, the session opens at its own address.",
    })
    .optional(),
});

export const REMOTE_OPEN_REQUEST = record({ ...SESSION_IDENTITY_FIELDS });

export const CREATE_WORKSPACE_REQUEST = record({
  provider_id: s
    .text({ description: "The provider ID; omit it to create in the default provider." })
    .optional(),
  project_id: s
    .text({ description: "The project ID; omit it to create in that provider's default project." })
    .optional(),
  target_id: s.text({ description: "The target ID." }).optional(),
  agent: AGENT_KIND.optional(),
  name: WORKSPACE_NAME.describe(
    "The workspace's name: the developer's own when they chose one, otherwise a short, " +
      "specific name composed from what the workspace is for, in a few words with no " +
      "punctuation. Always supply one, except in a project listed as naming its own " +
      "workspaces, which takes none.",
  ).optional(),
  task: OPENING_TASK.optional(),
  model: OPTIONAL_MODEL,
  effort: OPTIONAL_EFFORT,
});

export const ADD_AGENT_REQUEST = record({
  ...SESSION_IDENTITY_FIELDS,
  agent: AGENT_KIND,
  name: WORKSPACE_NAME.describe("An optional agent name.").optional(),
  task: OPENING_TASK.optional(),
  model: OPTIONAL_MODEL,
  effort: OPTIONAL_EFFORT,
});

export const RENAME_WORKSPACE_REQUEST = record({
  ...SESSION_IDENTITY_FIELDS,
  name: WORKSPACE_NAME.describe("The workspace's new name, exactly as the developer chose it."),
});

export const RENAME_SESSION_REQUEST = record({
  ...SESSION_IDENTITY_FIELDS,
  name: WORKSPACE_NAME.describe("The chat's new name, exactly as the developer chose it."),
});

export const ISSUE_STATE_REQUEST = record({
  ...ISSUE_IDENTITY_FIELDS,
  state: s.text({ description: "The target state." }),
});

export const ISSUE_COMMENT_REQUEST = record({ ...ISSUE_IDENTITY_FIELDS, body: COMMENT_BODY });

export const SETTING_REQUEST = record({
  setting_id: s.text({ description: "The setting ID." }),
  value: s.text({ description: "The new value." }),
  effort: OPTIONAL_EFFORT,
});

/** The narrowing as it arrives on each surface; absent is no narrowing at all. */
export const PANEL_FILTERS = filterValues(
  SESSION_LIST_FILTER_VALUES,
  SESSION_LIST_FILTER_DESCRIPTION,
).optional();

const REMOTE_PANEL_FILTERS = filterValues(
  REMOTE_SESSION_LIST_FILTER_VALUES,
  REMOTE_SESSION_LIST_FILTER_DESCRIPTION,
).optional();

export const PANEL_REQUEST = record({
  tab: PANEL_TAB.optional(),
  filters: PANEL_FILTERS,
  sort: PANEL_SORT.optional(),
  query: PANEL_QUERY.optional(),
});

export const REMOTE_PANEL_REQUEST = record({
  filters: REMOTE_PANEL_FILTERS,
  sort: PANEL_SORT.optional(),
  query: PANEL_QUERY.optional(),
});

export const FEEDBACK_REQUEST = record({
  kind: FEEDBACK_KIND,
  draft: s.text({ description: "An optional draft." }).optional(),
});

export const UPDATE_REQUEST = record({ action: UPDATE_ACT });

export const REMEMBER_REQUEST = record({
  // The words are flattened and cut to their bound rather than refused past
  // it, which no text combinator says, so the bound stays `rememberedFactText`'s.
  words: s.text({ description: "A concise durable fact about the developer." }),
  replaces: s
    .text({
      description: "The id of the remembered entry this one stands in for, when it changes one.",
    })
    .optional(),
});

export const FORGET_REQUEST = record({
  id: s.text({ description: "The remembered entry's id." }),
});
