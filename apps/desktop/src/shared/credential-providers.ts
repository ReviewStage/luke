/**
 * The providers Luke can hold a credential for. A provider belongs here only
 * when its sessions live in a cloud service with no local state to observe, and
 * it must observe nothing at all until the user supplies a key.
 */
export const CREDENTIAL_PROVIDER_ID = {
  CONDUCTOR: "conductor",
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

export interface CredentialProvider {
  id: CredentialProviderId;
  displayName: string;
  /** Where the user creates a key, shown beside that provider's field. */
  hint: string;
  /** Read in order when nothing is stored for this provider. */
  environmentVariables: readonly string[];
}

/** Keyed by provider id so no caller has to build a key from an identifier. */
export const CREDENTIAL_PROVIDERS: Readonly<Record<CredentialProviderId, CredentialProvider>> = {
  [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: {
    id: CREDENTIAL_PROVIDER_ID.CONDUCTOR,
    displayName: "Conductor",
    hint: "Create a key in Conductor under Settings · API keys.",
    environmentVariables: [CONDUCTOR_ENVIRONMENT.API_KEY, CONDUCTOR_ENVIRONMENT.API_TOKEN],
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
