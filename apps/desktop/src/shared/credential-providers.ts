import { ISSUE_TRACKER_ID, PROVIDER_ID } from "@sidecar/core";

/**
 * The services Luke can hold a credential for: the subset of the observed
 * providers whose sessions live in a cloud service with no local state to
 * read, plus the issue tracker Luke reads the same way — each of which must
 * observe nothing at all until the user supplies a key. Most ids are core's,
 * so a credential row names the same service a session row or the issue
 * roster does — that is what lets one mark registry serve them all.
 *
 * OpenAI is the one that names nothing elsewhere, so it carries an id of its
 * own: Luke speaks through it rather than observing it, and there are no OpenAI
 * sessions or issues for a row to belong to. It belongs here all the same,
 * because a credential the app cannot be given is a feature the app does not
 * have — and an app opened from Finder has no launch environment to read one
 * from.
 */
export const CREDENTIAL_PROVIDER_ID = {
  CONDUCTOR: PROVIDER_ID.CONDUCTOR,
  COPILOT: PROVIDER_ID.COPILOT,
  CURSOR: PROVIDER_ID.CURSOR,
  DEVIN: PROVIDER_ID.DEVIN,
  JULES: PROVIDER_ID.JULES,
  LINEAR: ISSUE_TRACKER_ID.LINEAR,
  OPENAI: "openai",
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
  /**
   * What connecting this service lets Luke do, said in one line under its row.
   * Only an integration carries one: an agent provider's rows say it once for
   * the whole section, because every key there buys the same observation.
   */
  description?: string;
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
    description: "Luke reads your issues and can move or comment on them when you ask.",
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
  [CREDENTIAL_PROVIDER_ID.OPENAI]: {
    id: CREDENTIAL_PROVIDER_ID.OPENAI,
    // "BYOK" — bring your own key — because the row's whole meaning is the
    // choice it offers against the account's included allowance beside it.
    displayName: "OpenAI BYOK",
    // The panel writes apostrophes as `&rsquo;` in JSX and this string is read
    // as text, so the apostrophe here is the typographic one rather than a
    // straight quote.
    description: "The API key for Luke’s voice capabilities.",
    // Realtime is what a spoken turn runs on, and an account that cannot reach
    // it fails at the first word rather than at the paste — so the line says so
    // before the key is entered rather than after.
    hint: "Create a key on the OpenAI platform under API keys. Talking uses the Realtime API, which needs billing enabled.",
    apiKeysUrl: "https://platform.openai.com/api-keys",
    // Deliberately no environment fallback, alone among the providers: an
    // `OPENAI_API_KEY` exported for some other tool would silently start
    // spending itself on voice and move review off the hosted path — a key
    // that costs money and changes where session fields travel is connected
    // by hand or not at all.
    environmentVariables: [],
    // No key format. Every kind OpenAI issues carries `sk-`, so a prefix would
    // refuse nothing, and which of them can reach Realtime is something only
    // OpenAI can answer — it answers it on the first mint.
  },
};

/** Every provider that can hold a key, in the order Settings lists them. */
export const CREDENTIAL_PROVIDER_LIST: readonly CredentialProvider[] =
  Object.values(CREDENTIAL_PROVIDERS);

/* A key is a key, so every service lives in the one provider registry — but
   Settings draws these apart: an integration is a service Luke uses, not an
   agent whose sessions he observes. The tracker is one he reads and acts on. */
const INTEGRATION_IDS: ReadonlySet<CredentialProviderId> = new Set([CREDENTIAL_PROVIDER_ID.LINEAR]);

/**
 * The one key Luke speaks through, and asks about a session with. Named here so
 * the main process reads it by what it is for rather than by an id spelled out
 * at each of the places that build something from it. Its row lives on the
 * Voice page rather than under Connections, because the key is what turns
 * voice on and the page that goes quiet without one is where that is learned.
 */
export const VOICE_CREDENTIAL_PROVIDER_ID = CREDENTIAL_PROVIDER_ID.OPENAI;

/** The one provider the Voice page holds a key for. */
export const VOICE_CREDENTIAL_PROVIDER: CredentialProvider =
  CREDENTIAL_PROVIDERS[VOICE_CREDENTIAL_PROVIDER_ID];

/** The coding-agent providers, in the order the Cloud Agent API keys section lists them. */
export const CLOUD_AGENT_PROVIDER_LIST: readonly CredentialProvider[] =
  CREDENTIAL_PROVIDER_LIST.filter(
    (provider) => !INTEGRATION_IDS.has(provider.id) && provider.id !== VOICE_CREDENTIAL_PROVIDER_ID,
  );

/** The services beyond the agents, in the order the Integrations section lists them. */
export const INTEGRATION_PROVIDER_LIST: readonly CredentialProvider[] =
  CREDENTIAL_PROVIDER_LIST.filter((provider) => INTEGRATION_IDS.has(provider.id));

/**
 * Whether this provider's key buys the observation of cloud sessions, which is
 * what the cloud badge on a mark says. Linear's issues and OpenAI's voice are
 * services Luke uses rather than sessions he watches, so their marks carry no
 * badge — a badge there would claim sessions neither service has.
 */
export function providerRunsSessionsInCloud(id: CredentialProviderId): boolean {
  return !INTEGRATION_IDS.has(id) && id !== VOICE_CREDENTIAL_PROVIDER_ID;
}

/**
 * Guards the provider id an IPC message carries. `hasOwn` rather than `in`: an
 * inherited name such as `toString` is not a provider.
 */
export function isCredentialProviderId(value: unknown): value is CredentialProviderId {
  return typeof value === "string" && Object.hasOwn(CREDENTIAL_PROVIDERS, value);
}
