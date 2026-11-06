import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import type { HostCapability } from "@repo/settings";
import { MICROPHONE_STATUS } from "@repo/settings/microphone";
import { NOTIFICATIONS_STATUS } from "@repo/settings/settings-controls";
import type { BuildCommit } from "@repo/settings/update";
import { keepIdentity } from "@repo/wire";
import { type Context, Effect, type Scope, Stream, SubscriptionRef } from "effect";
import {
  type AppState,
  NO_ACCESS,
  NO_AGENT_ORIGINS,
  NO_BROWSER_TABS,
  NO_CHAPTERS,
  NO_DESCRIPTION_COMMENTS,
  NO_HOLDER_INBOXES,
  NO_KEYS_HELD,
  NO_PAGES,
  NO_TRANSCRIPTS,
  UNREAD,
} from "../app-state.js";
import type { HostBootstrap } from "../host-operator.js";
import type { RunMode } from "../run-mode.js";
import { idleUpdateSnapshot } from "../update-service.js";

type AppStateSlice = Exclude<keyof AppState, "version">;

type AppStatePatch = { readonly [Slice in AppStateSlice]?: AppState[Slice] };

function patchEntries(patch: AppStatePatch): [AppStateSlice, AppState[AppStateSlice]][] {
  return Object.entries(patch) as [AppStateSlice, AppState[AppStateSlice]][];
}

export class AppStateStore {
  readonly #ref: SubscriptionRef.SubscriptionRef<AppState>;
  readonly #services: Context.Context<never>;
  #queued: (() => void)[] | undefined;

