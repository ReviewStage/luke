import os from "node:os";
import path from "node:path";
import {
  AGENT_IDENTITY,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  type SessionApplication,
} from "@sidecar/session";
import {
  text,
  type UnparsedWireValue,
  unparsedWire,
  type WireRecord,
  wireRecord,
} from "@sidecar/wire";
import { readTextFile } from "../shared/local-session-adapter.js";

const CMUX_STATE_DIRECTORY_NAME = ".cmuxterm";

/** cmux styles its own name lowercase everywhere it is written. */
export const CMUX_APPLICATION_NAME = "cmux";

const CMUX_AGENT_STORE = {
  CLAUDE: "claude",
  CODEX: "codex",
  CURSOR: "cursor",
  GEMINI: "gemini",
  OPENCODE: "opencode",
} as const;

type CmuxAgentStore = (typeof CMUX_AGENT_STORE)[keyof typeof CMUX_AGENT_STORE];

/**
 * The agents cmux writes a hook-session store for, each mapped to the identity
 * Luke already draws that agent's sessions under. cmux tracks more agent kinds
 * than Luke observes; a store for an agent Luke has no provider for annotates
 * nothing and is not read.
 */
const CMUX_PROVIDER_BY_STORE = {
  [CMUX_AGENT_STORE.CLAUDE]: AGENT_IDENTITY.CLAUDE_CODE.id,
  [CMUX_AGENT_STORE.CODEX]: AGENT_IDENTITY.CODEX.id,
  [CMUX_AGENT_STORE.CURSOR]: AGENT_IDENTITY.CURSOR.id,
  [CMUX_AGENT_STORE.GEMINI]: AGENT_IDENTITY.GEMINI_CLI.id,
  [CMUX_AGENT_STORE.OPENCODE]: AGENT_IDENTITY.OPENCODE.id,
} as const satisfies Readonly<Record<CmuxAgentStore, string>>;

const CMUX_STORE_FILE_SUFFIX = "-hook-sessions.json";

const CMUX_SESSION_FIELD = {
  SESSION_ID: "sessionId",
  WORKSPACE_ID: "workspaceId",
  SURFACE_ID: "surfaceId",
} as const;

/**
 * The address of one terminal pane in cmux's own app, the deep link cmux
 * registers for its released builds. It is composed here from the observed
 * identifiers instead of read from anywhere, so opening stays what every open
 * is: an address handed to the operating system, reaching no provider.
 */
export function cmuxSurfaceLink(workspaceId: string, surfaceId: string): string {
  return `cmux://workspace/${workspaceId}/surface/${surfaceId}`;
}

/** Where cmux's hook store says one session it holds is drawn. */
interface CmuxSessionContext {
  workspaceId: string;
  surfaceId: string;
}

type SessionContextsByProvider = ReadonlyMap<string, ReadonlyMap<string, CmuxSessionContext>>;

export interface CmuxSessionApplicationReaderOptions {
  stateDirectory?: string;
}

function defaultCmuxStateDirectory(): string {
  return path.join(os.homedir(), CMUX_STATE_DIRECTORY_NAME);
}

function contextFromRecord(value: UnparsedWireValue): CmuxSessionContext | undefined {
  const record = wireRecord(value);
  if (!record) return undefined;
  const workspaceId = text(record[CMUX_SESSION_FIELD.WORKSPACE_ID]);
  const surfaceId = text(record[CMUX_SESSION_FIELD.SURFACE_ID]);
  return workspaceId && surfaceId ? { workspaceId, surfaceId } : undefined;
}

/**
 * Reads cmux's own session-to-pane mapping without opening any agent
 * transcript. An absent app, an unreadable store, or an unfamiliar shape means
 * no annotation; it can never make the provider's own observation disappear.
 */
export class CmuxSessionApplicationSnapshot {
  readonly #sessionsByProvider: SessionContextsByProvider;

  constructor(sessionsByProvider: SessionContextsByProvider = new Map()) {
    this.#sessionsByProvider = sessionsByProvider;
  }

  has(providerId: string, providerSessionId: string): boolean {
    return this.#sessionsByProvider.get(providerId)?.has(providerSessionId) === true;
  }

