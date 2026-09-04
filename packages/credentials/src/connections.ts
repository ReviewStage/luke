import { ISSUE_TRACKER_ID } from "@sidecar/issues";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  PROVIDER_ID,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  workspaceProviderDisplayName,
} from "@sidecar/session";
import {
  CREDENTIAL_CONNECTION,
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  type CredentialProvider,
  type CredentialProviderId,
} from "./credential-providers.js";

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

/** Which Settings section draws a connection's row. */
export const CONNECTION_SECTION = {
  PROVIDERS: "providers",
  INTEGRATIONS: "integrations",
  VOICE: "voice",
} as const;

export type ConnectionSection = (typeof CONNECTION_SECTION)[keyof typeof CONNECTION_SECTION];

/**
 * What a CLI-login row does when the CLI is not on this machine: Superset's
 * row is not drawn at all, since its bundled CLI arrives with the app it
 * connects; Codex's row says so, because the login is a step the developer
 * can take.
 */
export const CLI_ABSENCE = {
  HIDDEN: "hidden",
  REPORTED: "reported",
} as const;

export type CliAbsence = (typeof CLI_ABSENCE)[keyof typeof CLI_ABSENCE];

/**
 * Every connection Settings draws a row for. Most ids are the ids their
 * sessions, workspaces, or issues already answer to, so a connection row
 * names the same service everything else does.
 */
export const CONNECTION_ID = {
  CODEX: PROVIDER_ID.CODEX,
  CONDUCTOR: PROVIDER_ID.CONDUCTOR,
  CONDUCTOR_LOCAL: CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  SUPERSET: SUPERSET_WORKSPACE_PROVIDER_ID,
  LINEAR: ISSUE_TRACKER_ID.LINEAR,
  OPENAI: CREDENTIAL_PROVIDER_ID.OPENAI,
} as const;

export type ConnectionId = (typeof CONNECTION_ID)[keyof typeof CONNECTION_ID];

export interface CliLoginDeclaration {
  /** The command the developer runs in their own terminal to connect. */
  loginCommand: string;
  absence: CliAbsence;
  /** Whether Luke offers to run the login itself, from a button on the row. */
  interactiveSignIn: boolean;
  /** What the CLI calls the thing a sign-in may ask the developer to choose. */
  scopeNoun?: string;
}

/**
 * One connection as Settings, Luke's guide, and the main process know it.
 * A declaration says how the service connects and where its row is drawn; it
 * grants nothing, and every act behind a row still runs through that row's
 * own documented endpoint.
 */
export interface ConnectionDeclaration {
  id: ConnectionId;
  kind: ConnectionKind;
  section: ConnectionSection;
  displayName: string;
  /** The stored credential, for a key or consent row. */
  credential?: CredentialProvider;
  cliLogin?: CliLoginDeclaration;
  /** The row this one is drawn under, as a nested block. */
  nestsUnder?: ConnectionId;
  /** Whether a connected row may offer workspace projects to create in. */
  offersProjects: boolean;
  /** Whether the connection buys the observation of sessions in a cloud service. */
  sessionsInCloud: boolean;
}

export const CONNECTIONS = {
  [CONNECTION_ID.CODEX]: {
    id: CONNECTION_ID.CODEX,
    kind: CONNECTION_KIND.CLI_LOGIN,
    section: CONNECTION_SECTION.PROVIDERS,
    displayName: workspaceProviderDisplayName(PROVIDER_ID.CODEX),
    cliLogin: {
      loginCommand: "codex login",
      absence: CLI_ABSENCE.REPORTED,
      interactiveSignIn: false,
    },
    offersProjects: true,
    sessionsInCloud: true,
  },
  [CONNECTION_ID.CONDUCTOR]: {
    id: CONNECTION_ID.CONDUCTOR,
    kind: CONNECTION_KIND.KEY,
    section: CONNECTION_SECTION.PROVIDERS,
    displayName: workspaceProviderDisplayName(PROVIDER_ID.CONDUCTOR),
    credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.CONDUCTOR],
    offersProjects: true,
    sessionsInCloud: true,
  },
  [CONNECTION_ID.CONDUCTOR_LOCAL]: {
    id: CONNECTION_ID.CONDUCTOR_LOCAL,
    kind: CONNECTION_KIND.LOCAL,
    section: CONNECTION_SECTION.PROVIDERS,
    displayName: workspaceProviderDisplayName(CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID),
    nestsUnder: CONNECTION_ID.CONDUCTOR,
    offersProjects: true,
    sessionsInCloud: false,
  },
  [CONNECTION_ID.SUPERSET]: {
    id: CONNECTION_ID.SUPERSET,
    kind: CONNECTION_KIND.CLI_LOGIN,
    section: CONNECTION_SECTION.PROVIDERS,
    displayName: workspaceProviderDisplayName(SUPERSET_WORKSPACE_PROVIDER_ID),
    cliLogin: {
      loginCommand: "superset auth login",
      absence: CLI_ABSENCE.HIDDEN,
      interactiveSignIn: true,
      scopeNoun: "organization",
    },
    offersProjects: true,
    sessionsInCloud: false,
  },
  [CONNECTION_ID.LINEAR]: {
    id: CONNECTION_ID.LINEAR,
    kind: CONNECTION_KIND.CONSENT,
    section: CONNECTION_SECTION.INTEGRATIONS,
    displayName: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.LINEAR].displayName,
    credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.LINEAR],
    offersProjects: false,
    sessionsInCloud: false,
  },
  [CONNECTION_ID.OPENAI]: {
    id: CONNECTION_ID.OPENAI,
    kind: CONNECTION_KIND.KEY,
    section: CONNECTION_SECTION.VOICE,
    displayName: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.OPENAI].displayName,
    credential: CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.OPENAI],
    offersProjects: false,
    sessionsInCloud: false,
  },
} as const satisfies Readonly<Record<ConnectionId, ConnectionDeclaration>>;

