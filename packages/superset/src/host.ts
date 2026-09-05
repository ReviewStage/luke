import {
  PROVIDER_ACT,
  type ProviderAct,
  type WorkspaceHostEnrichment,
  type WorkspaceHostRegistration,
  type WorkspaceHostSessionActs,
} from "@sidecar/providers";
import { CLI_CONNECTION, type CliConnection, type SessionIdentity } from "@sidecar/session";
import { isSupersetControlId, type SupersetCli, SupersetWorkspaceAdapter } from "./cli.js";
import { SupersetWorkspaceReader, SupersetWorkspaceSnapshot } from "./workspaces.js";

export interface SupersetWorkspaceHostOptions {
  /**
   * The CLI the acts run through. The app constructs it, because the same
   * reference also answers its sign-in flow and settings rows, and hands it
   * in so the acts a row advertises and the login the row reports are read
   * from one binary.
   */
  cli: SupersetCli;
  homeDirectory: string;
  reader?: Pick<SupersetWorkspaceReader, "read">;
  /** The agent kind the user chose for new Superset workspaces, read per pass. */
  agentDefault: () => Promise<string | undefined>;
  /** Where a failed read is reported; the read itself never rejects. */
  report?: (message: string) => void;
}

const OBSERVATION_FAILURE_LABEL = "Superset observation";

/**
 * The acts the host delivers for a claimed session, one per method of
 * `WorkspaceHostSessionActs`: the four CLI commands the agent guide
 * authorizes on a managed row. Stated so the capability declaration can be
 * checked against them the way an adapter's seams are checked.
 */
export const SUPERSET_HOST_ACTS: readonly ProviderAct[] = [
  PROVIDER_ACT.MESSAGE,
  PROVIDER_ACT.CONTROL,
  PROVIDER_ACT.ADD_AGENT,
  PROVIDER_ACT.RENAME_WORKSPACE,
];

/**
 * Superset's entry in the workspace-host registry, carrying the whole
 * Superset pass rather than only the enrichment: the acts a drawn row still
 * advertises resolve against this host's latest snapshot, and the chatless
 * workspace rows ride the same read, so all of it moves together. The acts
 * are the four CLI commands the agent guide authorizes, each bound at claim
 * time to the context the latest read resolved for the session, and only for
 * a session inside the organization the CLI is signed into.
 */
export class SupersetWorkspaceHost implements WorkspaceHostRegistration {
  readonly observationFailureLabel = OBSERVATION_FAILURE_LABEL;
  readonly cli: SupersetCli;
  readonly adapter: SupersetWorkspaceAdapter;

  readonly #reader: Pick<SupersetWorkspaceReader, "read">;
  readonly #agentDefault: () => Promise<string | undefined>;
  readonly #report: (message: string) => void;
  #snapshot = new SupersetWorkspaceSnapshot([]);
  #organization: string | undefined;

  constructor(options: SupersetWorkspaceHostOptions) {
    this.cli = options.cli;
    this.adapter = new SupersetWorkspaceAdapter(options.cli);
    this.#reader =
      options.reader ?? new SupersetWorkspaceReader({ homeDirectory: options.homeDirectory });
    this.#agentDefault = options.agentDefault;
    this.#report = options.report ?? ((message) => process.stderr.write(message));
  }

  /**
   * The read absorbs its own failures into an empty snapshot so the act
   * contexts and the workspace rows move with it; a rejection would be a bug,
   * and it costs only the enrichment rather than the pass.
   */
  async read(): Promise<WorkspaceHostEnrichment> {
    let snapshot = new SupersetWorkspaceSnapshot([]);
    let organization: string | undefined;
    let agentDefault: string | undefined;
    try {
      agentDefault = await this.#agentDefault();
      [snapshot, organization] = await Promise.all([
        this.#reader.read(),
        this.cli.activeOrganization(),
      ]);
    } catch (error) {
      this.#report(failureLine(error instanceof Error ? error.message : String(error)));
    }
    // The fresh snapshot answers acts the drawn rows still advertise from
    // before this pass's enrichment runs, so the directory matches enrichment
    // made carry over, re-anchored to the worktrees just read.
    snapshot.adoptDirectoryMatches(this.#snapshot);
    this.#snapshot = snapshot;
    this.#organization = organization;
    // Refreshed outside the read's own try so a failed pass hands the adapter
    // the same emptiness the act contexts just took: rows the router would
    // refuse to act on must not keep standing on a snapshot that is gone.
    try {
      await this.adapter.refresh(
        agentDefault,
        organization !== undefined,
        snapshot.workspaceRowObservations(organization),
      );
    } catch (error) {
      this.#report(failureLine(error instanceof Error ? error.message : String(error)));
    }
    return (providerId, observations) => snapshot.enrich(providerId, observations, organization);
  }

  readonly emptyEnrichment: WorkspaceHostEnrichment = (_providerId, observations) => observations;

  /** Whether the latest read found the CLI signed into an organization. */
  connected(): boolean {
    return this.#organization !== undefined;
  }

  /**
   * What the CLI says about its login right now, asked of the binary rather
   * than remembered from the last pass, so the settings row a sign-in or
   * sign-out just changed reads true before the next pass runs.
   */
  async cliConnection(): Promise<CliConnection> {
    if (!(await this.cli.installed())) return CLI_CONNECTION.CLI_MISSING;
    return (await this.cli.connected()) ? CLI_CONNECTION.CONNECTED : CLI_CONNECTION.SIGNED_OUT;
  }

  claim(identity: SessionIdentity): WorkspaceHostSessionActs | undefined {
    const context = this.#snapshot.actableContext(
      identity.providerId,
      identity.providerSessionId,
      this.#organization,
    );
    if (!context) return undefined;
    return {
      sendMessage: (text) => this.cli.sendMessage(context, text),
      executeControl: (controlId) => this.cli.executeControl(context, controlId),
      spawnAgent: (agent, task) => this.cli.createAgent(context, agent, task),
      renameWorkspace: (name) => this.cli.renameWorkspace(context, name),
    };
  }

  ownsControl(controlId: string): boolean {
    return isSupersetControlId(controlId);
  }
}

function failureLine(message: string): string {
  return `${OBSERVATION_FAILURE_LABEL} failed: ${message}\n`;
}
