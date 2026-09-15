import type { ToolSchema } from "./execution.js";

/**
 * What this build compiled in: the item format a context engine reads, where
 * a tool runs and what it does, and the descriptors a catalog and a skill
 * listing are made of. Names and capabilities, never behavior — the
 * constructors that turn a name into a runtime or an engine live in the
 * package that owns them (`@sidecar/brain`).
 */

/** The item format a runtime writes and an engine reads. */
interface ItemFormatIdentity {
  readonly format: string;
  readonly version: number;
}

/**
 * The item format the UIMessage engine persists: the conversation's stored
 * rows, each the AI SDK `UIMessage` a store holds and the model its turn ran
 * on. There is no checkpoint on this path — the rows are the record, and the
 * model's input is derived from them each turn — so the format names what
 * the engine reads, not a second copy it keeps.
 */
export const UI_MESSAGE_ITEM_FORMAT = {
  format: "ai-ui-message",
  version: 1,
} as const satisfies ItemFormatIdentity;

/** How a tool's call is carried out: inside the host, by the host's action performer, against the agent's own workspace files, or by the configured memory provider. */
export const TOOL_EXECUTION = {
  HOST: "host",
  PERFORMER: "performer",
  WORKSPACE: "workspace",
  MEMORY: "memory",
} as const;

export const TOOL_EFFECT = {
  READ: "read",
  WRITE: "write",
  SPEAK: "speak",
} as const;

type ToolEffect = (typeof TOOL_EFFECT)[keyof typeof TOOL_EFFECT];

/**
 * Where a tool runs and what it does. A performer carries acts, a workspace
 * tool writes the agent's own files, and a memory tool reads or writes what
 * the memory provider keeps, so none of them can be the tool that speaks:
 * only a host tool may, and the union is what says so rather than a check
 * something has to remember to run.
 */
export type ToolPlacement =
  | { readonly execution: typeof TOOL_EXECUTION.HOST; readonly effect: ToolEffect }
  | {
      readonly execution:
        | typeof TOOL_EXECUTION.PERFORMER
        | typeof TOOL_EXECUTION.WORKSPACE
        | typeof TOOL_EXECUTION.MEMORY;
      readonly effect: typeof TOOL_EFFECT.READ | typeof TOOL_EFFECT.WRITE;
    };

/**
 * A tool as the catalog holds it: its schema as a model is offered it, where
 * it runs, and what it does. The schema's name is the tool's whole identity —
 * it is both what a model is offered and what dispatch looks up — because a
 * descriptor carrying a second name could be offered under one and
 * dispatched under the other.
 */
export type ToolDescriptor = {
  readonly schema: ToolSchema;
  /** Groups the policy may name in place of the tool: `group:read`, `group:actions`, and so on. */
  readonly groups: readonly string[];
} & ToolPlacement;

export interface SkillDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** The absolute path of the skill's SKILL.md, loaded on demand and never inlined into a prompt. */
  readonly location: string;
  /** Whether the skill is offered at all; a disabled skill is listed to no run. */
  readonly enabled: boolean;
  /** Agents the skill is limited to; empty means every agent. */
  readonly agents: readonly string[];
}
