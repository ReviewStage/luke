import { promises as fs } from "node:fs";
import path from "node:path";
import type { RunOrigin, ToolSchema } from "@sidecar/runtime-contracts";
import type { AgentConfiguration, ResolvedConfiguration } from "./configuration.js";
import { PROMPT_PROFILE, type PromptFacts, type PromptProfile } from "./prompt.js";
import type { SkillDescriptor } from "./registry.js";
import { discoverSkills, eligibleSkills } from "./skills.js";
import type { ChildPolicyContext } from "./tool-policy.js";
import {
  BOOTSTRAP_BOUNDS,
  BOOTSTRAP_FILE_ORDER,
  type BootstrapFile,
  CHILD_BOOTSTRAP_FILES,
  readBootstrapFiles,
} from "./workspace.js";

/**
 * The middle stage: gathering the live facts a prompt is built from, under
 * a configuration already resolved. It reads the workspace, walks the skill
 * roots, and reads the execution directory's notes when a run has one, and
 * hands the pure builder everything it needs as values. Nothing here decides
 * wording, and nothing here reads a configuration that is not the snapshot
 * it was handed.
 */

/** Which run is being prepared, as the profile and the files depend on it. */
export interface RunDescription {
  readonly origin: RunOrigin;
  /** Set for a child run; the profile drops to minimal and the bootstrap to AGENTS.md alone. */
  readonly child?: ChildPolicyContext;
}

/** Ordinary conversation, observation, heartbeat, and continuation runs use the full profile; a child gets minimal. */
export function promptProfileFor(run: RunDescription): PromptProfile {
  return run.child ? PROMPT_PROFILE.MINIMAL : PROMPT_PROFILE.FULL;
}

export interface GatherOptions {
  readonly configuration: ResolvedConfiguration;
  readonly run: RunDescription;
  /** The identity line the prompt opens with: the product's words, handed in rather than known here. */
  readonly identity: string;
  readonly tools: readonly ToolSchema[];
  readonly toolNotes: readonly string[];
  readonly runtimeContextMarker: string;
  readonly runtimeId: string;
  readonly model?: string;
  readonly executionDirectory?: string;
  /** Skills already discovered under this configuration's roots, when the caller discovered them itself. */
  readonly skills?: readonly SkillDescriptor[];
}

const EXECUTION_INSTRUCTIONS_FILE = "AGENTS.md";

async function executionDirectoryFacts(
  directory: string,
): Promise<PromptFacts["executionDirectory"]> {
  try {
    const text = await fs.readFile(path.join(directory, EXECUTION_INSTRUCTIONS_FILE), "utf8");
    return {
      path: directory,
      instructions: text.slice(0, BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE),
    };
  } catch {
    return { path: directory };
  }
}

/** The files a run reads from its workspace before the profile filters them: a child reads AGENTS.md alone. */
export function bootstrapNamesFor(run: RunDescription) {
  return run.child ? CHILD_BOOTSTRAP_FILES : BOOTSTRAP_FILE_ORDER;
}

export async function gatherPromptFacts(options: GatherOptions): Promise<PromptFacts> {
  const configuration: AgentConfiguration = options.configuration.configuration;
  const profile = promptProfileFor(options.run);
  const bootstrapFiles: readonly BootstrapFile[] = await readBootstrapFiles(
    configuration.workspaceDirectory,
    bootstrapNamesFor(options.run),
  );
  const discovered = options.skills ?? (await discoverSkills(configuration.skillRoots));
  const skills = eligibleSkills(discovered, configuration.agentId);
  const executionDirectory =
    options.executionDirectory !== undefined
      ? await executionDirectoryFacts(options.executionDirectory)
      : undefined;
  return {
    profile,
    identity: options.identity,
    tools: options.tools,
    toolNotes: options.toolNotes,
    runtimeContextMarker: options.runtimeContextMarker,
    skills,
    workspaceDirectory: configuration.workspaceDirectory,
    bootstrapFiles,
    ...(executionDirectory ? { executionDirectory } : undefined),
    runtime: {
      agentId: configuration.agentId,
      origin: options.run.origin,
      runtimeId: options.runtimeId,
      ...(options.model ? { model: options.model } : undefined),
    },
  };
}
