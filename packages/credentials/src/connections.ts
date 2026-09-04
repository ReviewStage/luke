import { CREDENTIAL_CONNECTION } from "./credential-providers.js";

/**
 * How a service comes to be observable at all. A key and a consent grant are
 * the two credentials Luke stores, and reuse the credential vocabulary so a
 * declaration and a stored credential agree by construction. A CLI login is
 * observed at one remove — the user signed the provider's own binary in, and
 * Luke never sees the credential — and a local service needs nothing: its
 * files are already on this machine.
 */
export const CONNECTION_KIND = {
  KEY: CREDENTIAL_CONNECTION.KEY,
  CONSENT: CREDENTIAL_CONNECTION.CONSENT,
  CLI_LOGIN: "cli-login",
  LOCAL: "local",
} as const;

export type ConnectionKind = (typeof CONNECTION_KIND)[keyof typeof CONNECTION_KIND];
