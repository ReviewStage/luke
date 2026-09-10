import type { CredentialProvider } from "@sidecar/credentials/vocabulary";
import {
  PROVIDER_ID,
  type ProviderId,
  type WorkspaceAgentSelection,
  workspaceAgentModels,
} from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import type { AppSettingsView } from "@sidecar/settings/wire";
import type { ActionResult } from "@sidecar/wire";
import { APP_SETTING_ID } from "../luke-guide";
import { defaultProjectRowId } from "../settings-anchors";
import type { SupersetControl, WorkspaceProviderOption } from "./controls";
import { SelectRow } from "./select-row";
import { useSettingWrite } from "./use-setting-write";
import type { SettingsWrites } from "./writes";

/* The word for no choice at all, shared by every row here: the agent row's
   "the provider's own default" and the project rows' "ask each time" are the
   same absence, and an empty value for the same reason — no model, effort, or
   project id can collide with it. */
const PROVIDER_DEFAULT_VALUE = "";

/**
 * Which model — and, where its agent takes one, which effort — this provider
 * starts new workspaces with, drawn as sub-rows of its credential line
 * because the choice means nothing until the key above it connects. The
 * options are the build's documented table for the provider, worded as the
 * names people know the models by; the first is no choice at all — the
 * provider's own default, which is the state every install begins in. The
 * effort row exists only while a model whose agent documents effort levels is
 * chosen, so nothing offers a level nowhere can honour.
 */
export function WorkspaceAgentRow({
  provider,
  providerId,
  selection,
  onChange,
}: {
  provider: CredentialProvider;
  providerId: ProviderId;
  selection?: WorkspaceAgentSelection;
  onChange: (
    providerId: ProviderId,
    selection: WorkspaceAgentSelection | undefined,
  ) => Promise<ActionResult>;
}): React.JSX.Element {
  // The table's models flattened in its own order, each remembering its
  // agent's effort levels, so the select's indices are as stable as the build
  // that documents them.
  const choices = workspaceAgentModels(providerId).flatMap((entry) =>
    entry.models.map((model) => ({
      agent: entry.agent,
      model: model.id,
      label: model.label,
      efforts: entry.efforts,
    })),
  );
  const chosenIndex = choices.findIndex(
    (choice) => choice.agent === selection?.agent && choice.model === selection?.model,
  );
  const chosen = chosenIndex >= 0 ? choices[chosenIndex] : undefined;
  const providerDefault = `${provider.displayName}'s default`;
  // One rest for both pop-ups: they write the same stored pairing, so a model
  // change in flight must still the effort row and the other way around —
  // otherwise two saves can finish out of order and keep whichever answered last.
  const write = useSettingWrite((next: WorkspaceAgentSelection | undefined) =>
    onChange(providerId, next),
  );
  // Only Conductor's rows are searchable today — the one provider the build
  // documents a table for — so only its rows wear the anchors.
  const conductor = providerId === PROVIDER_ID.CONDUCTOR;
  return (
    <>
      <SelectRow
        label="New agents run"
        {...(conductor ? { anchor: APP_SETTING_ID.WORKSPACE_AGENT_MODEL } : undefined)}
        ariaLabel={`The model new ${provider.displayName} workspaces run`}
        value={chosenIndex >= 0 ? String(chosenIndex) : PROVIDER_DEFAULT_VALUE}
        options={[
          { value: PROVIDER_DEFAULT_VALUE, label: providerDefault },
          // Indexed on purpose: the list is fixed by the build, and the
          // index is the same word the select's value speaks.
          ...choices.map((choice, index) => ({
            value: String(index),
            label: choice.label,
          })),
        ]}
        parse={(raw) => {
          if (raw === PROVIDER_DEFAULT_VALUE) return raw;
          // The set is the one this row offered, so anything else arriving
          // out of the select is a broken control rather than a choice.
          return choices[Number(raw)] ? raw : undefined;
        }}
        changed={selection !== undefined}
        busy={write.busy}
        onChange={(next) => {
          if (next === PROVIDER_DEFAULT_VALUE) {
            write.run(undefined);
            return;
          }
          const choice = choices[Number(next)];
          if (!choice) return;
          // A chosen effort survives a model change only where the new
          // agent documents the same level; anywhere else it returns to
          // the provider's default rather than riding somewhere unlisted.
          const effort =
            selection?.effort && choice.efforts.includes(selection.effort)
              ? selection.effort
              : undefined;
          write.run({
            agent: choice.agent,
            model: choice.model,
            ...(effort ? { effort } : undefined),
          });
        }}
      />
      {chosen && chosen.efforts.length > 0 ? (
        <SelectRow
          label="Effort"
          {...(conductor ? { anchor: APP_SETTING_ID.WORKSPACE_AGENT_EFFORT } : undefined)}
          ariaLabel={`The effort new ${provider.displayName} agents think at`}
          value={
            selection?.effort && chosen.efforts.includes(selection.effort)
              ? selection.effort
              : PROVIDER_DEFAULT_VALUE
          }
          options={[
            { value: PROVIDER_DEFAULT_VALUE, label: providerDefault },
            ...chosen.efforts.map((effort) => ({ value: effort, label: effort })),
          ]}
          parse={(raw) => {
            if (raw === PROVIDER_DEFAULT_VALUE) return raw;
            // Held to the chosen agent's own documented levels, so the
            // stored selection is always one whole the table lists.
            return chosen.efforts.includes(raw) ? raw : undefined;
          }}
          changed={selection?.effort !== undefined}
          busy={write.busy}
          onChange={(next) => {
            const effort = next !== PROVIDER_DEFAULT_VALUE ? next : undefined;
            write.run({
              agent: chosen.agent,
              model: chosen.model,
              ...(effort ? { effort } : undefined),
            });
          }}
        />
      ) : null}
      {write.rejection ? (
        <p className="error-message" role="alert">
          {write.rejection}
        </p>
      ) : null}
    </>
  );
}

