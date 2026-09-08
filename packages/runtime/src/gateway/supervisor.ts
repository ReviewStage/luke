import {
  GATEWAY_ERROR,
  GATEWAY_HANDSHAKE_REFUSAL,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayBuildIdentity,
  type GatewayRequest,
  type GatewayResponse,
} from "@sidecar/runtime-contracts";
import type { ScheduledTimer } from "../timers.js";
import { discoveryMatchesBuild, type GatewayDiscoveryRecord } from "./discovery.js";
import type { NodeInvocationHandler } from "./invocations.js";
import type { GatewayEventSink, GatewayTransport } from "./transport.js";

/**
 * The desktop's keeper of the Gateway process: it finds a healthy Gateway of
 * this build and attaches to it, starts one when none stands, and starts
 * another when the one it held goes away, inside a budget. The policy is
 * here, pure, over ports the desktop supplies (how to read discovery, how to
 * connect, how to spawn), so every branch of it is tested without a process
 * or a socket. What the supervisor hands the rest of the desktop is one
 * transport that stays the same object across every reattachment; while no
 * Gateway is attached, that transport answers the existing typed disconnected
 * error, and nothing new is drawn for it.
 */
export const GATEWAY_SUPERVISOR_DEFAULTS = {
  /** Automatic restarts allowed inside the window while a client is attached; past it, the failure is typed and stands. */
  RESTART_LIMIT: 3,
  RESTART_WINDOW_MS: 60_000,
  /** How long a spawned Gateway is given to publish its discovery record. */
  DISCOVERY_WAIT_MS: 15_000,
  DISCOVERY_POLL_MS: 100,
  /** How long an explicit stop waits for the Gateway to leave before it is killed. */
  STOP_WAIT_MS: 12_000,
  /** How long the stop's own shutdown request may go unanswered before the exit wait begins regardless. */
  STOP_REQUEST_WAIT_MS: 3_000,
  /** How long an incompatible Gateway of another build is given to drain before this build starts its own. */
  DRAIN_WAIT_MS: 12_000,
} as const;

export const GATEWAY_ATTACHMENT = {
  DETACHED: "detached",
  ATTACHING: "attaching",
  ATTACHED: "attached",
  /** The restart budget is spent; requests answer disconnected until the next explicit attach. */
  FAILED: "failed",
  STOPPED: "stopped",
} as const;

export type GatewayAttachment = (typeof GATEWAY_ATTACHMENT)[keyof typeof GATEWAY_ATTACHMENT];

export const GATEWAY_ATTACH_OUTCOME = {
  REATTACHED: "reattached",
  STARTED: "started",
  FAILED: "failed",
} as const;

export type GatewayAttachOutcome =
  (typeof GATEWAY_ATTACH_OUTCOME)[keyof typeof GATEWAY_ATTACH_OUTCOME];

export const GATEWAY_ATTACH_FAILURE = {
  /** Another process holds the Gateway and refused this client's token. */
  UNAUTHORIZED: "unauthorized",
  UNSUPPORTED_VERSION: "unsupported_version",
  /** The standing Gateway is another build and did not drain in time. */
  INCOMPATIBLE_BUILD: "incompatible_build",
  /** The spawned Gateway published nothing before the wait ran out, or exited first. */
  NOT_READY: "not_ready",
  UNREACHABLE: "unreachable",
  RESTART_BUDGET_SPENT: "restart_budget_spent",
} as const;

export type GatewayAttachFailure =
  (typeof GATEWAY_ATTACH_FAILURE)[keyof typeof GATEWAY_ATTACH_FAILURE];

export type GatewayAttachResult =
  | { outcome: typeof GATEWAY_ATTACH_OUTCOME.REATTACHED; pid: number }
  | { outcome: typeof GATEWAY_ATTACH_OUTCOME.STARTED; pid: number }
  | { outcome: typeof GATEWAY_ATTACH_OUTCOME.FAILED; failure: GatewayAttachFailure };

