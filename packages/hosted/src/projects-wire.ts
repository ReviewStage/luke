import {
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentModels,
  type WorkspaceProject,
} from "@sidecar/session";
import { EXCESS_KEYS, type UnparsedWireValue } from "@sidecar/wire";
import {
  declareReader,
  emitJsonSchema,
  readEither,
  verbatimJsonSchema,
} from "@sidecar/wire/effect";
import { Result, Schema, SchemaGetter, SchemaTransformation } from "effect";
import { writtenText } from "./service-wire.js";

/**
 * What the projects endpoint answers: where the caller's keys can create a
 * workspace, and which agents each such provider takes. A malformed entry is
 * skipped rather than failing the list; a half-read agent row is not, because
 * an agent offered without the models it runs under is a choice that cannot
 * be made. Every record here is a plain struct read through
 * `readEither(schema, { excess: EXCESS_KEYS.DROP })`: a key a newer service
 * added is dropped rather than refused, and that grain is the read's now
 * rather than the declaration's.
 */

/**
 * One place a new workspace can be created, as the projects endpoint reports
 * it: a project the named provider itself listed on the fresh observation
 * pass that answered the request. The creation action re-observes and validates
 * the id against the provider's own list again, so this entry can offer a
 * project but can never conjure one.
 */
export interface HostedWorkspaceProject
  extends Pick<
    WorkspaceProject,
    "namesItself" | "providerProjectId" | "repository" | "targetName" | "taskSupport"
  > {
  /** The cloud-agent provider id that reported this project. */
  providerId: string;
}

/**
 * One agent kind a provider's creation endpoint takes, with the models and
 * effort levels the build's table lists for it — a `WORKSPACE_AGENT_MODELS`
 * entry from `@sidecar/session`, carried onto the wire with its provider id.
 * Extending the table's own row type means the wire cannot drift from the
 * table it exists to flatten, and the workspace act validates a chosen
 * selection against the same table again server-side.
 */
export interface HostedWorkspaceAgentModels extends WorkspaceAgentModels {
  providerId: string;
}

/** The projects endpoint answer: where the caller's keys can create a workspace. */
export interface HostedProjectsAnswer {
  projects: HostedWorkspaceProject[];
  /** Agent choices for providers in `projects` whose creation takes one. */
  agentModels: HostedWorkspaceAgentModels[];
}

/**
 * A declaration handed the interface it decodes into, since Effect's `Schema`
 * is invariant in its decoded type and a struct assembled from field tables
 * only agrees with that interface rather than restating it. The same claim
 * the facade's own `schemaOver` made over its assembled AST.
 */
function schemaAs<Value>(schema: Schema.Top): Schema.Codec<Value, UnparsedWireValue> {
  return Schema.make<Schema.Codec<Value, UnparsedWireValue>>(schema.ast);
}

/**
 * A key a `dropRefused` field left holding `undefined` is dropped entirely,
 * exactly as an absent optional key is: a struct's decode still writes the
 * key when it arrived, even holding nothing.
 */
function omittingUndefinedKeys<Fields extends object, Encoded>(
  schema: Schema.Codec<Fields, Encoded>,
) {
  return schema.pipe(
    Schema.decodeTo(Schema.Unknown, {
      decode: SchemaGetter.transform((value) =>
        Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)),
      ),
      // Nothing on this wire encodes an answer, and the shape the decode
      // answers with is `unknown`, so the way back is a passthrough that
      // states it cannot narrow.
      encode: SchemaGetter.passthrough({ strict: false }),
    }),
  );
}

/** A trimmed text, refused when only whitespace remains. */
const text: Schema.Codec<string, string> = Schema.Trim.check(Schema.isNonEmpty());

/**
 * A member set read with its ends trimmed ahead of the membership test, the
 * node declared beside it because what the emitter shows for a
 * transformation is the text it decodes from.
 */
function trimmedEnum<const Member extends string>(
  members: readonly Member[],
): Schema.Codec<Member, string> {
  return verbatimJsonSchema(
    Schema.Trim.pipe(
      Schema.decodeTo(Schema.Literals(members), SchemaTransformation.passthroughSupertype()),
    ),
    { type: "string", enum: members },
  );
}

const written = writtenText;

/** The value a schema admitted, or nothing, for a caller that only cares whether the value is admissible. */
function admitted<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));
}

/** The value a `dropRefused` field admits: whatever the schema read, or nothing. */
function droppedField<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded>,
): Schema.Codec<Value | undefined, UnparsedWireValue> {
  return declareReader<Value | undefined>(
    (value) => ({ ok: true, value: admitted(schema, value) }),
    emitJsonSchema(schema),
  );
}

/** An array that drops a refused entry instead of refusing the whole array. */
function keptItems<Value, Encoded>(
  item: Schema.Codec<Value, Encoded>,
): Schema.Codec<readonly Value[], UnparsedWireValue> {
  const droppedItem = droppedField(item);
  const forgiving = Schema.Array(droppedItem);
  const transformed = forgiving.pipe(
    Schema.decodeTo(Schema.Unknown, {
      decode: SchemaGetter.transform((entries) => entries.filter((entry) => entry !== undefined)),
      encode: SchemaGetter.passthrough({ strict: false }),
    }),
  );
  return Schema.make<Schema.Codec<readonly Value[], UnparsedWireValue>>(transformed.ast);
}

const workspaceProjectSchema = schemaAs<HostedWorkspaceProject>(
  omittingUndefinedKeys(
    Schema.Struct({
      providerId: text,
      providerProjectId: text,
      repository: text,
      taskSupport: trimmedEnum(Object.values(WORKSPACE_TASK_SUPPORT)),
      targetName: Schema.optionalKey(droppedField(text)),
      namesItself: Schema.optionalKey(droppedField(Schema.Literal(true))),
    }),
  ),
);

const workspaceAgentModelsSchema = schemaAs<HostedWorkspaceAgentModels>(
  Schema.Struct({
    providerId: text,
    agent: text,
    models: Schema.Array(Schema.Struct({ id: text, label: text })).check(Schema.isMinLength(1)),
    // An effort this build cannot read is one choice missing from a row that
    // still offers its models, so the entry stands with the rest; a row that
    // named no efforts at all is one whose agent runs under none.
    efforts: keptItems(written),
  }),
);

/** A malformed project or agent entry is skipped, not fatal. */
export const hostedProjectsAnswerSchema = schemaAs<HostedProjectsAnswer>(
  Schema.Struct({
    projects: keptItems(workspaceProjectSchema),
    agentModels: Schema.optionalKey(droppedField(keptItems(workspaceAgentModelsSchema))),
  }).pipe(
    Schema.decodeTo(Schema.Unknown, {
      decode: SchemaGetter.transform((answer) => ({
        projects: answer.projects,
        agentModels: answer.agentModels ?? [],
      })),
      encode: SchemaGetter.passthrough({ strict: false }),
    }),
  ),
);