  /**
   * Adds cmux beside any app associations the provider already reported, with
   * the pane's own `cmux://` address, which also stands in as the row's link
   * where no other manager gave it one. A sub-agent inherits its nearest
   * cmux-known ancestor's association: the child runs in the same pane even
   * though only the parent reached cmux's hooks. cmux names its workspaces
   * only by identifier, so a matched row keeps whatever grouping another
   * manager claimed and never groups under cmux.
   */
  enrich(
    providerId: string,
    observations: readonly ProviderSessionObservation[],
  ): readonly ProviderSessionObservation[] {
    const cmuxSessions = this.#sessionsByProvider.get(providerId);
    if (!cmuxSessions) return observations;

    const localObservationsById = new Map(
      observations
        .filter((observation) => observation.location !== SESSION_LOCATION.CLOUD)
        .map((observation) => [observation.providerSessionId, observation] as const),
    );

    const cmuxContextFor = (
      observation: ProviderSessionObservation,
    ): CmuxSessionContext | undefined => {
      if (observation.location === SESSION_LOCATION.CLOUD) return undefined;
      let sessionId: string | undefined = observation.providerSessionId;
      const visited = new Set<string>();
      while (sessionId && !visited.has(sessionId)) {
        const context = cmuxSessions.get(sessionId);
        if (context) return context;
        visited.add(sessionId);
        sessionId = text(localObservationsById.get(sessionId)?.parentProviderSessionId);
      }
      return undefined;
    };

    return observations.map((observation) => {
      const context = cmuxContextFor(observation);
      if (
        !context ||
        observation.applications?.some(
          (application) => application.id === SESSION_APPLICATION_ID.CMUX,
        )
      ) {
        return observation;
      }
      const applicationLink = cmuxSurfaceLink(context.workspaceId, context.surfaceId);
      const application: SessionApplication = {
        id: SESSION_APPLICATION_ID.CMUX,
        displayName: CMUX_APPLICATION_NAME,
        scope: SESSION_APPLICATION_SCOPE.SESSION,
        link: applicationLink,
      };
      // The app that wrote the hook store is the scheme's registered handler,
      // so the address stands on its own. A link another manager already gave
      // the row wins as the row's primary press; the cmux association keeps
      // its own exact pane address independently.
      const detail = observation.detail?.link
        ? observation.detail
        : { ...observation.detail, link: applicationLink };
      return {
        ...observation,
        detail,
        applications: [...(observation.applications ?? []), application],
      };
    });
  }
}

/**
 * Reads the hook-session stores cmux keeps under its own state directory —
 * one small JSON file per agent kind, written by cmux's CLI as agent hooks
 * fire. Only the live `sessions` records are read, and of each record only
 * the three identifiers that place a session in cmux's own windows.
 */
export class CmuxSessionApplicationReader {
  readonly #stateDirectory: string;

  constructor(options: CmuxSessionApplicationReaderOptions = {}) {
    this.#stateDirectory = options.stateDirectory ?? defaultCmuxStateDirectory();
  }

  async read(): Promise<CmuxSessionApplicationSnapshot> {
    const sessionsByProvider = new Map<string, Map<string, CmuxSessionContext>>();
    for (const [store, providerId] of Object.entries(CMUX_PROVIDER_BY_STORE)) {
      const storePath = path.join(this.#stateDirectory, `${store}${CMUX_STORE_FILE_SUFFIX}`);
      const source = await readTextFile(storePath);
      if (source === undefined) continue;
      const sessions = this.#storeSessions(source);
      if (!sessions) continue;
      for (const [sessionKey, value] of Object.entries(sessions)) {
        const context = contextFromRecord(value);
        if (!context) continue;
        const record = wireRecord(value);
        const providerSessionId = text(record?.[CMUX_SESSION_FIELD.SESSION_ID]) ?? sessionKey;
        const contexts = sessionsByProvider.get(providerId) ?? new Map();
        contexts.set(providerSessionId, context);
        sessionsByProvider.set(providerId, contexts);
      }
    }
    return new CmuxSessionApplicationSnapshot(sessionsByProvider);
  }

  /** A store that does not parse, or parses to another shape, reads as empty. */
  #storeSessions(source: string): WireRecord | undefined {
    let parsed: UnparsedWireValue;
    try {
      parsed = unparsedWire(JSON.parse(source));
    } catch {
      return undefined;
    }
    const store = wireRecord(parsed);
    return store ? wireRecord(store.sessions) : undefined;
  }
}
