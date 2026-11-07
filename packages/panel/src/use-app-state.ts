import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  type AppStateDelivery,
  type AppStateSnapshot,
  withAppStateDelivery,
} from "@repo/host/app-state";
import {
  type AccountExperiment,
  type AccountExperimentChoices,
  accountExperimentChoices,
  type ExperimentChoices,
  experimentOn,
  type HostCapability,
  NO_EXPERIMENTS,
} from "@repo/settings";
import { type AppSettingsView, appSettingsView } from "@repo/settings/wire";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { Data, Effect } from "effect";
import { appBridge } from "./app-bridge.js";
import { QUERY_ROOT } from "./query-keys.js";
import { rendererPromise } from "./renderer-runtime.js";
import { onFixtureMoved } from "./tasks/fixture-moves.js";
import {
  handFixtureClient,
  loadedTasksFixture,
  loadTasksFixture,
} from "./tasks/tasks-fixture-loader.js";

/** The bridge refused the one read, so this window has no document to draw. */
class AppStateUnread extends Data.TaggedError("AppStateUnread")<{
  readonly cause: unknown;
}> {}

/**
 * The one rule a window adopts a delivery by. A delivery older than the one
 * held is dropped and nothing else is: the version rises with the document,
 * and a delivery that repeats it is this window's own facts having moved — its
 * mode, or the display under it — which the document does not number.
 *
 * What is adopted keeps the identity of every part of the held document a
 * delivery did not move (`withAppStateDelivery`): an entry it does not name
 * is the very object held, and one it names keeps every part of it that
 * said nothing new. A delivery crossed into this window as text, so without
 * that every memo and comparison keyed on what it carried would miss, and
 * every reader redraw, whatever moved.
 */
function adopt(held: AppStateSnapshot, delivery: AppStateDelivery): AppStateSnapshot {
  return delivery.version < held.version ? held : withAppStateDelivery(held, delivery);
}

/**
 * The document as this window draws it: main's, but in a fixture run, which
 * signs in to nothing, with what its profile stages laid over it, such as a
 * synthetic account signed in (`tasks-fixture.ts`'s `fixtureAppState`). Note
 * that the fixture is imported before the run's first document is handed
 * on, because no reader may draw that document unstaged first.
 */
function staged(state: AppStateSnapshot): Promise<AppStateSnapshot> {
  return loadTasksFixture().then(() => loadedTasksFixture()?.fixtureAppState(state) ?? state);
}

/** The document as main holds it, read once and staged in a fixture run. */
const firstRead: Effect.Effect<AppStateSnapshot, AppStateUnread> = Effect.flatMap(
  Effect.tryPromise({
    try: () => appBridge().requestAppState(),
    catch: (cause) => new AppStateUnread({ cause }),
  }),
  (read) => (read.run.fixtureMode ? Effect.promise(() => staged(read)) : Effect.succeed(read)),
);

/**
 * The document as one TanStack Query query, which a surface reads its part of
 * with `useQuery({ ...appStateQuery, select })` and a callback that cannot
 * wait a render with `getQueryData(appStateQuery.queryKey)` on the client
 * `useQueryClient` hands it. Every reading is written into the cache as it
 * arrives (`followAppState`), the first before anything is drawn, so it is
 * never stale (`staleTime: Infinity`, as the docs' guide to data pushed over
 * a socket has it) and never read again; its `queryFn`, a read of its own, stands only for a reader on a
 * client nothing follows into. A read the bridge refused is not tried
 * again, since the window shows that failure at once.
 *
 * Note that the read answers the document the client holds where that is as
 * new, because the subscription may have written a later reading while the
 * read was in flight, and Query lays what the `queryFn` answers over it.
 */
export const appStateQuery = queryOptions({
  queryKey: [QUERY_ROOT.APP_STATE],
  queryFn: ({ client }) =>
    rendererPromise(firstRead).then((read) => {
      const held: AppStateSnapshot | undefined = client.getQueryData([QUERY_ROOT.APP_STATE]);
      return held !== undefined && held.version >= read.version ? held : read;
    }),
  staleTime: Infinity,
  retry: false,
});

