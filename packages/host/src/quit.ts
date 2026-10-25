/**
 * quit.ts -- the quit's three stages, the holds a quit passes first, and the one question every way out of Luke asks while something would be lost.
 *
 * The quit, as the three states the launch and the entry both read. It is a
 * flag rather than a fiber because what asks for it is Electron's own
 * `before-quit`, which is a synchronous event the entry has to answer before
 * anything of the runtime can be awaited: the teardown is owed the instant
 * the ask lands, and a launch still suspended on one of its own waits has to
 * see that from the next statement it resumes on.
 */

import { countWords, type Noun } from "@luke/features/words";

/** Where the process stands: nothing asked for, a teardown under way, or one finished. */
export const QUIT_STAGE = {
  STANDING: "standing",
  TEARING_DOWN: "tearing-down",
  TORN_DOWN: "torn-down",
} as const;

type QuitStage = (typeof QUIT_STAGE)[keyof typeof QUIT_STAGE];

export interface DesktopQuit {
  readonly stage: () => QuitStage;
  /**
   * Whether the launch may still open anything. It falls the instant a
   * teardown is asked for rather than when the runtime begins closing,
   * because the close is several awaited stops behind that ask: a start
   * suspended on one of its own waits would otherwise resume after the
   * teardown and open a window, claim the keys, and re-attach the listeners
   * the teardown just released.
   */
  readonly launchStanding: () => boolean;
  /**
   * A step the teardown runs before the runtime closes, in the order the
   * steps were registered. It is for what cannot wait for a service's own
   * stop: an action still held open for a panel that is going.
   */
  readonly beforeTeardown: (step: () => void) => void;
  /**
   * A check every quit asked for passes before its teardown begins,
   * answering whether it holds the quit back: a call standing asks the
   * developer first (`confirmingHold`).
   */
  readonly holdWhile: (hold: () => boolean) => void;
  /**
   * Whether a quit asked for now is held back rather than torn down. Only a
   * standing launch is held, so a teardown already under way, and the
   * updater's own quit behind it, are never asked twice.
   */
  readonly held: () => boolean;
  /**
   * The one teardown, made once whichever path asks for it: the explicit
   * Quit, a launch that could not stand up, or the updater before it lets
   * Squirrel replace this binary. Every later ask is handed the one under way
   * rather than a second pass over what has already been given back.
   */
  readonly teardown: () => Promise<void>;
  /**
   * What the teardown closes, supplied by the entry once it holds it. The
   * runtime cannot be built before this exists — the composition it is built
   * from reads the quit — so the one closure is set rather than constructed
   * here.
   */
  readonly closesThrough: (close: () => Promise<void>) => void;
}

export function desktopQuit(): DesktopQuit {
  let stage: QuitStage = QUIT_STAGE.STANDING;
  let close: (() => Promise<void>) | undefined;
  let tearingDown: Promise<void> | undefined;
  const preamble: (() => void)[] = [];
  const holds: (() => boolean)[] = [];

  return {
    stage: () => stage,
    launchStanding: () => stage === QUIT_STAGE.STANDING,
    beforeTeardown: (step) => {
      preamble.push(step);
    },
    holdWhile: (hold) => {
      holds.push(hold);
    },
    held: () => stage === QUIT_STAGE.STANDING && holds.some((hold) => hold()),
    closesThrough: (next) => {
      close = next;
    },
    teardown: () => {
      if (tearingDown) return tearingDown;
      stage = QUIT_STAGE.TEARING_DOWN;
      for (const step of preamble) step();
      tearingDown = (close?.() ?? Promise.resolve()).finally(() => {
        stage = QUIT_STAGE.TORN_DOWN;
      });
      return tearingDown;
    },
  };
}

/**
 * A hold that asks before a quit while `standing` says something would be
 * lost, as a Mac app asks before it ends a call: the quit is held while the
 * question stands, a second quit asked meanwhile asks nothing more, and a
 * yes asks for the quit `again`, which this hold then lets through. Nothing
 * standing holds nothing, so an ordinary quit asks nothing at all.
 */
export function confirmingHold(options: {
  standing: () => boolean;
  confirm: () => Promise<boolean>;
  again: () => void;
}): () => boolean {
  const { standing, confirm, again } = options;
  let asking = false;
  let agreed = false;
  return () => {
    if (agreed || !standing()) return false;
    if (asking) return true;
    asking = true;
    // A question that could not be asked is a no: the call is not ended
    // without one.
    void confirm()
      .then(
        (yes) => {
          if (!yes) return;
          agreed = true;
          again();
        },
        () => undefined,
      )
      .finally(() => {
        asking = false;
      });
    return true;
  };
}

/** A way out of Luke that asks first while something would be lost: a quit, a restart to install an update, a sign-out, or a window's page reloaded. */
export const LEAVE = {
  QUIT: "quit",
  RESTART: "restart",
  SIGN_OUT: "signOut",
  RELOAD: "reload",
} as const;

export type Leave = (typeof LEAVE)[keyof typeof LEAVE];

/** What a way out would lose: the call standing, edits the panel holds unsaved, and the terminals of this Mac Luke has open. */
export interface AtStake {
  readonly call: boolean;
  readonly unsavedWork: boolean;
  readonly macTerminals: number;
}

/** The sheet a way out asks with: the question, what goes, the act and Cancel, and which of them Return and Esc press. */
export interface LeaveQuestion {
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly [act: string, cancel: string];
  readonly defaultId: number;
  readonly cancelId: number;
}