/** A connected transport with what the supervisor needs beside it: whose build it is, and when it closes. */
export interface GatewayConnection extends GatewayTransport {
  hostBuild: GatewayBuildIdentity;
  onClosed: (listener: () => void) => () => void;
  close: () => void;
}

export const GATEWAY_CONNECT_FAILURE = {
  ...GATEWAY_HANDSHAKE_REFUSAL,
  UNREACHABLE: "unreachable",
} as const;

export type GatewayConnectFailure =
  (typeof GATEWAY_CONNECT_FAILURE)[keyof typeof GATEWAY_CONNECT_FAILURE];

export type GatewayConnectResult =
  | { ok: true; connection: GatewayConnection }
  | { ok: false; failure: GatewayConnectFailure };

export interface GatewaySpawnedProcess {
  pid: number;
  /** Settles when the process exits, with its code when known. */
  exited: Promise<number | undefined>;
  kill: () => void;
}

export interface GatewaySupervisorPorts {
  discover: () => Promise<GatewayDiscoveryRecord | undefined>;
  connect: (record: GatewayDiscoveryRecord) => Promise<GatewayConnectResult>;
  spawn: () => Promise<GatewaySpawnedProcess>;
  isAlive: (pid: number) => boolean;
  /** Ends a Gateway that did not leave when asked; reached only past the stop's wait. */
  kill: (pid: number) => void;
  build: GatewayBuildIdentity;
  createId: () => string;
  now?: () => number;
  setTimeout?: (work: () => void, delayMs: number) => ScheduledTimer;
  report?: (message: string) => void;
  restartLimit?: number;
  restartWindowMs?: number;
  discoveryWaitMs?: number;
  discoveryPollMs?: number;
  stopWaitMs?: number;
  stopRequestWaitMs?: number;
  drainWaitMs?: number;
}

function disconnected(id: string): GatewayResponse {
  return {
    id,
    ok: false,
    error: { code: GATEWAY_ERROR.DISCONNECTED, message: "no Gateway is attached" },
    revision: { configuration: 0, sequence: 0 },
  };
}

export class GatewaySupervisor {
  readonly #ports: GatewaySupervisorPorts;
  readonly #sinks = new Set<GatewayEventSink>();
  readonly #stateListeners = new Set<(state: GatewayAttachment) => void>();
  readonly transport: GatewayTransport;
  #state: GatewayAttachment = GATEWAY_ATTACHMENT.DETACHED;
  #connection: GatewayConnection | undefined;
  #releaseConnection: (() => void) | undefined;
  /** The node handler served on every connection this supervisor adopts, so a reattachment serves the same node. */
  #invocationHandler: NodeInvocationHandler | undefined;
  #pid: number | undefined;
  #restartsAt: number[] = [];
  #attaching: Promise<GatewayAttachResult> | undefined;

