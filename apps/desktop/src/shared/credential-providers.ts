import { ISSUE_TRACKER_ID, PROVIDER_ID } from "@sidecar/core";

/**
 * The services Luke can hold a credential for: the subset of the observed
 * providers whose sessions live in a cloud service with no local state to
 * read, plus the issue tracker Luke reads the same way — each of which must
 * observe nothing at all until the user supplies a key. The ids are core's,
 * so a credential row names the same service a session row or the issue
 * roster does — that is what lets one mark registry serve them all.
 */
export const CREDENTIAL_PROVIDER_ID = {
  CONDUCTOR: PROVIDER_ID.CONDUCTOR,
  COPILOT: PROVIDER_ID.COPILOT,
  CURSOR: PROVIDER_ID.CURSOR,
  DEVIN: PROVIDER_ID.DEVIN,
  JULES: PROVIDER_ID.JULES,
  LINEAR: ISSUE_TRACKER_ID.LINEAR,
} as const;

export type CredentialProviderId =
  (typeof CREDENTIAL_PROVIDER_ID)[keyof typeof CREDENTIAL_PROVIDER_ID];

/**
 * `<PROVIDER>_API_KEY` is the convention every provider follows. A provider may
 * name additional variables it also honours.
 */
const CONDUCTOR_ENVIRONMENT = {
  API_KEY: "CONDUCTOR_API_KEY",
  API_TOKEN: "CONDUCTOR_API_TOKEN",
} as const;

const COPILOT_ENVIRONMENT = {
  API_KEY: "COPILOT_API_KEY",
} as const;

const CURSOR_ENVIRONMENT = {
  API_KEY: "CURSOR_API_KEY",
} as const;

const DEVIN_ENVIRONMENT = {
  API_KEY: "DEVIN_API_KEY",
} as const;

const JULES_ENVIRONMENT = {
  API_KEY: "JULES_API_KEY",
} as const;

const LINEAR_ENVIRONMENT = {
  API_KEY: "LINEAR_API_KEY",
} as const;

/**
 * The only kind of credential Luke will hold for a provider that issues more
 * than one. Only a provider that publishes a format declares this; the rest
 * accept any key the provider might issue, because guessing at a format Luke
 * cannot check would reject a working key.
 */
export interface CredentialFormat {
  /**
   * What the provider itself calls this credential, used wherever the panel
   * would otherwise say "API key". Asking for the wrong noun sends the user to
   * the wrong page, which for Devin is the one issuing the keys Luke refuses.
   */
  label: string;
  prefix: string;
  /** Said to the user when a key does not carry it, never echoing the key. */
  rejection: string;
}

export interface CredentialProvider {
  id: CredentialProviderId;
  displayName: string;
  /** Where the user creates a key, shown beside that provider's field. */
  hint: string;
  /**
   * The page that issues this provider's keys. It is opened by provider id
   * rather than by a URL the renderer supplies, so the only addresses Luke can
   * ever open are the ones in this file.
   */
  apiKeysUrl: string;
  /** Read in order when nothing is stored for this provider. */
  environmentVariables: readonly string[];
  /** Present only for a provider that publishes more than one kind of key. */
  keyFormat?: CredentialFormat;
}

