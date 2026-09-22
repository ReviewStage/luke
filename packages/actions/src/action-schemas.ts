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

import { maximumSessionMessageLength, maximumWorkspaceNameLength } from "@sidecar/session";
import { describeWire } from "@sidecar/wire/effect";
import { Schema } from "effect";

/** An identifier travels in a URL segment or a request field, never as prose. */
export const maximumIdentifierLength = 200;

/**
 * A text trimmed at both ends and refused for carrying nothing but
 * whitespace, past `max` too: the request field shape every action here
 * takes, with no combinator between the declaration and the AST it decodes.
 */
function boundedText(
  options: { max?: number; description?: string } = {},
): Schema.Codec<string, string> {
  const { max, description } = options;
  const nonBlank = Schema.Trim.check(Schema.isNonEmpty());
  const bounded = max === undefined ? nonBlank : nonBlank.check(Schema.isMaxLength(max));
  return description === undefined ? bounded : describeWire(bounded, description);
}

const identifier = (description: string): Schema.Codec<string, string> =>
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

const AGENT_KIND = boundedText({ description: "The agent kind." });

/** A field the model may leave out entirely, rather than send holding nothing. */
const optional = <Field extends Schema.Top>(field: Field) => Schema.optionalKey(field);

/**
 * Every request below is a plain struct declared with its own concrete field
 * table — never erased here — so a caller that reads a particular request
 * directly, rather than through a `ToolSpec`, still reads a typed record back;
 * `actions.ts` erases it to the vocabulary `ToolSpec.request` itself is
 * declared in only where it is stored beside every other tool's.
 *
 * Extra keys are ignored rather than refused — a model that adds a field
 * admission does not read has not asked for something wider, and the emitted
 * node still declines to invite one — but that is the read's grain rather than
 * the declaration's, since parse options are stated at the decode and nowhere
 * else. Admission reads these fields one at a time and never the record, so
 * the grain matters only where a whole request is read back, which is the
 * conversation row's read of a tool call's own arguments; it passes
 * `{ excess: EXCESS_KEYS.DROP }`.
 */

export const MESSAGE_REQUEST = Schema.Struct({ ...SESSION_IDENTITY_FIELDS, text: MESSAGE_TEXT });

export const CONTROL_REQUEST = Schema.Struct({
  ...SESSION_IDENTITY_FIELDS,
  control_id: boundedText({ description: "The control ID." }),
});

/**
 * A creation and a spawn declare no agent, model, or effort. The developer's
 * saved pairing rides every one the brain asks for, and the brain is offered
 * no field to name one in: the production record showed it volunteering a
 * model of its own on every creation whatever the description said, and a
 * named model outranks the pairing by design. A device's own picker (the
 * phone's creation sheet) still hands admission an agent, model, and effort
 * through its route, which reads no declaration here.
 */
export const CREATE_WORKSPACE_REQUEST = Schema.Struct({
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
});

export const ADD_AGENT_REQUEST = Schema.Struct({
  ...SESSION_IDENTITY_FIELDS,
  agent: AGENT_KIND,
  name: optional(describeWire(WORKSPACE_NAME, "An optional agent name.")),
  task: optional(OPENING_TASK),
});

export const RENAME_WORKSPACE_REQUEST = Schema.Struct({
  ...SESSION_IDENTITY_FIELDS,
  name: describeWire(
    WORKSPACE_NAME,
    "The workspace's new name, exactly as the developer chose it.",
  ),
});

export const RENAME_SESSION_REQUEST = Schema.Struct({
  ...SESSION_IDENTITY_FIELDS,
  name: describeWire(WORKSPACE_NAME, "The chat's new name, exactly as the developer chose it."),
});
