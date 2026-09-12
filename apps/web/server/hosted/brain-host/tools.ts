import { emitJsonSchema } from "@sidecar/wire/effect";
import { Effect } from "effect";
import type { ToolContext as EveToolContext, ToolDefinition } from "eve/tools";
import { NOTEBOOK_MEMORY_TOOL } from "../../../../../packages/memory/src/index.js";
import {
  ACTION_REFUSAL,
  ACTION_TOOL,
  type ActionToolModule,
  ANNOUNCE_TOOL,
  type AnnounceToolModule,
  actionToolNamed,
  type BrainTurnTrigger,
  type BrainWorkspaceAccess,
  brainToolCatalog,
  type EffectiveToolPolicy,
  GROUP_PREFIX,
  isRecord,
  READ_TOOLS,
  type ReadToolModule,
  refusedActionOutput,
  resolveTurnToolPolicy,
  runOriginOf,
  sessionKey,
  TOOL_GROUP,
  type ToolContext,
  type ToolPolicyLayers,
  type UnparsedWireValue,
  type WireRecord,
  WORKSPACE_TOOLS,
  type WorkspaceToolModule,
} from "../../core.js";
import type { ConversationTarget } from "../store/index.js";
import type { HostedActionCarrier } from "./performer.js";
import { brainRosterOf, type HostedRoster } from "./roster.js";
import type { HostedTranscriptReads } from "./transcript.js";

/**
 * The brain's tools as eve runs them: each one a thin `defineTool` over the
 * module the brain declares it in, built from the module's own description
 * and wire schema so the catalog, the store's reader, and the runtime name
 * one thing. Which of the catalog a turn is offered is the effective tool
 * policy's decision, resolved from the hosted layer over the catalog and
 * the turn's own kind before the model reads a word; eve dispatches nothing
 * outside the set it was handed, so the schemas the model is offered and
 * the gate a call meets are one resolution. Every module reaches the host
 * through its context and nothing else: admission's readers and the carrier
 * for an action, the roster and the transcript reader for a read, the
 * workspace rows for a workspace tool, the briefing channel for `announce`.
 */

/**
 * What the service cannot perform is not offered: the tools that reach a
 * machine — an open, an app setting, the panel, the feedback composer, the
 * updater — and the groups behind
 * seams the service does not wire: delegation and skills, and the notebook's
 * two reads, which the index behind them does not stand here. The notebook's
 * two writes stay, admitted like every other action. The turn's own layer
 * still withholds `announce` from an ask.
 */
const HOSTED_TOOL_POLICY: ToolPolicyLayers = {
  agent: {
    deny: [
      `${GROUP_PREFIX}${TOOL_GROUP.SESSIONS}`,
      `${GROUP_PREFIX}${TOOL_GROUP.SKILLS}`,
      NOTEBOOK_MEMORY_TOOL.SEARCH,
      NOTEBOOK_MEMORY_TOOL.GET,
      ACTION_TOOL.OPEN_SESSION,
      ACTION_TOOL.CHANGE_APP_SETTING,
      ACTION_TOOL.SHOW_PANEL,
      ACTION_TOOL.OPEN_FEEDBACK_COMPOSER,
      ACTION_TOOL.RUN_UPDATE_ACTION,
    ],
  },
};

const POLICY_BY_TRIGGER = new Map<BrainTurnTrigger, EffectiveToolPolicy>();

/** The one resolution a hosted turn's tools get: the hosted layer over the catalog, then the turn's own; fixed per kind of turn. */
export function hostedTurnPolicy(trigger: BrainTurnTrigger): EffectiveToolPolicy {
  const held = POLICY_BY_TRIGGER.get(trigger);
  if (held) return held;
  const resolved = resolveTurnToolPolicy(brainToolCatalog(), HOSTED_TOOL_POLICY, trigger);
  POLICY_BY_TRIGGER.set(trigger, resolved);
  return resolved;
}

export interface HostedToolSeams {
  readonly conversation: ConversationTarget;
  /** The roster as the snapshot holds it now, read again for every call that needs it. */
  readonly roster: () => Promise<HostedRoster>;
  readonly carrier: HostedActionCarrier;
  readonly transcripts: Pick<HostedTranscriptReads, "whole">;
  readonly workspace: BrainWorkspaceAccess;
  readonly now: () => number;
}

/** The turn a set of tools is built for: what opened it and the ids its calls are attributed to. */
export interface HostedTurnStanding {
  readonly trigger: BrainTurnTrigger;
  readonly turnId: string;
  readonly runId: string;
}

const UNREADABLE_CALL: WireRecord = {
  status: "rejected",
  reason: ACTION_REFUSAL.UNREADABLE,
};

function standingOf(
  context: EveToolContext,
  seams: HostedToolSeams,
  turn: HostedTurnStanding,
): ToolContext {
  return {
    conversationId: sessionKey(seams.conversation.conversationId),
    turnId: turn.turnId,
    runId: turn.runId,
    origin: runOriginOf(turn.trigger),
    signal: context.abortSignal,
    isRevoked: () => context.abortSignal.aborted,
  };
}