/** Keyed by provider id so no caller has to build a key from an identifier. */
export const CREDENTIAL_PROVIDERS: Readonly<Record<CredentialProviderId, CredentialProvider>> = {
  [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: {
    id: CREDENTIAL_PROVIDER_ID.CONDUCTOR,
    displayName: "Conductor",
    hint: "Create a key in Conductor under Settings · API keys.",
    apiKeysUrl: "https://app.conductor.build/users/api-keys",
    environmentVariables: [CONDUCTOR_ENVIRONMENT.API_KEY, CONDUCTOR_ENVIRONMENT.API_TOKEN],
  },
  [CREDENTIAL_PROVIDER_ID.COPILOT]: {
    id: CREDENTIAL_PROVIDER_ID.COPILOT,
    displayName: "Copilot",
    // GitHub's agent-tasks endpoints answer only user tokens. The copy names
    // the kind to create because the wrong kinds also come from GitHub: a
    // classic PAT cannot carry the Agent tasks permission, and an installation
    // token is refused by the endpoint itself.
    hint: "Create a GitHub fine-grained personal access token with Agent tasks read access. Classic and installation tokens will not work.",
    apiKeysUrl: "https://github.com/settings/personal-access-tokens/new",
    environmentVariables: [COPILOT_ENVIRONMENT.API_KEY],
    // No key format: Luke accepts two kinds GitHub issues — fine-grained
    // personal access tokens (`github_pat_…`) and GitHub App user tokens
    // (`ghu_…`) — so a single prefix would refuse a working credential.
  },
  [CREDENTIAL_PROVIDER_ID.CURSOR]: {
    id: CREDENTIAL_PROVIDER_ID.CURSOR,
    displayName: "Cursor",
    hint: "Create a key in the Cursor dashboard under Integrations · API keys.",
    apiKeysUrl: "https://cursor.com/dashboard/api",
    environmentVariables: [CURSOR_ENVIRONMENT.API_KEY],
  },
  [CREDENTIAL_PROVIDER_ID.DEVIN]: {
    id: CREDENTIAL_PROVIDER_ID.DEVIN,
    displayName: "Devin",
    hint: "Create one on the Devin API settings page, under PATs.",
    // Not the Settings · API keys page, which issues the deprecated `apk_`
    // keys Luke refuses. Personal access tokens live on their own tab.
    apiKeysUrl: "https://app.devin.ai/settings/devin-api?tab=pats",
    environmentVariables: [DEVIN_ENVIRONMENT.API_KEY],
    // Devin observes through its v3 API, which every current credential is
    // issued for and which every legacy one — the deprecated `apk_` and
    // `apk_user_` keys of v1 and v2 — is not. A legacy key would be refused by
    // Devin on the first request, and a credential Luke cannot use is worth
    // saying so about rather than storing and going quiet. Which *kind* of
    // `cog_` credential it is, a person's or an organization's, is not
    // something a prefix can tell: Devin answers that itself, and the adapter
    // asks it on every pass.
    keyFormat: {
      label: "Personal access token",
      prefix: "cog_",
      rejection:
        "Devin's personal access tokens start with cog_. The older apk_ keys are for an API version Luke does not read.",
    },
  },
  [CREDENTIAL_PROVIDER_ID.JULES]: {
    id: CREDENTIAL_PROVIDER_ID.JULES,
    displayName: "Jules",
    // Jules shows a key once, on creation, and allows at most three at a time.
    hint: "Create a key in Jules under Settings · API key. It is shown only once.",
    apiKeysUrl: "https://jules.google.com/settings",
    environmentVariables: [JULES_ENVIRONMENT.API_KEY],
  },
  [CREDENTIAL_PROVIDER_ID.LINEAR]: {
    id: CREDENTIAL_PROVIDER_ID.LINEAR,
    displayName: "Linear",
    hint: "Create a personal API key in Linear under Settings · Security & access.",
    apiKeysUrl: "https://linear.app/settings/account/security",
    environmentVariables: [LINEAR_ENVIRONMENT.API_KEY],
    // Linear issues its personal API keys under one prefix; an OAuth access
    // token belongs to an application acting for a workspace, which is not
    // what Luke is, so a credential without the prefix would only mislead.
    keyFormat: {
      label: "Personal API key",
      prefix: "lin_api_",
      rejection:
        "Linear's personal API keys start with lin_api_. OAuth tokens belong to an application rather than to Luke.",
    },
  },
};

/** Settings lists providers in this order. */
export const CREDENTIAL_PROVIDER_LIST: readonly CredentialProvider[] =
  Object.values(CREDENTIAL_PROVIDERS);

/**
 * Guards the provider id an IPC message carries. `hasOwn` rather than `in`: an
 * inherited name such as `toString` is not a provider.
 */
export function isCredentialProviderId(value: unknown): value is CredentialProviderId {
  return typeof value === "string" && Object.hasOwn(CREDENTIAL_PROVIDERS, value);
}
