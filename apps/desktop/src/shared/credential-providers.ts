import { PROVIDER_ID } from "@sidecar/core";

/**
 * The providers Luke can hold a credential for: the subset of the observed
 * providers whose sessions live in a cloud service with no local state to read,
 * and which must observe nothing at all until the user supplies a key. The ids
 * are core's, so a credential row and a session row name the same provider —
 * that is what lets one mark registry serve both.
 */
export const CREDENTIAL_PROVIDER_ID = {
  CONDUCTOR: PROVIDER_ID.CONDUCTOR,
  CURSOR: PROVIDER_ID.CURSOR,
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

const CURSOR_ENVIRONMENT = {
  API_KEY: "CURSOR_API_KEY",
} as const;

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
  [CREDENTIAL_PROVIDER_ID.CURSOR]: {
    id: CREDENTIAL_PROVIDER_ID.CURSOR,
    displayName: "Cursor",
    hint: "Create a key in the Cursor dashboard under Integrations · API keys.",
    apiKeysUrl: "https://cursor.com/dashboard/api",
    environmentVariables: [CURSOR_ENVIRONMENT.API_KEY],
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
