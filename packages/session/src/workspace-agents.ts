import { isWireString, type UnparsedWireValue, wireRecord } from "@sidecar/wire";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  isWorkspaceProviderId,
  PROVIDER_ID,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  WORKSPACE_PROVIDER_ID_LIST,
  type WorkspaceAgentKindSelection,
  type WorkspaceAgentModels,
  type WorkspaceAgentSelection,
  type WorkspaceProviderId,
} from "./providers.js";

/**
 * What kind of agent choice a workspace provider's creation endpoints take:
 * none at all, one of the agent kinds its own configuration lists (observed
 * per workspace, so no table here can name them), or a model from a table
 * this build documents. Every settings row, stored default, and spoken change
 * about a new agent branches on this declaration rather than on a name.
 */
export const AGENT_CHOICE = {
  NONE: "none",
  KINDS: "kinds",
  MODELS: "models",
} as const;

export type AgentChoice = (typeof AGENT_CHOICE)[keyof typeof AGENT_CHOICE];

export const WORKSPACE_AGENT_CHOICE = {
  [PROVIDER_ID.CLAUDE_CODE]: AGENT_CHOICE.NONE,
  [PROVIDER_ID.CODEX]: AGENT_CHOICE.NONE,
  [PROVIDER_ID.CONDUCTOR]: AGENT_CHOICE.MODELS,
  [PROVIDER_ID.OMP]: AGENT_CHOICE.NONE,
  [SUPERSET_WORKSPACE_PROVIDER_ID]: AGENT_CHOICE.KINDS,
  [CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID]: AGENT_CHOICE.NONE,
} as const satisfies Readonly<Record<WorkspaceProviderId, AgentChoice>>;

type ProvidersChoosing<Choice extends AgentChoice> = {
  [Id in WorkspaceProviderId]: (typeof WORKSPACE_AGENT_CHOICE)[Id] extends Choice ? Id : never;
}[WorkspaceProviderId];

export type ModelsWorkspaceProviderId = ProvidersChoosing<typeof AGENT_CHOICE.MODELS>;
export type KindsWorkspaceProviderId = ProvidersChoosing<typeof AGENT_CHOICE.KINDS>;

/** The agent choice a provider declares, or none for an id this build does not know. */
export function workspaceAgentChoice(providerId: string): AgentChoice {
  return isWorkspaceProviderId(providerId) ? WORKSPACE_AGENT_CHOICE[providerId] : AGENT_CHOICE.NONE;
}

export function isModelsWorkspaceProviderId(value: string): value is ModelsWorkspaceProviderId {
  return workspaceAgentChoice(value) === AGENT_CHOICE.MODELS;
}

export function isKindsWorkspaceProviderId(value: string): value is KindsWorkspaceProviderId {
  return workspaceAgentChoice(value) === AGENT_CHOICE.KINDS;
}

/** The providers declaring each of the two real choices, in list order. */
export interface WorkspaceAgentChoiceProviders {
  readonly [AGENT_CHOICE.MODELS]: readonly ModelsWorkspaceProviderId[];
  readonly [AGENT_CHOICE.KINDS]: readonly KindsWorkspaceProviderId[];
}

/** The providers declaring each choice, in `WORKSPACE_PROVIDER_ID_LIST` order. */
export const WORKSPACE_AGENT_CHOICE_PROVIDERS = {
  [AGENT_CHOICE.MODELS]: WORKSPACE_PROVIDER_ID_LIST.filter(isModelsWorkspaceProviderId),
  [AGENT_CHOICE.KINDS]: WORKSPACE_PROVIDER_ID_LIST.filter(isKindsWorkspaceProviderId),
} satisfies WorkspaceAgentChoiceProviders;

/**
 * The agent kinds, models, and effort levels each provider's creation
 * endpoints take, fixed by this build the way the spawnable agent kinds
 * always were. Conductor documents no endpoint that lists them — its own CLI
 * ships the same table compiled in — so this is documented state rather than
 * observed state, and it is the outer bound of every choice: the settings
 * rows offer only what is here, the store keeps only what is here, and an
 * adapter sends only what is here.
 *
 * Each model carries the name a person reads beside the id the endpoint
 * takes. The labels name no vendor — a model's own name already says whose it
 * is — except where the id alone says nothing, like Cursor's `auto`.
 *
 * Kept in step with `conductor models` (last read 2026-08-14). Drift is
 * bounded in both directions: a model or effort Conductor adds is simply not
 * offered until this table learns it, and one Conductor retires is refused by
 * its own endpoint with a reason Luke reports. Fast mode is deliberately
 * absent — Conductor's default stands for everything the user is not offered.
 */
