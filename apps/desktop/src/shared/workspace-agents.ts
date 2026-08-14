import {
  isProviderId,
  PROVIDER_ID,
  type ProviderId,
  type WorkspaceAgentModels,
  type WorkspaceAgentSelection,
} from "@sidecar/core";

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
export const WORKSPACE_AGENT_MODELS: Readonly<
  Partial<Record<ProviderId, readonly WorkspaceAgentModels[]>>
> = {
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
};

/** The table for one provider, or nothing where none is documented. */
export function workspaceAgentModels(providerId: string): readonly WorkspaceAgentModels[] {
  return isProviderId(providerId) ? (WORKSPACE_AGENT_MODELS[providerId] ?? []) : [];
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
export function isWorkspaceAgentSelection(
  providerId: string,
  value: unknown,
): value is WorkspaceAgentSelection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const { agent, model, effort } = value as Record<string, unknown>;
  if (typeof agent !== "string" || typeof model !== "string") return false;
  if (effort !== undefined && typeof effort !== "string") return false;
  return isListedWorkspaceAgentModel(providerId, {
    agent,
    model,
    ...(effort !== undefined ? { effort } : {}),
  });
}