/** A window's subscription to `app:state`: how it stops, and how the whole document is asked for. */
interface Hearing {
  readonly stop: () => void;
  readonly read: () => Promise<AppStateSnapshot>;
}

/**
 * Subscribes to `app:state`; none where the bridge cannot be heard, as a
 * test's fake answering other calls alone cannot, which leaves the client on
 * the document seeded into it.
 */
function heard(onDelivered: (delivered: AppStateDelivery) => void): Hearing | undefined {
  try {
    const bridge = appBridge();
    return { stop: bridge.onAppState(onDelivered), read: () => bridge.requestAppState() };
  } catch {
    return undefined;
  }
}

/** A window's following of `app:state` into its Query client: its first whole read written, and how it stops. */
export interface AppStateFollowing {
  /** Settles once the first whole read is written into the client, and fails where the bridge refused it. */
  readonly written: Promise<void>;
  readonly stop: () => void;
}

/**
 * Writes every reading of the document into `client` with `setQueryData`,
 * as the docs' guide to data pushed over a socket does, from the moment it
 * is called until it is stopped. A root calls it once per window, before
 * anything is drawn, and draws once `written` settles, so the window's
 * first frame holds what moved while it was being read; a test's tree calls
 * it beside its own client (`testing/copy-feedback.ts`).
 *
 * A delivery is what moved since the last `app:state` sent, not the whole
 * document, and names no version it was built on, so it is laid only over a
 * whole read asked after subscribing: one heard before that read answers
 * waits for it and is laid over it then (`adopt`). A refused read leaves the
 * deliveries waiting, and the next one heard asks for the whole document
 * again, rather than lay them over a document they were not built on, such
 * as an older read or another account's.
 *
 * A fixture run's stage moving on its own (`fixture-moves.ts`) hands the
 * document held on to be staged anew, and its staging waits on the fixture,
 * so its writes queue behind one another; one that throws is reported and
 * passed over. The client is handed to the fixture while it is written
 * into, whose staged acts read the run from it (`act.ts`).
 */
export function followAppState(client: QueryClient): AppStateFollowing {
  let following = true;
  let held: AppStateSnapshot | undefined;
  let early: AppStateDelivery[] = [];
  let reading = false;
  let staging: Promise<void> | undefined;
  // Answers the staging the state waits on in a fixture run, and nothing where it is written at once.
  const write = (state: AppStateSnapshot): Promise<void> | undefined => {
    if (!state.run.fixtureMode && staging === undefined) {
      client.setQueryData(appStateQuery.queryKey, state);
      return undefined;
    }
    // Note that a staging that throws is reported and passed over, because the readings queued behind it must still land.
    const next = (staging ?? Promise.resolve())
      .then(() => staged(state))
      .then(
        (shown) => {
          if (following) client.setQueryData(appStateQuery.queryKey, shown);
        },
        (error: unknown) => {
          console.error("A fixture run's document could not be staged.", error);
        },
      )
      .then(() => {
        if (staging === next) staging = undefined;
      });
    staging = next;
    return next;
  };
  const readWhole = (hearing: Hearing): Promise<void> => {
    reading = true;
    return hearing.read().then(
      (read) => {
        reading = false;
        if (!following) return undefined;
        held = early.reduce(adopt, read);
        early = [];
        return write(held);
      },
      (cause: unknown) => {
        reading = false;
        throw cause;
      },
    );
  };
  const takeBack = handFixtureClient(client);
  const hearing = heard((delivered) => {
    if (held === undefined) {
      early.push(delivered);
      if (!reading && hearing !== undefined) {
        readWhole(hearing).catch((cause: unknown) => {
          console.error(
            "The window's state could not be read; the next delivery asks again.",
            cause,
          );
        });
      }
      return;
    }
    const next = adopt(held, delivered);
    if (next === held) return;
    held = next;
    write(next);
  });
  // Note that the read is asked after the subscription stands, so a delivery sent while it is in flight is heard.
  const written = hearing === undefined ? Promise.resolve() : readWhole(hearing);
  const stopMoves = onFixtureMoved(() => {
    if (held !== undefined) write(held);
  });
  return {
    written,
    stop: () => {
      following = false;
      hearing?.stop();
      stopMoves();
      takeBack();
    },
  };
}

