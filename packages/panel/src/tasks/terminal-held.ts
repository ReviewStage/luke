import { Store, useSelector } from "@tanstack/react-store";
import { Option, Schema } from "effect";
import { TERMINAL_KIND, type TerminalKind } from "./terminal-session.js";

/**
 * terminal-held.ts -- the terminals this window holds for each coding agent, each one tab, cloud or Local, kept across a reload.
 *
 * A terminal is minted here first, under an id of the window's own and its
 * name ("Cloud 1", "Local 1"), so its tab stands at once; the tab then opens
 * its shell (`use-terminal-session.ts`). The window keeps its terminals in
 * its session storage, which a reload keeps and a closed window forgets, and
 * Show terminal and Show local open their tabs again. A cloud terminal keeps
 * the id its sandbox answered for its shell, which runs on in tmux, so its
 * tab attaches to it again; a Local shell ends with the page, so its tab
 * opens a fresh one. Note that every list is kept under one key, nested by
 * account, then by kind, then by the agent's id, because a key is never
 * built from an id.
 * It holds ids and names, never a byte a shell printed. A terminal leaves
 * its list as its tab closes. The lists are one TanStack `Store` the window
 * holds (`use-terminal-session.ts`'s `TerminalsContext`), read from storage
 * as it is made and written through to it at each change.
 */

/** The one key the window's terminals are kept under. */
const HELD_KEY = "vespin.terminals";

/** What a terminal's name starts with, by kind, before its number. */
const TITLE_WORDS = {
  [TERMINAL_KIND.CLOUD]: "Cloud",
  [TERMINAL_KIND.LOCAL]: "Local",
} as const;

/** One terminal the window holds: the id it minted the terminal under, its name, and its shell's id where its host keeps it past a reload. */
const heldShellSchema = Schema.Struct({
  shell: Schema.String,
  title: Schema.String,
  terminal: Schema.optional(Schema.String),
});

export type HeldShell = typeof heldShellSchema.Type;

/** One kind's terminals, oldest first, by the agent's id. */
const heldByAgentSchema = Schema.Record(Schema.String, Schema.Array(heldShellSchema));

/** Every kind's terminals. */
const heldShellsSchema = Schema.Struct({
  [TERMINAL_KIND.CLOUD]: heldByAgentSchema,
  [TERMINAL_KIND.LOCAL]: heldByAgentSchema,
});

export type HeldShells = typeof heldShellsSchema.Type;

/**
 * Every account's terminals as the window keeps them: the account signed in
 * last on top, in the shape a build that held one list for every account
 * kept and still reads, which names that account (`account`, none for no
 * account), and every other account's under its key (`accounts`). Note that
 * a build before this one reads the top alone, and writes it alone, so a
 * value with no `accounts` is that build's, its top the account's signed in.
 */
const keptShellsSchema = Schema.Struct({
  [TERMINAL_KIND.CLOUD]: heldByAgentSchema,
  [TERMINAL_KIND.LOCAL]: heldByAgentSchema,
  account: Schema.optional(Schema.String),
  accounts: Schema.optional(Schema.Record(Schema.String, heldShellsSchema)),
});

const keptShellsJson = Schema.fromJsonString(keptShellsSchema);

/** The lists a window holds: each account's, by its key, none for no account; whose stand on top in storage; and those a build before this one kept, which the first account the window reads takes. */
interface HeldState {
  readonly accounts: ReadonlyMap<string | undefined, HeldShells>;
  readonly top: string | undefined;
  readonly unclaimed: HeldShells | undefined;
}

/** No terminal held. */
const NONE_HELD: HeldShells = { [TERMINAL_KIND.CLOUD]: {}, [TERMINAL_KIND.LOCAL]: {} };
const NOTHING_HELD: readonly HeldShell[] = [];

/** A window that kept nothing. */
const NONE_KEPT: HeldState = { accounts: new Map(), top: undefined, unclaimed: undefined };

/** What the window kept before a reload, or nothing where it kept none, it no longer reads, or storage refuses. */
function readHeld(): HeldState {
  try {
    const decoded = Schema.decodeUnknownOption(keptShellsJson)(
      window.sessionStorage.getItem(HELD_KEY),
    );
    if (Option.isNone(decoded)) return NONE_KEPT;
    const { cloud, local, account, accounts } = decoded.value;
    const top = { [TERMINAL_KIND.CLOUD]: cloud, [TERMINAL_KIND.LOCAL]: local };
    if (accounts === undefined) return { ...NONE_KEPT, unclaimed: top };
    const others = Object.entries(accounts).filter(([key]) => key !== account);
    return {
      accounts: new Map<string | undefined, HeldShells>([...others, [account, top]]),
      top: account,
      unclaimed: undefined,
    };
  } catch {
    return NONE_KEPT;
  }
}