/** One connection's row, widened from its literal shape to the declared contract. */
export function connectionDeclaration(id: ConnectionId): ConnectionDeclaration {
  return CONNECTIONS[id];
}

/** Every connection in the order Settings draws them, section by section. */
export const CONNECTION_LIST: readonly ConnectionDeclaration[] = [
  CONNECTIONS[CONNECTION_ID.CODEX],
  CONNECTIONS[CONNECTION_ID.CONDUCTOR],
  CONNECTIONS[CONNECTION_ID.CONDUCTOR_LOCAL],
  CONNECTIONS[CONNECTION_ID.SUPERSET],
  CONNECTIONS[CONNECTION_ID.LINEAR],
  CONNECTIONS[CONNECTION_ID.OPENAI],
];

type ConnectionsOfKind<Kind extends ConnectionKind> = {
  [Id in ConnectionId]: (typeof CONNECTIONS)[Id]["kind"] extends Kind ? Id : never;
}[ConnectionId];

/** The connections observed through a CLI's own login. */
export type CliLoginConnectionId = ConnectionsOfKind<typeof CONNECTION_KIND.CLI_LOGIN>;

/** The connections granted on the service's own consent page. */
export type ConsentConnectionId = ConnectionsOfKind<typeof CONNECTION_KIND.CONSENT>;

export const CLI_LOGIN_CONNECTION_IDS: readonly CliLoginConnectionId[] = [
  CONNECTION_ID.CODEX,
  CONNECTION_ID.SUPERSET,
];

export const CONSENT_CONNECTION_IDS: readonly ConsentConnectionId[] = [CONNECTION_ID.LINEAR];

export function isConnectionId(value: string): value is ConnectionId {
  return Object.hasOwn(CONNECTIONS, value);
}

export function isCliLoginConnectionId(value: string): value is CliLoginConnectionId {
  return CLI_LOGIN_CONNECTION_IDS.some((id) => id === value);
}

export function isConsentConnectionId(value: string): value is ConsentConnectionId {
  return CONSENT_CONNECTION_IDS.some((id) => id === value);
}

function credentialsIn(section: ConnectionSection): readonly CredentialProvider[] {
  return CONNECTION_LIST.flatMap((connection) =>
    connection.section === section && connection.credential ? [connection.credential] : [],
  );
}

/** The coding-agent providers holding a key, in the order the Providers section lists them. */
export const CLOUD_AGENT_PROVIDER_LIST: readonly CredentialProvider[] = credentialsIn(
  CONNECTION_SECTION.PROVIDERS,
);

/**
 * The services beyond the agents. The Integrations section draws each as its
 * own block rather than from this list — a consent row and a key row are not
 * the same line — so this stands for what belongs in that section, which is
 * what keeps the sections together covering the whole credential registry.
 */
export const INTEGRATION_PROVIDER_LIST: readonly CredentialProvider[] = credentialsIn(
  CONNECTION_SECTION.INTEGRATIONS,
);

/**
 * Whether this credential buys the observation of cloud sessions, which is
 * what the cloud badge on a mark says. Linear's issues and OpenAI's voice are
 * services Luke uses rather than sessions he watches, so their marks carry no
 * badge — a badge there would claim sessions neither service has.
 */
export function credentialSessionsInCloud(id: CredentialProviderId): boolean {
  return connectionDeclaration(id).sessionsInCloud;
}
