import { ISSUE_TRACKER_ID } from "@sidecar/issues";
import { PROVIDER_ID, PROVIDER_IDENTITY_BY_ID } from "@sidecar/session";
import { isWireString, type UnparsedWireValue } from "@sidecar/wire";

/**
 * The services Luke can hold a credential for: the subset of the observed
 * providers whose sessions live in a cloud service with no local state to
 * read, plus the issue tracker Luke reads the same way — each of which must
 * observe nothing at all until the user connects it, by pasting a key or by
 * granting one on the provider's own consent page. Most ids are core's,
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
  REPLICAS: PROVIDER_ID.REPLICAS,
} as const;

export type CredentialProviderId =
  (typeof CREDENTIAL_PROVIDER_ID)[keyof typeof CREDENTIAL_PROVIDER_ID];

/**
 * How a service's credential is come by, which is the whole difference between
 * the two rows Settings draws for one. A key is the user's to fetch and paste,
 * so its row is a field and a page to go and get one from. A consent grant is
 * the provider's to issue over its own page in the user's browser, so its row
 * is a button and nothing to type. What is stored is the same either way —
 * encrypted at rest, read only in the main process — because a credential is a
 * credential however it arrived.
 */
export const CREDENTIAL_CONNECTION = {
  KEY: "key",
  CONSENT: "consent",
} as const;

export type CredentialConnection =
  (typeof CREDENTIAL_CONNECTION)[keyof typeof CREDENTIAL_CONNECTION];

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

