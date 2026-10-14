/**
 * The quit, as the three states the launch and the entry both read. It is a
 * flag rather than a fiber because what asks for it is Electron's own
 * `before-quit`, which is a synchronous event the entry has to answer before
 * anything of the runtime can be awaited: the teardown is owed the instant
 * the ask lands, and a launch still suspended on one of its own waits has to
 * see that from the next statement it resumes on.
 */

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
