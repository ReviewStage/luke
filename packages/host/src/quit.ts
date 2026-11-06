import { PRODUCT_NAME } from "@repo/features/product-name";

export const QUIT_STAGE = {
  STANDING: "standing",
  TEARING_DOWN: "tearing-down",
  TORN_DOWN: "torn-down",
} as const;

type QuitStage = (typeof QUIT_STAGE)[keyof typeof QUIT_STAGE];

export interface DesktopQuit {
  readonly stage: () => QuitStage;
  readonly launchStanding: () => boolean;
  readonly beforeTeardown: (step: () => void) => void;
  readonly holdWhile: (hold: () => boolean) => void;
  readonly held: () => boolean;
  readonly teardown: () => Promise<void>;
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

export const LEAVE = {
  QUIT: "quit",
  RESTART: "restart",
  SIGN_OUT: "signOut",
  RELOAD: "reload",
} as const;

export type Leave = (typeof LEAVE)[keyof typeof LEAVE];

export interface AtStake {
  readonly unsavedWork: boolean;
}

export interface LeaveQuestion {
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly [act: string, cancel: string];
  readonly defaultId: number;
  readonly cancelId: number;
}

export const LEAVE_ANSWER = 0;

const STAY_ANSWER = 1;

const LEAVE_WORDS = {
  [LEAVE.QUIT]: { message: `Quit ${PRODUCT_NAME}?`, act: "Quit" },
  [LEAVE.RESTART]: { message: `Restart ${PRODUCT_NAME} to update?`, act: "Restart" },
  [LEAVE.SIGN_OUT]: { message: `Sign out of ${PRODUCT_NAME}?`, act: "Sign out" },
  [LEAVE.RELOAD]: { message: "Reload this window?", act: "Reload" },
} as const satisfies Record<Leave, { message: string; act: string }>;

const STAKE_WORDS = {
  UNSAVED_WORK: "Edits that haven't saved will be lost.",
} as const;

export function leaveQuestion(leave: Leave, atStake: AtStake): LeaveQuestion | undefined {
  const words = LEAVE_WORDS[leave];
  const lost = atStake.unsavedWork ? [STAKE_WORDS.UNSAVED_WORK] : [];
  if (lost.length === 0) return undefined;
  return {
    message: words.message,
    detail: lost.join(" "),
    buttons: [words.act, "Cancel"],
    defaultId: STAY_ANSWER,
    cancelId: STAY_ANSWER,
  };
}

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

export function leaveGate(options: {
  atStake: () => AtStake;
  ask: (question: LeaveQuestion) => Promise<boolean>;
}): (leave: Leave) => Promise<boolean> {
  const { atStake, ask } = options;
  const asked = askingOneAtATime<Leave>((_leave, question) => ask(question));
  return (leave) => asked(leave, leaveQuestion(leave, atStake()));
}

export function reloadGate<Page>(options: {
  holds: (page: Page) => boolean;
  ask: (page: Page, question: LeaveQuestion) => Promise<boolean>;
}): (page: Page) => Promise<boolean> {
  const { holds, ask } = options;
  const asked = askingOneAtATime(ask);
  return (page) => asked(page, leaveQuestion(LEAVE.RELOAD, { unsavedWork: holds(page) }));
}

export interface UnsavedWorkHolders<Sender> {
  readonly tell: (sender: Sender, holding: boolean) => void;
  readonly holding: () => boolean;
  readonly holds: (sender: Sender) => boolean;
}

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