  constructor(ports: GatewaySupervisorPorts) {
    this.#ports = ports;
    this.transport = {
      request: (request) => this.#request(request),
      events: (sink) => {
        this.#sinks.add(sink);
        return () => {
          this.#sinks.delete(sink);
        };
      },
      connected: () => this.#connection?.connected() ?? false,
      serveInvocations: (handler) => {
        this.#invocationHandler = handler;
        const release = this.#connection?.serveInvocations?.(handler);
        return () => {
          if (this.#invocationHandler === handler) this.#invocationHandler = undefined;
          release?.();
        };
      },
    };
  }

  state(): GatewayAttachment {
    return this.#state;
  }

  /** The pid of the Gateway attached now, or the last one held. */
  pid(): number | undefined {
    return this.#pid;
  }

  onStateChanged(listener: (state: GatewayAttachment) => void): () => void {
    this.#stateListeners.add(listener);
    return () => {
      this.#stateListeners.delete(listener);
    };
  }

  /**
   * Finds or starts a Gateway and attaches. A healthy Gateway of this build
   * is reattached to, never doubled; one of another build is asked to drain
   * first; none at all is started and waited for. Concurrent callers share
   * one attempt. An explicit attach after the budget was spent begins again.
   */
  attach(): Promise<GatewayAttachResult> {
    if (this.#state === GATEWAY_ATTACHMENT.STOPPED) {
      return Promise.resolve({
        outcome: GATEWAY_ATTACH_OUTCOME.FAILED,
        failure: GATEWAY_ATTACH_FAILURE.UNREACHABLE,
      });
    }
    this.#attaching ??= this.#attachOnce().finally(() => {
      this.#attaching = undefined;
    });
    return this.#attaching;
  }

  /**
   * The explicit quit: asks the attached Gateway to shut down, waits for its
   * process to leave, and kills it only past the wait. No restart follows.
   */
  async stop(): Promise<void> {
    this.#setState(GATEWAY_ATTACHMENT.STOPPED);
    const connection = this.#connection;
    const pid = this.#pid;
    if (connection?.connected()) {
      // The ask itself is bounded: a socket that stays open under a host that
      // no longer answers must not hold the quit open, so the exit wait — and
      // the kill past it — begins whether or not the ask was acknowledged.
      await Promise.race([
        connection.request({
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          id: this.#ports.createId(),
          method: GATEWAY_METHOD.SHUTDOWN,
          params: {},
          idempotencyKey: this.#ports.createId(),
        }),
        this.#sleep(
          this.#ports.stopRequestWaitMs ?? GATEWAY_SUPERVISOR_DEFAULTS.STOP_REQUEST_WAIT_MS,
        ),
      ]);
    }
    this.#dropConnection();
    if (pid === undefined) return;
    const left = await this.#waitForExit(
      pid,
      this.#ports.stopWaitMs ?? GATEWAY_SUPERVISOR_DEFAULTS.STOP_WAIT_MS,
    );
    if (!left) {
      this.#ports.report?.("the Gateway did not leave in time and was killed");
      this.#ports.kill(pid);
    }
  }

  async #attachOnce(): Promise<GatewayAttachResult> {
    this.#setState(GATEWAY_ATTACHMENT.ATTACHING);
    const standing = await this.#ports.discover();
    if (standing) {
      const reattached = await this.#reattach(standing);
      if (reattached) return reattached;
      if (this.#state === GATEWAY_ATTACHMENT.STOPPED)
        return this.#failed(GATEWAY_ATTACH_FAILURE.UNREACHABLE);
    }
    return this.#start();
  }

  /** Attaches to a standing record when it is healthy and ours; answers nothing when a start should follow. */
  async #reattach(record: GatewayDiscoveryRecord): Promise<GatewayAttachResult | undefined> {
    if (!this.#ports.isAlive(record.pid)) return undefined;
    const result = await this.#ports.connect(record);
    if (!result.ok) {
      switch (result.failure) {
        case GATEWAY_CONNECT_FAILURE.UNREACHABLE:
        case GATEWAY_CONNECT_FAILURE.SHUTTING_DOWN:
          // A record whose process is alive but not answering is a Gateway
          // still starting or already leaving; waiting on its exit keeps
          // this build from opening the databases beside it. A stop that
          // lands during the wait ends it: a client leaving has no
          // databases to open, and nothing to wait twelve seconds for.
          await this.#waitForExit(
            record.pid,
            this.#ports.drainWaitMs ?? GATEWAY_SUPERVISOR_DEFAULTS.DRAIN_WAIT_MS,
            { untilStopped: true },
          );
          return undefined;
        case GATEWAY_CONNECT_FAILURE.UNAUTHORIZED:
          return this.#failed(GATEWAY_ATTACH_FAILURE.UNAUTHORIZED);
        case GATEWAY_CONNECT_FAILURE.UNSUPPORTED_VERSION:
          return this.#failed(GATEWAY_ATTACH_FAILURE.UNSUPPORTED_VERSION);
        case GATEWAY_CONNECT_FAILURE.INCOMPATIBLE_BUILD:
        case GATEWAY_CONNECT_FAILURE.MALFORMED:
          return this.#failed(GATEWAY_ATTACH_FAILURE.INCOMPATIBLE_BUILD);
      }
    }
    const connection = result.connection;
    if (discoveryMatchesBuild(connection.hostBuild, this.#ports.build)) {
      return (
        this.#adopt(connection, record.pid) ?? {
          outcome: GATEWAY_ATTACH_OUTCOME.REATTACHED,
          pid: record.pid,
        }
      );
    }
    // Another build's Gateway stands, usually the one an update replaced:
    // it is drained before this build starts its own, never run beside.
    this.#ports.report?.(
      `a Gateway of build ${connection.hostBuild.buildVersion} stands; draining it before starting ${this.#ports.build.buildVersion}`,
    );
    await connection.request({
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      id: this.#ports.createId(),
      method: GATEWAY_METHOD.SHUTDOWN,
      params: {},
      idempotencyKey: this.#ports.createId(),
    });
    connection.close();
    const left = await this.#waitForExit(
      record.pid,
      this.#ports.drainWaitMs ?? GATEWAY_SUPERVISOR_DEFAULTS.DRAIN_WAIT_MS,
      { untilStopped: true },
    );
    if (this.#state === GATEWAY_ATTACHMENT.STOPPED) {
      return this.#failed(GATEWAY_ATTACH_FAILURE.UNREACHABLE);
    }
    return left ? undefined : this.#failed(GATEWAY_ATTACH_FAILURE.INCOMPATIBLE_BUILD);
  }

  async #start(): Promise<GatewayAttachResult> {
    const spawned = await this.#ports.spawn();
    let exited = false;
    void spawned.exited.then(() => {
      exited = true;
    });
    const waitMs = this.#ports.discoveryWaitMs ?? GATEWAY_SUPERVISOR_DEFAULTS.DISCOVERY_WAIT_MS;
    const pollMs = this.#ports.discoveryPollMs ?? GATEWAY_SUPERVISOR_DEFAULTS.DISCOVERY_POLL_MS;
    const startedAt = this.#now();
    while (this.#now() - startedAt < waitMs) {
      if (this.#state === GATEWAY_ATTACHMENT.STOPPED) {
        spawned.kill();
        return this.#failed(GATEWAY_ATTACH_FAILURE.UNREACHABLE);
      }
      const record = await this.#ports.discover();
      if (record && record.pid === spawned.pid) {
        const result = await this.#ports.connect(record);
        if (result.ok) {
          if (!discoveryMatchesBuild(result.connection.hostBuild, this.#ports.build)) {
            result.connection.close();
            spawned.kill();
            return this.#failed(GATEWAY_ATTACH_FAILURE.INCOMPATIBLE_BUILD);
          }
          return (
            this.#adopt(result.connection, spawned.pid) ?? {
              outcome: GATEWAY_ATTACH_OUTCOME.STARTED,
              pid: spawned.pid,
            }
          );
        }
        if (result.failure === GATEWAY_CONNECT_FAILURE.UNAUTHORIZED) {
          return this.#failed(GATEWAY_ATTACH_FAILURE.UNAUTHORIZED);
        }
      }
      if (exited) return this.#failed(GATEWAY_ATTACH_FAILURE.NOT_READY);
      await this.#sleep(pollMs);
    }
    spawned.kill();
    return this.#failed(GATEWAY_ATTACH_FAILURE.NOT_READY);
  }

  /** Holds the connection as the attached Gateway's, unless a stop arrived while it was being made. */
  #adopt(connection: GatewayConnection, pid: number): GatewayAttachResult | undefined {
    if (this.#state === GATEWAY_ATTACHMENT.STOPPED) {
      connection.close();
      return this.#failed(GATEWAY_ATTACH_FAILURE.UNREACHABLE);
    }
    this.#dropConnection();
    this.#connection = connection;
    this.#pid = pid;
    // Served before the attached state is announced, so the first node
    // registration the client makes over this connection finds its handler.
    if (this.#invocationHandler) connection.serveInvocations?.(this.#invocationHandler);
    const unsubscribeEvents = connection.events((event) => {
      for (const sink of [...this.#sinks]) sink(event);
    });
    const unsubscribeClosed = connection.onClosed(() => {
      if (this.#connection !== connection) return;
      this.#dropConnection();
      void this.#restart();
    });
    this.#releaseConnection = () => {
      unsubscribeEvents();
      unsubscribeClosed();
    };
    this.#setState(GATEWAY_ATTACHMENT.ATTACHED);
    return undefined;
  }

  #dropConnection(): void {
    this.#releaseConnection?.();
    this.#releaseConnection = undefined;
    const held = this.#connection;
    this.#connection = undefined;
    held?.close();
  }

  /**
   * The connection went away while attached. Inside the budget the Gateway
   * is found again or started again; past it the failure is typed and every
   * request answers disconnected until an explicit attach.
   */
  async #restart(): Promise<void> {
    if (this.#state === GATEWAY_ATTACHMENT.STOPPED) return;
    const now = this.#now();
    const windowMs = this.#ports.restartWindowMs ?? GATEWAY_SUPERVISOR_DEFAULTS.RESTART_WINDOW_MS;
    const limit = this.#ports.restartLimit ?? GATEWAY_SUPERVISOR_DEFAULTS.RESTART_LIMIT;
    this.#restartsAt = this.#restartsAt.filter((at) => now - at < windowMs);
    if (this.#restartsAt.length >= limit) {
      this.#ports.report?.(
        `the Gateway went away ${limit} times inside ${windowMs} ms; not restarting it again automatically`,
      );
      this.#setState(GATEWAY_ATTACHMENT.FAILED);
      return;
    }
    this.#restartsAt.push(now);
    this.#setState(GATEWAY_ATTACHMENT.DETACHED);
    const result = await this.attach();
    if (result.outcome === GATEWAY_ATTACH_OUTCOME.FAILED) {
      this.#ports.report?.(`the Gateway could not be reattached: ${result.failure}`);
    }
  }

  #request(request: GatewayRequest): Promise<GatewayResponse> {
    const connection = this.#connection;
    if (!connection?.connected()) return Promise.resolve(disconnected(request.id));
    return connection.request(request);
  }

  #failed(failure: GatewayAttachFailure): GatewayAttachResult {
    if (this.#state !== GATEWAY_ATTACHMENT.STOPPED) this.#setState(GATEWAY_ATTACHMENT.FAILED);
    return { outcome: GATEWAY_ATTACH_OUTCOME.FAILED, failure };
  }

  /**
   * Waits for a process to leave, up to `waitMs`. A reattachment's drain
   * wait also ends when this supervisor is stopped, since a stopped client
   * has nothing left to wait for; the stop's own wait on the Gateway it
   * asked to leave runs to its bound regardless, because that wait is what
   * decides whether to kill.
   */
  async #waitForExit(
    pid: number,
    waitMs: number,
    options: { untilStopped?: boolean } = {},
  ): Promise<boolean> {
    const pollMs = this.#ports.discoveryPollMs ?? GATEWAY_SUPERVISOR_DEFAULTS.DISCOVERY_POLL_MS;
    const startedAt = this.#now();
    while (this.#ports.isAlive(pid)) {
      if (options.untilStopped && this.#state === GATEWAY_ATTACHMENT.STOPPED) return false;
      if (this.#now() - startedAt >= waitMs) return false;
      await this.#sleep(pollMs);
    }
    return true;
  }

  #setState(state: GatewayAttachment): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const listener of [...this.#stateListeners]) listener(state);
  }

  #now(): number {
    return (this.#ports.now ?? Date.now)();
  }

  #sleep(ms: number): Promise<void> {
    const schedule = this.#ports.setTimeout ?? ((work, delay) => setTimeout(work, delay));
    return new Promise((resolve) => {
      schedule(resolve, ms);
    });
  }
}