/** The answer that leaves, by its place among the buttons. */
export const LEAVE_ANSWER = 0;

/** The answer that stays: Cancel, which Return and Esc both press. */
const STAY_ANSWER = 1;

/** What each way out asks, the act its button names, and whether it closes this Mac's terminals. */
const LEAVE_WORDS = {
  [LEAVE.QUIT]: { message: "Quit Luke?", act: "Quit", closesTerminals: true },
  [LEAVE.RESTART]: {
    message: "Restart Luke to update?",
    act: "Restart",
    closesTerminals: true,
  },
  [LEAVE.SIGN_OUT]: { message: "Sign out of Luke?", act: "Sign out", closesTerminals: false },
  [LEAVE.RELOAD]: { message: "Reload this window?", act: "Reload", closesTerminals: false },
} as const satisfies Record<Leave, { message: string; act: string; closesTerminals: boolean }>;

const MAC_TERMINAL: Noun = { one: "Mac terminal", many: "Mac terminals" };

/** What goes, one sentence for each thing at stake. */
const STAKE_WORDS = {
  CALL: "Your call with Luke will end.",
  UNSAVED_WORK: "Edits that haven't saved will be lost.",
  terminals: (count: number) =>
    `${countWords(count, MAC_TERMINAL)} will close, with what's running in ${count === 1 ? "it" : "them"}.`,
} as const;

/**
 * The question `leave` asks while something is at stake, naming each thing
 * that would be lost; none while nothing is, so an ordinary quit asks
 * nothing at all. Note that Cancel is the default, because Dean decided on
 * Oct 23 that a Return pressed out of habit must never end a call or lose
 * words; the act stands first, where macOS draws a sheet's leading button.
 */
export function leaveQuestion(leave: Leave, atStake: AtStake): LeaveQuestion | undefined {
  const words = LEAVE_WORDS[leave];
  const terminals = words.closesTerminals ? atStake.macTerminals : 0;
  const lost = [
    ...(atStake.call ? [STAKE_WORDS.CALL] : []),
    ...(atStake.unsavedWork ? [STAKE_WORDS.UNSAVED_WORK] : []),
    ...(terminals > 0 ? [STAKE_WORDS.terminals(terminals)] : []),
  ];
  if (lost.length === 0) return undefined;
  return {
    message: words.message,
    detail: lost.join(" "),
    buttons: [words.act, "Cancel"],
    defaultId: STAY_ANSWER,
    cancelId: STAY_ANSWER,
  };
}

/**
 * Puts a way out's question to the developer, one at a time: yes at once
 * where there is none, since nothing is at stake. A second ask while one
 * stands is a no, so a press repeated behind the sheet never stacks a second
 * sheet or acts on its own; a question that could not be put is a no as
 * well, since nothing is lost without one.
 */
function askingOneAtATime<Subject>(
  ask: (subject: Subject, question: LeaveQuestion) => Promise<boolean>,
): (subject: Subject, question: LeaveQuestion | undefined) => Promise<boolean> {
  let asking = false;
  return async (subject, question) => {
    if (question === undefined) return true;
    if (asking) return false;
    asking = true;
    try {
      return await ask(subject, question);
    } catch {
      return false;
    } finally {
      asking = false;
    }
  };
}

/** The one ask every way out of Luke goes through: yes at once while nothing is at stake, else the question put to the developer and their answer. */
export function leaveGate(options: {
  atStake: () => AtStake;
  ask: (question: LeaveQuestion) => Promise<boolean>;
}): (leave: Leave) => Promise<boolean> {
  const { atStake, ask } = options;
  const asked = askingOneAtATime<Leave>((_leave, question) => ask(question));
  return (leave) => asked(leave, leaveQuestion(leave, atStake()));
}

/**
 * The ask a window's reload goes through, on the same terms as a way out of
 * Luke: yes at once unless that page holds edits that haven't saved. Note
 * that a call is never at stake, because it stands in the voice window,
 * which no reload reaches, and neither are this Mac's terminals, which main
 * keeps open across a page's reload.
 */
export function reloadGate<Page>(options: {
  holds: (page: Page) => boolean;
  ask: (page: Page, question: LeaveQuestion) => Promise<boolean>;
}): (page: Page) => Promise<boolean> {
  const { holds, ask } = options;
  const asked = askingOneAtATime(ask);
  return (page) =>
    asked(
      page,
      leaveQuestion(LEAVE.RELOAD, { call: false, unsavedWork: holds(page), macTerminals: 0 }),
    );
}

/** Which windows say they hold unsaved work. */
export interface UnsavedWorkHolders<Sender> {
  /** What one window says: whether it holds unsaved work now. */
  readonly tell: (sender: Sender, holding: boolean) => void;
  /** Whether any window standing holds unsaved work. */
  readonly holding: () => boolean;
  /** Whether this one window holds unsaved work. */
  readonly holds: (sender: Sender) => boolean;
}

/**
 * Which windows say they hold unsaved work, each by its sender, for as long
 * as it says so and stands: a window that closed or crashed holds nothing
 * any longer, whatever it last said.
 */
export function unsavedWorkHolders<Sender>(
  gone: (sender: Sender) => boolean,
): UnsavedWorkHolders<Sender> {
  const holders = new Set<Sender>();
  return {
    tell: (sender, holding) => {
      if (holding) holders.add(sender);
      else holders.delete(sender);
    },
    holding: () => {
      for (const sender of holders) if (gone(sender)) holders.delete(sender);
      return holders.size > 0;
    },
    holds: (sender) => holders.has(sender) && !gone(sender),
  };
}