/**
 * The document as `client` holds it, for a callback that cannot wait a
 * render: two acts asked in one breath arrive as two calls in one turn, and
 * the second has to read what the first left. The client is the caller's,
 * `useQueryClient`'s in a component and the one a test drew with in a test,
 * read with `getQueryData` as the docs' guide to reading the cache outside a
 * component does. Not a hook, so nothing redraws for it.
 */
export function appStateIn(client: QueryClient): AppStateSnapshot | undefined {
  return client.getQueryData(appStateQuery.queryKey);
}

/**
 * What a surface reads of the document, each a `select` for
 * `useQuery({ ...appStateQuery, select })`: one top-level slice, or one
 * answer made from one. Each is a module-level function, so its reference
 * stands still from render to render and Query runs it again only when the
 * document moves, as the docs' Render Optimizations guide asks of `select`.
 */
export const selectRun = (state: AppStateSnapshot) => state.run;
export const selectSettings = (state: AppStateSnapshot) => state.settings;
export const selectAccount = (state: AppStateSnapshot) => state.account;

/** Who is signed in, by the id and the address main's document names; none while none is. */
export interface SignedInAccount {
  readonly id: string | undefined;
  readonly email: string;
}

/** The account signed in, read for a `select` or from the document as it stands; none while none is. */
export const selectSignedIn = (state: AppStateSnapshot | undefined): SignedInAccount | undefined =>
  state?.account.status === ACCOUNT_STATUS.SIGNED_IN
    ? { id: state.account.id, email: state.account.email }
    : undefined;

/**
 * Whether two readings name one account: by id where both name one, else by
 * address. Note that an account signed in before its id is read names only
 * its address, so a refresh that brings the id is still that account.
 */
export function sameAccount(
  one: SignedInAccount | undefined,
  other: SignedInAccount | undefined,
): boolean {
  if (one === undefined || other === undefined) return one === other;
  return one.id !== undefined && other.id !== undefined
    ? one.id === other.id
    : one.email === other.email;
}
export const selectAccess = (state: AppStateSnapshot) => state.access;
export const selectUpdate = (state: AppStateSnapshot) => state.update;
export const selectAudio = (state: AppStateSnapshot) => state.audio;
export const selectTasks = (state: AppStateSnapshot) => state.tasks;
export const selectAgents = (state: AppStateSnapshot) => state.agents;
export const selectInbox = (state: AppStateSnapshot) => state.inbox;
export const selectPullRequestPublished = (state: AppStateSnapshot) =>
  state[LIVE_READ.PULL_REQUEST_PUBLISHED];
export const selectMacCommands = (state: AppStateSnapshot) => state.macCommands;
export const selectNotifications = (state: AppStateSnapshot) => state.notifications;
export const selectNetwork = (state: AppStateSnapshot) => state.network;
export const selectSessionReplay = (state: AppStateSnapshot) => state.sessionReplay;
export const selectWindow = (state: AppStateSnapshot) => state.window;
export const selectPortForwarding = (state: AppStateSnapshot) => state.portForwarding;
export const selectMirrors = (state: AppStateSnapshot) => state.mirrors;

/** The account's workspaces, which tell their readers only as the list moves, not as the tasks beside it do. */
export const selectWorkspaces = (state: AppStateSnapshot) => state.tasks.workspaces;

/**
 * Whether the first read has answered with settings: nothing is drawn over
 * a document without them, and the window reports itself painted on the
 * first that holds them.
 */
