import { CREDENTIAL_PROVIDER_ID, CREDENTIAL_SOURCE } from "@sidecar/credentials/vocabulary";
import { settingsView } from "@sidecar/settings/testing";
import { VOICE_SOURCE } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import type { ConnectionInput, ConnectionVisibility } from "../renderer/settings/connection-schema";

/** Nothing connected, nothing installed, no account: what a first launch draws. */
export function connectionVisibility(
  overrides: Partial<ConnectionVisibility> = {},
): ConnectionVisibility {
  return {
    settings: settingsView(),
    accountDrawn: false,
    supersetInstalled: false,
    workspaceProjects: [],
    ...overrides,
  };
}

/** Everything this build can offer, so every row in the table stands. */
export function everyConnectionOffered(): ConnectionVisibility {
  return connectionVisibility({
    settings: settingsView({
      voiceSource: VOICE_SOURCE.KEY,
      linearSignInAvailable: true,
      calendarSignInAvailable: true,
      appleCalendarAvailable: true,
    }),
    accountDrawn: true,
    supersetInstalled: true,
  });
}

/**
 * Every connection connected and every action wired to nothing, so a test can
 * read what the table declares without standing up the panel around it.
 */
export function connectionInput(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  const accepted = async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }) as const;
  return {
    visibility: everyConnectionOffered(),
    settings: settingsView({
      voiceSource: VOICE_SOURCE.KEY,
      linearSignInAvailable: true,
      calendarSignInAvailable: true,
      appleCalendarAvailable: true,
      credentialSources: {
        [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: CREDENTIAL_SOURCE.ENCRYPTED_FILE,
        [CREDENTIAL_PROVIDER_ID.LINEAR]: CREDENTIAL_SOURCE.ENCRYPTED_FILE,
        [CREDENTIAL_PROVIDER_ID.OPENAI]: CREDENTIAL_SOURCE.ENCRYPTED_FILE,
      },
    }),
    credentials: {
      begin: () => undefined,
      connect: () => undefined,
      change: () => undefined,
      fetchKey: () => undefined,
      cancel: () => undefined,
      commit: () => undefined,
      remove: accepted,
    },
    calendar: {
      choices: [],
      held: false,
      connecting: false,
      onSignIn: () => undefined,
      onRemoveAccount: accepted,
      onToggleCalendar: accepted,
      onRefresh: async () => undefined,
    },
    appleCalendar: {
      choices: [],
      held: false,
      connecting: false,
      revoked: false,
      onSignIn: () => undefined,
      onDisconnect: accepted,
      onToggleCalendar: accepted,
    },
    linear: { held: false, connecting: false, onSignIn: () => undefined, onDisconnect: accepted },
    superset: {
      installed: true,
      connected: true,
      held: false,
      connecting: false,
      agents: [],
      onConnect: () => undefined,
      onDisconnect: accepted,
      onDefaultAgentChange: accepted,
    },
    workspaceProviders: [],
    writes: { setting: accepted, entry: accepted, reset: accepted },
    panelOpen: true,
    refreshing: false,
    onRefreshCalendars: () => undefined,
    ...overrides,
  };
}
