import {
  ACT_KIND,
  ACT_RESULT_STATUS,
  type AdvertisedControl,
  advertisedActFor,
  advertisedControl,
  type ProviderActResult,
  type ProviderControlRequest,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderSessionObservation,
  type ProviderSessionRenameRequest,
  type ProviderWorkspaceAgentRequest,
  type ProviderWorkspaceRenameRequest,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  type SessionProvider,
  SessionProviderAdapterBase,
  UNSUPPORTED_BY_OBSERVATION,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentSelection,
  type WorkspaceProject,
} from "@sidecar/session";
import type { CloudFetch, WireRecord } from "@sidecar/wire";
import type { AdapterDiagnosticCallback, AdapterDiagnosticKind } from "./adapter-diagnostics.js";
import { tolerateItemFailure } from "./adapter-failure.js";
import { type CloudPass, cloudPass, WRITE_SUBJECT } from "./cloud-pass.js";
import type { CloudRequest, CloudWriteRoute } from "./cloud-wire.js";

export interface CloudAdapterOptions {
  /** Resolves the credential at observation time so a settings change applies immediately. */
  readApiKey: () => Promise<string | undefined>;
  baseUrl?: string;
  fetch?: CloudFetch;
  now?: () => number;
  minimumRefreshIntervalMs?: number;
  /**
   * Called when an observation pass fails for a reason other than a network
   * or credential fault — a TypeError in a subclass's parsing, for example —
   * or when a subclass reports a problem of its own, named by the kind.
   * Transient and unauthorized adapter failures never reach it.
   */
  onDiagnostic?: AdapterDiagnosticCallback;
}

/** The provider-specific identity and endpoint a subclass supplies once. */
export interface CloudAdapterProfile {
  provider: SessionProvider;
  defaultBaseUrl: string;
  baseUrlEnvironmentVariable?: string;
  /**
   * The headers every request carries besides the credential, for a provider
   * that asks for its own media type or a version pin. The authorization
   * header is layered on after these, so nothing declared here can replace
   * the credential.
   */
  requestHeaders?: Readonly<Record<string, string>>;
}

/**
 * The adapter-shaped half of a cloud provider. `cloudPass` holds the
 * credential, the refresh cadence, the failure rules that decide whether a
 * snapshot survives, the bounded read-only requests and the one authenticated
 * write; what is left here is the act guards — each acting on nothing but
 * what a user asked for against something the last pass observed — and the
 * route seams a subclass supplies.
 *
 * Every operation is explicit on the adapter interface. The base answers
 * unsupported unless a subclass supplies the matching route. Observation
 * itself stays read-only.
 */
export abstract class CloudSessionAdapter extends SessionProviderAdapterBase {
  readonly provider: SessionProvider;

  readonly #pass: CloudPass;