/** A call's arguments as a module takes them, or nothing for arguments that are not a record. */
function fieldsOf(input: UnparsedWireValue): WireRecord | undefined {
  return isRecord(input) ? input : undefined;
}

type ModuleRun = (fields: WireRecord, standing: ToolContext) => Effect.Effect<WireRecord>;

/**
 * One tool as eve is told of it: the module's own name, words, and wire
 * schema as JSON. Nothing but data, because eve keeps what a dynamic tool
 * resolver returns across its durable steps and admits no closure that
 * captures anything else; the execution is bound in the eve project's own
 * file, over these declarations and the host it imports.
 */
export interface HostedToolDeclaration {
  readonly name: string;
  readonly description: string;
  /** The wire schema's JSON, as eve takes a plain JSON Schema input. */
  readonly inputSchema: ToolDefinition["inputSchema"];
}

const READ_TOOLS_BY_NAME = new Map(READ_TOOLS.map((module) => [module.name, module]));
const WORKSPACE_TOOLS_BY_NAME = new Map(WORKSPACE_TOOLS.map((module) => [module.name, module]));

/** The module one allowed name declares, or nothing for a name the host does not wire. */
function moduleNamed(
  name: string,
):
  | { readonly kind: "action"; readonly module: ActionToolModule }
  | { readonly kind: "read"; readonly module: ReadToolModule }
  | { readonly kind: "announce"; readonly module: AnnounceToolModule }
  | { readonly kind: "workspace"; readonly module: WorkspaceToolModule }
  | undefined {
  const action = actionToolNamed(name);
  if (action) return { kind: "action", module: action };
  const read = READ_TOOLS_BY_NAME.get(name);
  if (read) return { kind: "read", module: read };
  if (name === ANNOUNCE_TOOL.name) return { kind: "announce", module: ANNOUNCE_TOOL };
  const workspace = WORKSPACE_TOOLS_BY_NAME.get(name);
  if (workspace) return { kind: "workspace", module: workspace };
  return undefined;
}

/** The tools one turn is offered, by name in catalog order: the policy's allowed set, as declarations. */
export function hostedToolDeclarations(
  trigger: BrainTurnTrigger,
): readonly HostedToolDeclaration[] {
  return hostedTurnPolicy(trigger).allowed.flatMap((descriptor) => {
    const named = moduleNamed(descriptor.schema.name);
    if (!named) return [];
    return [
      {
        name: named.module.name,
        description: named.module.description,
        inputSchema: emitJsonSchema(named.module.inputSchema),
      },
    ];
  });
}

const NO_SUCH_TOOL: WireRecord = { status: "rejected", reason: ACTION_REFUSAL.NO_TOOL };

function runOf(
  named: NonNullable<ReturnType<typeof moduleNamed>>,
  seams: HostedToolSeams,
): ModuleRun {
  switch (named.kind) {
    case "action":
      return (fields, standing) =>
        Effect.gen(function* () {
          const admission = yield* Effect.promise(() => seams.carrier.admission());
          return yield* named.module.execute(fields, {
            ...standing,
            admission,
            carry: (action) => seams.carrier.carry(action, fields, standing),
          });
        });
    case "read":
      return (fields, standing) =>
        Effect.gen(function* () {
          const roster = brainRosterOf(yield* Effect.promise(() => seams.roster()), seams.now());
          return yield* named.module.execute(fields, {
            ...standing,
            roster: { text: roster.text, identities: roster.identities },
            readTranscript: (identity) => Effect.promise(() => seams.transcripts.whole(identity)),
          });
        });
    case "announce":
      // The words become the call's own part on the journal, and the relay
      // puts them on offer when it records the call as settled; the tool
      // itself hands nothing anywhere else.
      return (fields, standing) =>
        named.module.execute(fields, { ...standing, announce: () => undefined });
    case "workspace":
      // Nothing here journals: the service's own record of the call is the
      // turn record eve keeps, so the effect runs as the module handed it.
      return (fields, standing) =>
        named.module.execute(fields, {
          ...standing,
          workspace: seams.workspace,
          journal: (effect) => effect,
        });
  }
}

/**
 * Carries one call of one tool the turn was offered: the arguments read as a
 * record, the turn's standing checked before anything runs, and the module
 * run with the context its kind takes. A name outside the turn's policy is
 * refused here again, so the set the model was offered and the gate a call
 * meets are one resolution.
 */
export function runHostedTool(
  name: string,
  input: UnparsedWireValue,
  context: EveToolContext,
  seams: HostedToolSeams,
  turn: HostedTurnStanding,
): Effect.Effect<WireRecord> {
  return Effect.suspend(() => {
    if (!hostedTurnPolicy(turn.trigger).allows(name)) return Effect.succeed(NO_SUCH_TOOL);
    const named = moduleNamed(name);
    if (!named) return Effect.succeed(NO_SUCH_TOOL);
    const fields = fieldsOf(input);
    if (fields === undefined) return Effect.succeed(UNREADABLE_CALL);
    const standing = standingOf(context, seams, turn);
    if (standing.isRevoked()) {
      return Effect.succeed(refusedActionOutput(ACTION_REFUSAL.TURN_OVER));
    }
    return runOf(named, seams)(fields, standing);
  });
}