const REPLICAS_ENVIRONMENT = {
  API_KEY: "REPLICAS_API_KEY",
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

/**
 * Where the user creates a key, said the same way for every provider: the
 * lead, then the destination drawn as the link that opens the provider's key
 * page, then a full stop and the caveat if there is one. Structured rather
 * than one string so the link can sit on the destination itself instead of
 * beside the sentence.
 */
export interface CredentialHint {
  /** The sentence up to the linked words: "Create a key in Jules under". */
  lead: string;
  /**
   * The linked words: the path to the key page, named the way the provider's
   * own site names it, with ">" between the steps. Pressing them opens
   * {@link CredentialProvider.apiKeysUrl}.
   */
  destination: string;
  /** A sentence after the link, only where the page alone can still go wrong. */
  caveat?: string;
}

export interface CredentialProvider {
  id: CredentialProviderId;
  displayName: string;
  /** How this provider's credential is come by, which decides what its row is. */
  connection: CredentialConnection;
  /**
   * Where the user creates a key, shown in the editor its row opens. Absent
   * for a provider connected by consent: there is no editor to say it in, and
   * nothing for the user to go and fetch.
   */
  hint?: CredentialHint;
  /**
   * The page that issues this provider's keys. It is opened by provider id
   * rather than by a URL the renderer supplies, so the only addresses Luke can
   * ever open are the ones in this file. Absent for a provider whose credential
   * is granted rather than pasted: there is no key page to send anyone to.
   */
  apiKeysUrl?: string;
  /** Read in order when nothing is stored for this provider. Empty for a grant. */
  environmentVariables: readonly string[];
  /** Present only for a provider that publishes more than one kind of key. */
  keyFormat?: CredentialFormat;
}

/**
 * Every provider this build ships, filed under its own id. Named as a contract
 * rather than annotated inline because what a caller reads back is the
 * interface — a provider looked up by id has the optional fields a provider
 * has, not only the ones the entry under that key happens to spell.
 */
interface CredentialProviderRegistry extends Record<CredentialProviderId, CredentialProvider> {}

/** Keyed by provider id so no caller has to build a key from an identifier. */
export const CREDENTIAL_PROVIDERS: CredentialProviderRegistry = {
  [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: {
    id: CREDENTIAL_PROVIDER_ID.CONDUCTOR,
    connection: CREDENTIAL_CONNECTION.KEY,
    displayName: PROVIDER_IDENTITY_BY_ID[PROVIDER_ID.CONDUCTOR].displayName,
    hint: { lead: "Create a key in Conductor under", destination: "Settings > API keys" },
    apiKeysUrl: "https://app.conductor.build/users/api-keys",
    environmentVariables: [CONDUCTOR_ENVIRONMENT.API_KEY, CONDUCTOR_ENVIRONMENT.API_TOKEN],
  },
  [CREDENTIAL_PROVIDER_ID.COPILOT]: {
    id: CREDENTIAL_PROVIDER_ID.COPILOT,
    connection: CREDENTIAL_CONNECTION.KEY,
    displayName: PROVIDER_IDENTITY_BY_ID[PROVIDER_ID.COPILOT].displayName,
    // GitHub's agent-tasks endpoints answer only user tokens. The copy names
    // the kind to create because the wrong kinds also come from GitHub: a
    // classic PAT cannot carry the Agent tasks permission, and an installation
    // token is refused by the endpoint itself.
    hint: {
      lead: "Create a fine-grained personal access token on GitHub under",
      destination: "Settings > Personal access tokens",
      caveat: "Give it Agent tasks read access; classic and installation tokens will not work.",
    },
    apiKeysUrl: "https://github.com/settings/personal-access-tokens/new",
    environmentVariables: [COPILOT_ENVIRONMENT.API_KEY],
    // No key format: Luke accepts two kinds GitHub issues — fine-grained
    // personal access tokens (`github_pat_…`) and GitHub App user tokens
    // (`ghu_…`) — so a single prefix would refuse a working credential.
  },
  [CREDENTIAL_PROVIDER_ID.CURSOR]: {
    id: CREDENTIAL_PROVIDER_ID.CURSOR,
    connection: CREDENTIAL_CONNECTION.KEY,
    displayName: PROVIDER_IDENTITY_BY_ID[PROVIDER_ID.CURSOR].displayName,
    hint: {
      lead: "Create a key in Cursor under",
      destination: "Dashboard > Integrations > API keys",
    },
    apiKeysUrl: "https://cursor.com/dashboard/api",
    environmentVariables: [CURSOR_ENVIRONMENT.API_KEY],
  },
  [CREDENTIAL_PROVIDER_ID.DEVIN]: {
    id: CREDENTIAL_PROVIDER_ID.DEVIN,
    connection: CREDENTIAL_CONNECTION.KEY,
    displayName: PROVIDER_IDENTITY_BY_ID[PROVIDER_ID.DEVIN].displayName,
    hint: {
      lead: "Create a personal access token in Devin under",
      destination: "Settings > Devin's API > PATs",
    },
    // Not the Settings > API keys page, which issues the deprecated `apk_`
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
    connection: CREDENTIAL_CONNECTION.KEY,
    displayName: PROVIDER_IDENTITY_BY_ID[PROVIDER_ID.JULES].displayName,
    // Jules shows a key once, on creation, and allows at most three at a time.
    hint: {
      lead: "Create a key in Jules under",
      destination: "Settings > API key",
      caveat: "It is shown only once.",
    },
    apiKeysUrl: "https://jules.google.com/settings",
    environmentVariables: [JULES_ENVIRONMENT.API_KEY],
  },
  [CREDENTIAL_PROVIDER_ID.LINEAR]: {
    id: CREDENTIAL_PROVIDER_ID.LINEAR,
    connection: CREDENTIAL_CONNECTION.CONSENT,
    displayName: "Linear",
    // No key page and no environment variable, alone among the providers:
    // nothing is pasted here, so there is nowhere to send anyone to fetch a
    // credential and nothing for a launch environment to supply. What the
    // consent page hands back is Linear's to shape, and it is withdrawn in
    // Linear's own settings as well as by disconnecting the row.
    environmentVariables: [],
  },
  [CREDENTIAL_PROVIDER_ID.OPENAI]: {
    id: CREDENTIAL_PROVIDER_ID.OPENAI,
    connection: CREDENTIAL_CONNECTION.KEY,
    // The service, plainly. The row stands inside the section that already
    // says what it is for — the other way voice can run — so the name has no
    // acronym to carry: "BYOK" named the choice for anyone who already knew
    // the word, and named nothing for everyone else.
    displayName: "OpenAI",
    // No description, alone among the providers, because its section says
    // everything one could: the toggle above the row names both sources and
    // what each costs, and the disclosure below it says what the key is spent
    // on and who bills for it. A sentence between them could only repeat one
    // of the two.
    // Realtime is what a spoken turn runs on, and an account that cannot reach
    // it fails at the first word rather than at the paste — so the line says so
    // before the key is entered rather than after.
    hint: {
      lead: "Create a key on the OpenAI platform under",
      destination: "API keys",
      caveat: "Talking uses the Realtime API, which needs billing enabled.",
    },
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
  [CREDENTIAL_PROVIDER_ID.REPLICAS]: {
    id: CREDENTIAL_PROVIDER_ID.REPLICAS,
    connection: CREDENTIAL_CONNECTION.KEY,
    displayName: PROVIDER_IDENTITY_BY_ID[PROVIDER_ID.REPLICAS].displayName,
    // Replicas issues organization keys and personal keys, and its API takes
    // either; the personal page is the one every member can reach.
    hint: {
      lead: "Create a key in Replicas under",
      destination: "Dashboard > Personal > API keys",
    },
    apiKeysUrl: "https://replicas.dev/dashboard/account/api-keys",
    environmentVariables: [REPLICAS_ENVIRONMENT.API_KEY],
    // No key format: Replicas publishes none, so a prefix could only refuse a
    // working key.
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

/** The coding-agent providers, in the order the Providers section lists them. */
export const CLOUD_AGENT_PROVIDER_LIST: readonly CredentialProvider[] =
  CREDENTIAL_PROVIDER_LIST.filter(
    (provider) => !INTEGRATION_IDS.has(provider.id) && provider.id !== VOICE_CREDENTIAL_PROVIDER_ID,
  );

/**
 * The services beyond the agents. The Integrations section draws each as its
 * own block rather than from this list — a consent row and a key row are not
 * the same line — so this stands for what belongs in that section, which is
 * what keeps the three lists together covering the whole registry.
 */
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
export function isCredentialProviderId(value: UnparsedWireValue): value is CredentialProviderId {
  return isWireString(value) && Object.hasOwn(CREDENTIAL_PROVIDERS, value);
}