/**
 * Where one provider's nameless creation ask lands: filled in the way the
 * provider default is — by the first creation there — and this select is where
 * that choice is seen, changed, or returned to the first creation. Drawn under
 * its own provider, beside what a new agent there runs, because both answer
 * the same question about the same provider; the label leaves the provider to
 * the heading above it and the aria-label carries it for a reader arriving
 * without that context.
 */
export function WorkspaceProjectRow({
  provider,
  settings,
  writes,
}: {
  provider: WorkspaceProviderOption;
  settings: AppSettingsView;
  writes: SettingsWrites;
}): React.JSX.Element | null {
  const providerId = provider.id;
  // A provider this build cannot store a choice for, or one with no projects
  // to choose between, has nothing for the row to say.
  if (provider.projects.length === 0) return null;
  // Several providers draw this row, so each anchors by its own provider —
  // absent where the search's table does not name one.
  const anchor = defaultProjectRowId(providerId);
  const stored = settings.workspaceProjectDefaults?.[providerId];
  // A stored default the provider has stopped offering is on its way out: the
  // main process clears it on the same observation, and until that write lands
  // the row reads as the unchosen state it is about to become. Drawing the
  // stored value instead would leave the select on an option it does not hold.
  const shown =
    stored !== undefined && provider.projects.some((project) => project.id === stored)
      ? stored
      : PROVIDER_DEFAULT_VALUE;
  return (
    <SelectRow
      label="Default project"
      {...(anchor ? { anchor } : undefined)}
      ariaLabel={`The project a nameless ask creates ${provider.name} workspaces in`}
      changed={shown !== PROVIDER_DEFAULT_VALUE}
      value={shown}
      options={[
        // The provider row's own words for the same state: until a default
        // exists, an ambiguous ask is asked about, and the two rows should
        // say that identically.
        { value: PROVIDER_DEFAULT_VALUE, label: "Ask each time" },
        ...provider.projects.map((project) => ({ value: project.id, label: project.label })),
      ]}
      parse={(raw) => {
        if (raw === PROVIDER_DEFAULT_VALUE) return raw;
        // The set is the one this row offered, so anything else arriving out
        // of the select is a broken control rather than a choice.
        return provider.projects.some((project) => project.id === raw) ? raw : undefined;
      }}
      onChange={(next) =>
        writes.entry(
          APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
          providerId,
          next === PROVIDER_DEFAULT_VALUE ? undefined : next,
        )
      }
    />
  );
}

/**
 * Which agent new Superset sessions run: the choice is the CLI's own list of
 * agents, so it means nothing until the login above it connects, and the first
 * option is no choice at all — an ambiguous ask is asked about, the same words
 * the Default project row uses for the same state.
 */
export function SupersetAgentRow({ control }: { control: SupersetControl }): React.JSX.Element {
  return (
    <SelectRow
      label="New Superset sessions run"
      anchor={APP_SETTING_ID.SUPERSET_AGENT}
      ariaLabel="Default agent for new Superset sessions"
      changed={control.defaultAgent !== undefined}
      value={control.defaultAgent ?? PROVIDER_DEFAULT_VALUE}
      options={[
        { value: PROVIDER_DEFAULT_VALUE, label: "Ask each time" },
        ...control.agents.map((agent) => ({ value: agent, label: agent })),
      ]}
      parse={(raw) =>
        raw === PROVIDER_DEFAULT_VALUE || control.agents.includes(raw) ? raw : undefined
      }
      onChange={(agent) =>
        control.onDefaultAgentChange(agent === PROVIDER_DEFAULT_VALUE ? undefined : agent)
      }
    />
  );
}