export const selectSettingsHeld = (state: AppStateSnapshot): boolean =>
  state.settings !== undefined;

/** The settings as the panel draws them. */
export const selectAppSettingsView = (state: AppStateSnapshot): AppSettingsView | undefined =>
  state.settings === undefined ? undefined : appSettingsView(state.settings);

/** Every experiment the account chose as its store holds them, a workspace experiment's old choice among them; signed out, every one is off. Read only to combine with a workspace's (`workspace-experiments.ts`). */
export const selectStoredExperimentChoices = (state: AppStateSnapshot): ExperimentChoices =>
  state.settings?.experiments ?? NO_EXPERIMENTS;

/** Every experiment of its own the account chose; signed out, every one is off. A workspace experiment is the workspace's, read through `workspace-experiments.ts`. */
export const selectExperimentChoices = memoizedSelect(
  (state: AppStateSnapshot) => [selectStoredExperimentChoices(state)],
  (choices: ExperimentChoices): AccountExperimentChoices => accountExperimentChoices(choices),
);

/** Whether the signed-in account is an admin; signed out, or where the host's read of it failed, none is. */
export const selectAdminAccess = (state: AppStateSnapshot): boolean => state.access.admin === true;

/** Whether the account's access is still being read, as it is for a moment after a sign-in or a launch. */
export const selectAdminAccessPending = (state: AppStateSnapshot): boolean =>
  state.access.pending === true;

const experimentSelects = new Map<AccountExperiment, (state: AppStateSnapshot) => boolean>();

/**
 * Whether the signed-in account has one of its own experiments on: the one
 * way an account experiment's row, command, and place ask. A workspace
 * experiment is asked of the workspace (`useWorkspaceExperiment`), so this
 * takes none. One function per experiment, made once and kept, so the
 * `select` a surface hands Query stands still from render to render. Signed
 * out, every experiment is off.
 */
export function selectExperiment(
  experiment: AccountExperiment,
): (state: AppStateSnapshot) => boolean {
  const held = experimentSelects.get(experiment);
  if (held !== undefined) return held;
  const select = (state: AppStateSnapshot): boolean =>
    experimentOn(selectExperimentChoices(state), experiment);
  experimentSelects.set(experiment, select);
  return select;
}

const capabilitySelects = new Map<HostCapability, (state: AppStateSnapshot) => boolean>();

/**
 * Whether the platform this window runs on offers one capability: the one
 * way a platform feature's tab, command, or button asks whether to stand at
 * all. One function per capability, made once and kept, as
 * `selectExperiment`'s are.
 */
export function selectCapability(capability: HostCapability): (state: AppStateSnapshot) => boolean {
  const held = capabilitySelects.get(capability);
  if (held !== undefined) return held;
  const select = (state: AppStateSnapshot): boolean => state.run.capabilities.includes(capability);
  capabilitySelects.set(capability, select);
  return select;
}

/**
 * A `select` whose answer is made once per change to the parts of the
 * document it reads, for every reader: `inputs` names those parts, and
 * `derive` is run again only when one of them is a new object. Note that
 * the last answer is kept rather than one per reader, because every reader
 * of a window reads the one document, so a delivery that moved none of the
 * parts hands each the same object. For an answer Query's structural
 * sharing cannot keep, such as a `Map` or a `Set`, which would otherwise be
 * made anew, and redraw its reader, on every delivery to any slice.
 */
export function memoizedSelect<Inputs extends unknown[], A>(
  inputs: (state: AppStateSnapshot) => [...Inputs],
  derive: (...inputs: Inputs) => A,
): (state: AppStateSnapshot) => A {
  let held: { readonly inputs: Inputs; readonly answer: A } | undefined;
  return (state) => {
    const next = inputs(state);
    if (held !== undefined && next.every((input, at) => input === held?.inputs[at])) {
      return held.answer;
    }
    held = { inputs: next, answer: derive(...next) };
    return held.answer;
  };
}
