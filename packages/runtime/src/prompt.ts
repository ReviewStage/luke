import { type BootstrapFile, CHILD_BOOTSTRAP_FILES } from "./workspace.js";

/**
 * The last stage a prompt is composed in: the pure builder that turns facts
 * already gathered into ordered sections. It reads no file, no clock, and no
 * configuration, so what a developer inspects is what the model was sent.
 * Sections come out in a fixed order whose stable ones lead and whose
 * per-turn one trails, so a provider's prefix cache sees the same bytes until
 * a workspace file actually changes. The instructions are handed in whole:
 * the product owns its words, this package owns where they sit. The order and the profiles follow OpenClaw `b7528507`
 * (`docs/concepts/system-prompt.md`).
 */

export const PROMPT_PROFILE = {
  FULL: "full",
  MINIMAL: "minimal",
} as const;

export type PromptProfile = (typeof PROMPT_PROFILE)[keyof typeof PROMPT_PROFILE];

const PROMPT_SECTION = {
  INSTRUCTIONS: "instructions",
  WORKSPACE: "workspace",
  BOOTSTRAP_NOTICE: "bootstrap_notice",
  WORKSPACE_FILES: "workspace_files",
  RUNTIME: "runtime",
} as const;

type PromptSectionId = (typeof PROMPT_SECTION)[keyof typeof PROMPT_SECTION];

/** The sections in the order they are emitted; the per-turn one trails the stable ones. */
const PROMPT_SECTION_ORDER: readonly PromptSectionId[] = [
  PROMPT_SECTION.INSTRUCTIONS,
  PROMPT_SECTION.WORKSPACE,
  PROMPT_SECTION.BOOTSTRAP_NOTICE,
  PROMPT_SECTION.WORKSPACE_FILES,
  PROMPT_SECTION.RUNTIME,
];

/** The sections the minimal profile keeps: the instructions, the workspace, the runtime, and AGENTS.md alone. */
const MINIMAL_SECTIONS: ReadonlySet<PromptSectionId> = new Set([
  PROMPT_SECTION.INSTRUCTIONS,
  PROMPT_SECTION.WORKSPACE,
  PROMPT_SECTION.BOOTSTRAP_NOTICE,
  PROMPT_SECTION.WORKSPACE_FILES,
  PROMPT_SECTION.RUNTIME,
]);

interface PromptSection {
  readonly id: PromptSectionId;
  readonly heading: string;
  readonly text: string;
}

export interface BuiltPrompt {
  /** The prompt as sent: the sections it kept, in order. */
  readonly text: string;
  readonly chars: number;
}

export interface PromptFacts {
  readonly profile: PromptProfile;
  /** Everything the build tells the agent, as one string; the product's words, not this package's. */
  readonly instructions: string;
  readonly workspaceDirectory: string;
  readonly bootstrapFiles: readonly BootstrapFile[];
  /** The runtime line's facts: the agent id, the runtime, and the model when known. */
  readonly runtime: {
    readonly agentId: string;
    readonly model?: string;
    readonly runtimeId: string;
  };
}

function workspaceFilesText(files: readonly BootstrapFile[]): string {
  const present = files.filter((file) => !file.missing && file.content.length > 0);
  if (present.length === 0) return "";
  return present
    .map((file) =>
      [
        `## ${file.name}`,
        "",
        file.content.trimEnd(),
        ...(file.truncated ? ["", `[truncated: ${file.originalChars} characters on disk]`] : []),
      ].join("\n"),
    )
    .join("\n\n");
}

function bootstrapNotice(files: readonly BootstrapFile[]): string {
  const truncated = files.filter((file) => file.truncated);
  if (truncated.length === 0) return "";
  return [
    "Some bootstrap files were cut short to fit the prompt:",
    ...truncated.map(
      (file) => `- ${file.name}: ${file.content.length} of ${file.originalChars} characters shown`,
    ),
    "When the full text matters, read the file directly with the workspace read tool.",
  ].join("\n");
}

function runtimeText(facts: PromptFacts["runtime"]): string {
  return [
    `agent: ${facts.agentId}`,
    `runtime: ${facts.runtimeId}`,
    ...(facts.model ? [`model: ${facts.model}`] : []),
  ].join("\n");
}

const HEADINGS = {
  [PROMPT_SECTION.INSTRUCTIONS]: "Instructions",
  [PROMPT_SECTION.WORKSPACE]: "Workspace",
  [PROMPT_SECTION.BOOTSTRAP_NOTICE]: "Bootstrap Context Notice",
  [PROMPT_SECTION.WORKSPACE_FILES]: "Workspace Files",
  [PROMPT_SECTION.RUNTIME]: "Runtime",
} as const satisfies Record<PromptSectionId, string>;

/** The files a profile injects: everything gathered for full, AGENTS.md alone for minimal. */
function bootstrapFilesForProfile(
  files: readonly BootstrapFile[],
  profile: PromptProfile,
): readonly BootstrapFile[] {
  switch (profile) {
    case PROMPT_PROFILE.FULL:
      return files;
    case PROMPT_PROFILE.MINIMAL:
      return files.filter((file) => CHILD_BOOTSTRAP_FILES.includes(file.name));
  }
}

function sectionText(id: PromptSectionId, facts: PromptFacts, files: readonly BootstrapFile[]) {
  switch (id) {
    case PROMPT_SECTION.INSTRUCTIONS:
      return facts.instructions;
    case PROMPT_SECTION.WORKSPACE:
      return `Your workspace is ${facts.workspaceDirectory}. Its files are below, and they're yours to edit.`;
    case PROMPT_SECTION.BOOTSTRAP_NOTICE:
      return bootstrapNotice(files);
    case PROMPT_SECTION.WORKSPACE_FILES:
      return workspaceFilesText(files);
    case PROMPT_SECTION.RUNTIME:
      return runtimeText(facts.runtime);
  }
}

/** Builds the prompt from gathered facts alone. */
export function buildSystemPrompt(facts: PromptFacts): BuiltPrompt {
  const files = bootstrapFilesForProfile(facts.bootstrapFiles, facts.profile);
  const sections: PromptSection[] = [];
  for (const id of PROMPT_SECTION_ORDER) {
    if (facts.profile === PROMPT_PROFILE.MINIMAL && !MINIMAL_SECTIONS.has(id)) continue;
    const text = sectionText(id, facts, files);
    if (!text) continue;
    sections.push({ id, heading: HEADINGS[id], text });
  }
  const text = sections.map((section) => `# ${section.heading}\n\n${section.text}`).join("\n\n");
  return { text, chars: text.length };
}