  constructor(initial: Omit<AppState, "version">, services: Context.Context<never>) {
    this.#services = services;
    this.#ref = Effect.runSyncWith(services)(
      SubscriptionRef.make<AppState>({ ...initial, version: 0 }),
    );
  }

  snapshot(): AppState {
    return Effect.runSyncWith(this.#services)(SubscriptionRef.get(this.#ref));
  }

  update(patch: AppStatePatch): void {
    this.#write(() => this.#apply(patch));
  }

  touch(): void {
    this.#write(() =>
      Effect.runSyncWith(this.#services)(SubscriptionRef.set(this.#ref, this.snapshot())),
    );
  }

  get changes(): Stream.Stream<AppState> {
    return SubscriptionRef.changes(this.#ref);
  }

  #write(write: () => void): void {
    if (this.#queued !== undefined) {
      this.#queued.push(write);
      return;
    }
    this.#queued = [write];
    try {
      for (let next = this.#queued.shift(); next !== undefined; next = this.#queued.shift()) next();
    } finally {
      this.#queued = undefined;
    }
  }

  #apply(patch: AppStatePatch): void {
    const previous = this.snapshot();
    const moved = patchEntries(patch).flatMap(([slice, value]) => {
      const kept = keepIdentity(previous[slice], value);
      return kept === previous[slice] ? [] : [[slice, kept] as const];
    });
    if (moved.length === 0) return;
    const next: AppState = {
      ...previous,
      ...Object.fromEntries(moved),
      version: previous.version + 1,
    };
    Effect.runSyncWith(this.#services)(SubscriptionRef.set(this.#ref, next));
  }
}

export function publishAppStateChanges(
  state: AppStateStore,
  publish: () => Effect.Effect<void>,
  report: (message: string) => void,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.asVoid(
    Effect.forkScoped(
      Stream.runForEach(state.changes, () =>
        Effect.catchDefect(Effect.withErrorReporting(publish(), { defectsOnly: true }), (defect) =>
          Effect.sync(() =>
            report(
              `the app-state push to windows failed: ${defect instanceof Error ? defect.message : String(defect)}`,
            ),
          ),
        ),
      ),
    ),
  );
}

export function bootstrapPatch(held: AppState, boot: HostBootstrap): AppStatePatch {
  return {
    settings: boot.settings,
    account: boot.account,
    access: boot.access,
    sessionReplay: { ...boot.sessionReplay, halted: held.sessionReplay.halted },
  };
}

interface ClientRunFacts {
  readonly launch: {
    readonly profile: string;
    readonly captureMode: boolean;
    readonly fixtureMode: boolean;
  };
  readonly runMode: Pick<RunMode, "requiresAccount" | "sendsNetwork">;
  readonly appVersion: string;
  readonly commit?: BuildCommit;
  readonly instance?: string;
  readonly packaged: boolean;
  readonly platform: string;
}

export function initialAppState(
  config: ClientRunFacts,
  installSupported: boolean,
  capabilities: readonly HostCapability[],
): Omit<AppState, "version"> {
  const { launch, runMode } = config;
  return {
    run: {
      profile: launch.profile,
      packaged: config.packaged,
      platform: config.platform,
      capabilities,
      appVersion: config.appVersion,
      ...(config.commit ? { commit: config.commit } : undefined),
      ...(config.instance === undefined ? undefined : { instance: config.instance }),
      captureMode: launch.captureMode,
      fixtureMode: launch.fixtureMode,
      accountRequired: runMode.requiresAccount,
    },
    account: { status: ACCOUNT_STATUS.SIGNED_OUT },
    access: NO_ACCESS,
    update: idleUpdateSnapshot(config.appVersion, installSupported),
    audio: { microphoneStatus: MICROPHONE_STATUS.NOT_DETERMINED },
    tasks: IDLE_TASKS_VIEW,
    agents: { unseen: [] },
    inbox: { waiting: [], tasks: [], taskless: [], automations: [], agents: [], failedRuns: [] },
    [LIVE_READ.ACCOUNT_PREFERENCES]: NO_KEYS_HELD,
    [LIVE_READ.AGENT_ORIGINS]: NO_AGENT_ORIGINS,
    [LIVE_READ.INBOX_ITEMS]: UNREAD,
    [LIVE_READ.HOLDER_INBOX]: NO_HOLDER_INBOXES,
    [LIVE_READ.INSTALLED_SKILLS]: NO_KEYS_HELD,
    [LIVE_READ.INTEGRATIONS]: NO_KEYS_HELD,
    [LIVE_READ.INTEGRATION_TOOLS]: NO_KEYS_HELD,
    [LIVE_READ.LINK_STANDINGS]: NO_KEYS_HELD,
    [LIVE_READ.MEMORIES]: NO_KEYS_HELD,
    [LIVE_READ.MODELS]: NO_KEYS_HELD,
    [LIVE_READ.PAGES]: NO_PAGES,
    [LIVE_READ.PROVIDER_KEYS]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST]: NO_KEYS_HELD,
    [LIVE_READ.REPOSITORY_LISTS]: NO_KEYS_HELD,
    [LIVE_READ.GITHUB_TOKEN]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST_CHAPTERS]: NO_CHAPTERS,
    [LIVE_READ.BROWSER_TABS]: NO_BROWSER_TABS,
    [LIVE_READ.PULL_REQUEST_CHECKS]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST_CONVERSATION]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST_PUBLISHED]: NO_KEYS_HELD,
    [LIVE_READ.PULL_REQUEST_VIEWED]: NO_KEYS_HELD,
    [LIVE_READ.REVIEW_OPTIONS]: NO_KEYS_HELD,
    [LIVE_READ.DEVICE_PRESENCE]: NO_KEYS_HELD,
    [LIVE_READ.HOSTS]: NO_KEYS_HELD,
    [LIVE_READ.WORKSPACE_INVITATIONS]: NO_KEYS_HELD,
    [LIVE_READ.THIS_MAC_HOST]: NO_KEYS_HELD,
    [LIVE_READ.TRANSCRIPT]: NO_TRANSCRIPTS,
    [LIVE_READ.WORKSPACE_MEMBERS]: NO_KEYS_HELD,
    [LIVE_READ.WORKSPACE_INTEGRATIONS]: NO_KEYS_HELD,
    [LIVE_READ.SLACK_CHANNELS]: NO_KEYS_HELD,
    [LIVE_READ.TOKEN_REPOSITORIES]: NO_KEYS_HELD,
    [LIVE_READ.WORKSPACE_PHOTOS]: NO_KEYS_HELD,
    [LIVE_READ.WORKSPACE_TOOLS]: NO_KEYS_HELD,
    [LIVE_READ.MCP_CLIENTS]: NO_KEYS_HELD,
    [LIVE_READ.AUTOMATIONS]: NO_KEYS_HELD,
    [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: NO_KEYS_HELD,
    [LIVE_READ.AUTOMATION_RUNS]: NO_KEYS_HELD,
    [LIVE_READ.DESCRIPTION_COMMENTS]: NO_DESCRIPTION_COMMENTS,
    [LIVE_READ.HISTORY]: NO_KEYS_HELD,
    [LIVE_READ.DESCRIPTION_DOCUMENT]: NO_KEYS_HELD,
    macCommands: { asks: [] },
    notifications: { status: NOTIFICATIONS_STATUS.UNKNOWN },
    network: { online: true, reachable: true },
    sessionReplay: { permitted: runMode.sendsNetwork, halted: false },
    portForwarding: null,
  };
}