/**
 * Keeps the window's terminals for the next reload, the account on top's in
 * the shape a build before this one reads and every other account's under
 * its own key, each read from its own entry so no write mixes two accounts;
 * a write that fails costs only the lists a reload reads. Note that no
 * account's lists are kept under a key but on top, since a key names an
 * account.
 */
function writeHeld(state: HeldState): void {
  const top = state.accounts.get(state.top) ?? NONE_HELD;
  const accounts = Object.fromEntries(
    [...state.accounts].flatMap(([key, shells]) =>
      key === undefined || key === state.top ? [] : [[key, shells] as const],
    ),
  );
  const kept = { ...top, ...(state.top === undefined ? {} : { account: state.top }), accounts };
  try {
    window.sessionStorage.setItem(HELD_KEY, Schema.encodeSync(keptShellsJson)(kept));
  } catch {
    // A reload then forgets the window's terminals.
  }
}

/** One account's terminals: its own, or, before any account took them, those a build before this one kept. */
function ownedOf(state: HeldState, account: string | undefined): HeldShells {
  return state.accounts.get(account) ?? state.unclaimed ?? NONE_HELD;
}

/** The state with what a build before this one kept taken by the account, where it holds none of its own. */
function claimed(state: HeldState, account: string | undefined): HeldState {
  if (state.unclaimed === undefined) return state;
  const accounts = state.accounts.has(account)
    ? state.accounts
    : new Map(state.accounts).set(account, state.unclaimed);
  return { ...state, accounts, unclaimed: undefined };
}

/**
 * Every terminal a window holds, by account, then by kind, then by agent:
 * what it kept before a reload, read as it is made, then each list written
 * through to storage.
 */
export class TerminalsHeld {
  /** The lists themselves; written only through `set` and `own`, which keep storage in step. */
  readonly all = new Store<HeldState>(readHeld());

  #write(next: HeldState): void {
    writeHeld(next);
    this.all.setState(() => next);
  }

  /** One kind's terminals of one agent of the account, oldest first. */
  of(account: string | undefined, kind: TerminalKind, agentId: string): readonly HeldShell[] {
    return ownedOf(this.all.state, account)[kind][agentId] ?? NOTHING_HELD;
  }

  /** Sets one kind's terminals of one agent of the account, written through to the window's session storage. */
  set(
    account: string | undefined,
    kind: TerminalKind,
    agentId: string,
    shells: readonly HeldShell[],
  ): void {
    const state = claimed(this.all.state, account);
    const owned = ownedOf(state, account);
    const { [agentId]: _was, ...others } = owned[kind];
    const next = {
      ...owned,
      [kind]: shells.length === 0 ? others : { ...others, [agentId]: shells },
    };
    this.#write({ ...state, accounts: new Map(state.accounts).set(account, next) });
  }

  /**
   * Puts the account signed in on top in storage, the last one's moved under
   * its own key, and gives it what a build before this one kept. Note that a
   * window signed out claims none of that, so it waits, in storage too, for
   * the account that signs in.
   */
  own(account: string | undefined): void {
    const state = account === undefined ? this.all.state : claimed(this.all.state, account);
    if (state === this.all.state && state.top === account) return;
    this.#write({ ...state, top: account });
  }
}

/** One kind's terminals of one agent the window holds for the account, oldest first, as a component reads them. */
export function useHeldShells(
  held: TerminalsHeld,
  account: string | undefined,
  kind: TerminalKind,
  agentId: string,
): readonly HeldShell[] {
  return useSelector(held.all, (all) => ownedOf(all, account)[kind][agentId] ?? NOTHING_HELD);
}

/** The terminals of every kind the window holds for the account, the same object until one changes. */
export function useOwnedShells(held: TerminalsHeld, account: string | undefined): HeldShells {
  return useSelector(held.all, (all) => ownedOf(all, account));
}

/** Whether the lists hold the terminal minted under `shell` of one kind's agent. */
export function holdsShell(
  owned: HeldShells,
  kind: TerminalKind,
  agentId: string,
  shell: string,
): boolean {
  return owned[kind][agentId]?.some((each) => each.shell === shell) === true;
}

/** The name a new terminal takes: its kind's word and the next number past every name of that shape the agent's terminals of the kind hold. */
export function nextShellTitle(kind: TerminalKind, shells: readonly HeldShell[]): string {
  const word = TITLE_WORDS[kind];
  const pattern = new RegExp(`^${word} (\\d+)$`, "u");
  const highest = shells
    .map((shell) => Number(pattern.exec(shell.title)?.[1]))
    .reduce((most, each) => (Number.isFinite(each) ? Math.max(most, each) : most), 0);
  return `${word} ${highest + 1}`;
}