export const WORKSPACE_AGENT_MODELS = {
  [PROVIDER_ID.CONDUCTOR]: [
    {
      agent: "claude",
      models: [
        { id: "fable-5", label: "Fable 5" },
        { id: "opus-5-1m", label: "Opus 5 (1M)" },
        { id: "opus-4-8-1m", label: "Opus 4.8 (1M)" },
        { id: "opus-4-8", label: "Opus 4.8" },
        { id: "opus-4-7-1m", label: "Opus 4.7 (1M)" },
        { id: "opus-4-7", label: "Opus 4.7" },
        // The unversioned ids are Conductor's own aliases for the latest of
        // each family, so their labels stay unversioned too.
        { id: "opus-1m", label: "Opus (1M)" },
        { id: "opus", label: "Opus" },
        { id: "opus-4-6-1m", label: "Opus 4.6 (1M)" },
        { id: "sonnet-5-1m", label: "Sonnet 5 (1M)" },
        { id: "sonnet-4-6-1m", label: "Sonnet 4.6 (1M)" },
        { id: "sonnet", label: "Sonnet" },
        { id: "haiku", label: "Haiku" },
      ],
      efforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      agent: "codex",
      models: [
        { id: "gpt-5.5", label: "GPT-5.5" },
        { id: "gpt-5.4", label: "GPT-5.4" },
        { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
        { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
        { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
        { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
        { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
        { id: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
      ],
      efforts: ["none", "low", "medium", "high", "xhigh", "max", "ultra"],
    },
    {
      agent: "cursor",
      models: [
        // "Auto" alone says nothing about whose choice it is.
        { id: "auto", label: "Cursor Auto" },
        { id: "composer-2.5", label: "Composer 2.5" },
        { id: "grok-4.6", label: "Grok 4.6" },
        { id: "grok-4.5", label: "Grok 4.5" },
      ],
      // Cursor documents no effort levels, so none is ever offered for it.
      efforts: [],
    },
  ],
} as const satisfies Readonly<Record<ModelsWorkspaceProviderId, readonly WorkspaceAgentModels[]>>;

/** The table for one provider, or nothing where none is documented. */
export function workspaceAgentModels(providerId: string): readonly WorkspaceAgentModels[] {
  return isModelsWorkspaceProviderId(providerId) ? WORKSPACE_AGENT_MODELS[providerId] : [];
}

/**
 * Whether a selection is one the build's table documents for this provider —
 * the model for its agent, and the effort, when one is chosen, for the same
 * agent. Everything that stores, offers, or sends a selection answers to this
 * one gate, so the three can never disagree about what exists.
 */
export function isListedWorkspaceAgentModel(
  providerId: string,
  selection: WorkspaceAgentSelection,
): boolean {
  const entry = workspaceAgentModels(providerId).find(
    (candidate) => candidate.agent === selection.agent,
  );
  if (!entry?.models.some((model) => model.id === selection.model)) return false;
  return selection.effort === undefined || entry.efforts.includes(selection.effort);
}

/** The name a person reads for a chosen model, falling back to its id. */
export function workspaceAgentModelLabel(
  providerId: string,
  selection: WorkspaceAgentSelection,
): string {
  const entry = workspaceAgentModels(providerId).find(
    (candidate) => candidate.agent === selection.agent,
  );
  return entry?.models.find((model) => model.id === selection.model)?.label ?? selection.model;
}

/** Guards a selection arriving over IPC: its shape first, then the table. */
export function isWorkspaceAgentSelection(providerId: string, value: UnparsedWireValue): boolean {
  return parseWorkspaceAgentSelection(providerId, value) !== undefined;
}

export function parseWorkspaceAgentSelection(
  providerId: string,
  value: UnparsedWireValue,
): WorkspaceAgentSelection | undefined {
  const record = wireRecord(value);
  if (!record) return undefined;
  const { agent, model, effort } = record;
  if (!isWireString(agent) || !isWireString(model)) return undefined;
  if (effort !== undefined && !isWireString(effort)) return undefined;
  const selection: WorkspaceAgentSelection =
    effort !== undefined ? { agent, model, effort } : { agent, model };
  return isListedWorkspaceAgentModel(providerId, selection) ? selection : undefined;
}

/**
 * The shape of an observed agent preset's name: agent kinds this build cannot
 * list come from a provider's own configuration, so the bound is on form
 * alone, and whether a kind is actually offered is answered where the
 * observation lives.
 */
const WORKSPACE_AGENT_KIND_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/u;

/**
 * Guards a kind-only selection arriving over IPC or read back from disk, for
 * the one workspace provider whose agents carry no models table. A value
 * carrying a model or an effort is refused rather than trimmed: the provider
 * documents no model choice, so such a value is not a selection it takes.
 */
export function parseWorkspaceAgentKindSelection(
  value: UnparsedWireValue,
): WorkspaceAgentKindSelection | undefined {
  const record = wireRecord(value);
  if (!record) return undefined;
  const { agent, model, effort } = record;
  if (model !== undefined || effort !== undefined) return undefined;
  if (!isWireString(agent) || !WORKSPACE_AGENT_KIND_PATTERN.test(agent)) return undefined;
  return { agent };
}