  constructor(profile: CloudAdapterProfile, options: CloudAdapterOptions) {
    super();
    this.provider = profile.provider;
    this.#pass = cloudPass({
      ...profile,
      ...options,
      collect: (request, now) => this.collect(request, now),
      forget: () => this.forgetCachedIdentity(),
    });
  }

  observe(): Promise<readonly ProviderSessionObservation[]> {
    return this.#pass.run();
  }

  /**
   * A subclass's way onto the same diagnostic channel, for a problem worth
   * surfacing from a pass that otherwise succeeded.
   */
  protected reportDiagnostic(kind: AdapterDiagnosticKind, error: Error): void {
    this.#pass.reportDiagnostic(kind, error);
  }

  /**
   * What the latest pass observed for one session, for a subclass answering a
   * read or write of its own: the same snapshot every base-implemented act
   * validates against, so a subclass's operation can hold the same rule — it
   * exists only for a session the last pass actually saw.
   */
  protected latestObservation(providerSessionId: string): ProviderSessionObservation | undefined {
    return this.#pass
      .latest()
      .find((candidate) => candidate.providerSessionId === providerSessionId);
  }

  /**
   * Sends one user-typed message to one observed session, through the
   * provider's documented message endpoint. The message arrives admitted, so
   * what is left here is this adapter's own pass — a session it did not
   * observe has no route to build — and the provider's own shape.
   */
  override async sendMessage(message: ProviderSessionMessage): Promise<ProviderMessageResult> {
    if (!this.latestObservation(message.providerSessionId)) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };
    }

    // The credential is read at send time, not held from the observation pass,
    // so a key the user just replaced or removed is honoured immediately. Its
    // absence is a rejection with the actual reason, not the unsupported answer: the
    // session advertised taking messages while a key stood behind it, and a
    // key that has since gone is a different fact than a session that moved on.
    const apiKey = await this.#pass.readApiKey();
    if (!apiKey) return this.#missingKeyRejection();

    const route = this.messageRoute(message.providerSessionId, message.text);
    if (!route)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };
    return (await this.#pass.write(apiKey, route)).outcome;
  }

  #missingKeyRejection(): ProviderActResult {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: `${this.provider.displayName}'s API key is no longer configured.`,
    };
  }

  /**
   * Runs one provider-defined control against one observed session, through
   * the endpoint the provider documents for it. The advertised control is read
   * back out of this adapter's own latest pass, because that entry is what the
   * route is built from; a session the pass did not observe, or a control it
   * did not advertise, has no route to build.
   */
  override async executeControl(request: ProviderControlRequest): Promise<ProviderControlResult> {
    const observation = this.latestObservation(request.providerSessionId);
    // The advertised control — not the caller's copy of it — is what the route
    // is built from, so whatever it targets is the thing the last pass actually
    // saw, and nothing a caller sends can redirect it.
    const advertised = observation && advertisedControl(observation, request.control.id);
    if (!advertised)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };

    const apiKey = await this.#pass.readApiKey();
    if (!apiKey) return this.#missingKeyRejection();

    const route = this.controlRoute(request.providerSessionId, advertised);
    if (!route)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };
    return (await this.#pass.write(apiKey, route)).outcome;
  }

  /**
   * Starts another agent in the workspace one observed session runs in,
   * through the provider's documented endpoint. The spawn target and the agent
   * kind are read back out of this adapter's own latest pass, because they are
   * what the route is built from.
   */
  override async spawnWorkspaceAgent(
    request: ProviderWorkspaceAgentRequest,
  ): Promise<ProviderWorkspaceResult> {
    const observation = this.latestObservation(request.providerSessionId);
    if (!observation)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };
    // The advertised list — not the caller's word — is what the route is
    // built from, so an agent kind is only ever one the last pass promised.
    const addAgent = advertisedActFor(observation, ACT_KIND.ADD_AGENT);
    const agent = addAgent?.agents.find((candidate) => candidate === request.agent);
    if (!agent)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };

    // The route is built in the same synchronous step as the target is read,
    // from the observation's own spawn target: a pass landing while the key is
    // read must not be able to swap the snapshot between the two.
    const route = this.workspaceAgentRoute(addAgent?.target ?? request.providerSessionId, {
      ...request,
      agent,
    });
    if (!route)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };

    const apiKey = await this.#pass.readApiKey();
    if (!apiKey) return this.#missingKeyRejection();
    return (await this.#pass.write(apiKey, route)).outcome;
  }

  /**
   * Where this provider's documented start-another-agent endpoint lives and
   * what it takes. The target handed in is the target of the observation's
   * own `add-agent` advertisement — the session id itself when it named none —
   * and the request is the
   * validated ask, so the route is built from what the provider itself
   * promised. The default is that a provider starts nothing, the same way a
   * read-only adapter stays read-only by writing nothing.
   */
  protected workspaceAgentRoute(
    _spawnTarget: string,
    _request: ProviderWorkspaceAgentRequest,
  ): CloudWriteRoute | undefined {
    return undefined;
  }

  /**
   * Renames the workspace one observed session runs in, through the
   * provider's documented endpoint. The same refusals guard it that guard a
   * message: the rename target is read back out of this adapter's own latest
   * pass, because that target is what the route is built from.
   */
  override async renameWorkspace(
    request: ProviderWorkspaceRenameRequest,
  ): Promise<ProviderActResult> {
    const observation = this.latestObservation(request.providerSessionId);
    // The advertised target — not the caller's word — is what the route is
    // built from, so a rename only ever lands on the workspace the last pass
    // promised.
    const renameWorkspace = observation && advertisedActFor(observation, ACT_KIND.RENAME_WORKSPACE);
    if (!renameWorkspace)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };

    // The route is built in the same synchronous step as the target is read,
    // from the observation's own rename target: a pass landing while the key
    // is read must not be able to swap the snapshot between the two.
    const route = this.workspaceRenameRoute(renameWorkspace.target, request.name);
    if (!route)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };

    const apiKey = await this.#pass.readApiKey();
    if (!apiKey) return this.#missingKeyRejection();
    return (await this.#pass.write(apiKey, route, WRITE_SUBJECT.WORKSPACE)).outcome;
  }

  /**
   * Where this provider's documented workspace-rename endpoint lives and what
   * it takes. The target handed in is the target of the observation's own
   * `rename-workspace` advertisement, so the route is built from what the provider itself promised. The default
   * is that a provider renames nothing, the same way a read-only adapter
   * stays read-only by writing nothing.
   */
  protected workspaceRenameRoute(
    _renameTarget: string,
    _name: string,
  ): CloudWriteRoute | undefined {
    return undefined;
  }

  /**
   * Renames one observed session itself — the chat, where `renameWorkspace`
   * renames the workspace around it — through the provider's documented
   * endpoint. The session names its own route, so what is left here is this
   * adapter's own pass and the provider's own shape.
   */
  override async renameSession(request: ProviderSessionRenameRequest): Promise<ProviderActResult> {
    if (!this.latestObservation(request.providerSessionId)) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };
    }

    const route = this.sessionRenameRoute(request.providerSessionId, request.name);
    if (!route)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };

    const apiKey = await this.#pass.readApiKey();
    if (!apiKey) return this.#missingKeyRejection();
    return (await this.#pass.write(apiKey, route)).outcome;
  }

  /**
   * Where this provider's documented session-rename endpoint lives and what
   * it takes. The default is that a provider renames nothing, the same way a
   * read-only adapter stays read-only by writing nothing.
   */
  protected sessionRenameRoute(
    _providerSessionId: string,
    _name: string,
  ): CloudWriteRoute | undefined {
    return undefined;
  }

  /**
   * Creates one workspace the user just asked for, in one project the latest
   * pass reported, through the provider's documented creation endpoint — and,
   * when the user gave the new agent an opening task, hands that over too,
   * either inside the creation request or through the provider's documented
   * follow-up on what the creation returned. The same refusals guard it that
   * guard a message: a project the last pass did not report, a name or task
   * outside its bound, a task a project does not take or the absence of one it
   * needs, and a missing credential all answer without touching the network.
   */
  override async createWorkspace(
    request: ProviderWorkspaceRequest,
  ): Promise<ProviderWorkspaceResult> {
    const projects = this.workspaceProjects();
    const project = projects.find(
      (candidate) => candidate.providerProjectId === request.providerProjectId,
    );
    if (!project)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };

    const { name, task } = request;
    // The task is held to the project's own word for it here, because the
    // project is the adapter's own: it comes back off the pass this adapter
    // ran, not out of the request.
    if (task && project.taskSupport === WORKSPACE_TASK_SUPPORT.NONE) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "This project takes no opening task.",
      };
    }
    if (!task && project.taskSupport === WORKSPACE_TASK_SUPPORT.REQUIRED) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "This project needs an opening task to create a workspace.",
      };
    }

    const apiKey = await this.#pass.readApiKey();
    if (!apiKey) return this.#missingKeyRejection();

    const route = this.workspaceCreationRoute(project, name, task, request.agentSelection);
    if (!route)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };
    const created = await this.#pass.write(apiKey, route, WRITE_SUBJECT.PROJECT);
    if (created.outcome.status !== ACT_RESULT_STATUS.ACCEPTED) {
      return created.outcome;
    }
    // The id the response named rides the acceptance — an identifier only,
    // never an address — so the surface can open the workspace once an
    // observation pass reports that session itself. The body it was read
    // from still never leaves the adapter.
    const createdSessionId = this.createdWorkspaceSessionId(created.body ?? {});
    const landed: ProviderWorkspaceResult = {
      status: ACT_RESULT_STATUS.ACCEPTED,
      ...(createdSessionId ? { providerSessionId: createdSessionId } : undefined),
    };
    if (!task) return landed;

    // The workspace stands; what is left is the task. A provider whose
    // creation request already carried it has nothing to answer here, and one
    // that hands tasks somewhere the creation response names answers with
    // that route — built from what the provider itself just returned.
    const followUp = this.workspaceTaskRoute(created.body ?? {}, task);
    if (followUp === undefined) return landed;
    if ("undeliverable" in followUp) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: `The workspace was created, but its opening task was not delivered: ${followUp.undeliverable}`,
      };
    }
    const delivered = await this.#pass.write(apiKey, followUp, WRITE_SUBJECT.SESSION);
    if (delivered.outcome.status === ACT_RESULT_STATUS.ACCEPTED) {
      return landed;
    }
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: `The workspace was created, but its opening task was not delivered: ${
        delivered.outcome.status === ACT_RESULT_STATUS.REJECTED
          ? delivered.outcome.reason
          : "the provider documents no way to hand it over."
      }`,
    };
  }

  /**
   * Where this provider's documented workspace-creation endpoint lives and what
   * it takes. The project handed in is one the latest pass reported, so the
   * route is built from what the provider itself offered; the task arrives
   * here so a provider whose creation request carries it can put it in the
   * body. The default is that a provider creates nothing, the same way a
   * read-only adapter stays read-only by writing nothing.
   */
  protected workspaceCreationRoute(
    _project: WorkspaceProject,
    _name: string | undefined,
    _task: string | undefined,
    _agentSelection: WorkspaceAgentSelection | undefined,
  ): CloudWriteRoute | undefined {
    return undefined;
  }

  /**
   * The id of the session a creation response names, for a provider whose
   * documented response names one. It is the one thing read out of the body
   * that outlives the adapter — an identifier the next observation pass will
   * report on its own, never an address — and it exists so the surface can
   * open the created workspace once that pass has. The default is that a
   * provider names none, so an acceptance stays a plain acceptance and the
   * workspace is simply left where it was made.
   */
  protected createdWorkspaceSessionId(_creationBody: WireRecord): string | undefined {
    return undefined;
  }

  /**
   * Where an opening task goes once the workspace exists, for a provider that
   * documents the hand-over as its own endpoint on something the creation
   * response names. Returning nothing says the creation request already
   * carried the task; a provider whose response did not name the place the
   * task goes answers `undeliverable` with why, so a created-but-idle
   * workspace is reported as exactly that rather than claimed complete.
   */
  protected workspaceTaskRoute(
    _creationBody: WireRecord,
    _task: string,
  ): CloudWriteRoute | { undeliverable: string } | undefined {
    return undefined;
  }

  /**
   * Where this provider's documented message endpoint lives and what it takes.
   * Returning nothing says this adapter cannot form the request — a provider
   * that documents no message endpoint at all, or an identity it has not
   * learned — never that the send failed. The default is that a provider takes
   * no messages, so a read-only adapter stays read-only by writing nothing.
   */
  protected messageRoute(_providerSessionId: string, _text: string): CloudWriteRoute | undefined {
    return undefined;
  }

  /**
   * Where a documented control's endpoint lives. The control handed in is the
   * one the latest observation advertised, so a route built from its `target`
   * acts on what the user was shown. The default is that a provider advertises
   * no controls, so only an adapter that advertised one has anything to answer
   * here.
   */
  protected controlRoute(
    _providerSessionId: string,
    _control: AdvertisedControl,
  ): CloudWriteRoute | undefined {
    return undefined;
  }

  /** Runs one authenticated pass. Duplicate session ids are dropped by the pass. */
  protected abstract collect(
    request: CloudRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]>;

  /**
   * Clears anything a subclass cached across passes. It runs whenever the
   * credential changes or is rejected, so nothing read as one user can be
   * reported as another.
   */
  protected forgetCachedIdentity(): void {}

  /** Keeps one failed resource from discarding an otherwise complete pass. */
  protected tolerateItemFailure<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result | undefined> {
    return tolerateItemFailure(operation);
  }

  /**
   * One read bound to the credential rather than to one pass, for an offer
   * that rides beside the passes and may outlive several — the pass-scoped
   * request would discard exactly the slow answer such a read exists for.
   */
  protected credentialBoundRead(
    segments: readonly string[],
    query: Readonly<Record<string, string>> | undefined,
    options: Readonly<{ timeoutMs?: number }> | undefined,
    apply: (body: WireRecord) => void,
  ): Promise<void> {
    return this.#pass.credentialBoundRead(segments, query, options, apply);
  }
}
