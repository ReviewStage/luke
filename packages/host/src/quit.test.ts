import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  type AtStake,
  confirmingHold,
  desktopQuit,
  LEAVE,
  LEAVE_ANSWER,
  type Leave,
  type LeaveQuestion,
  leaveGate,
  leaveQuestion,
  QUIT_STAGE,
  reloadGate,
  unsavedWorkHolders,
} from "./quit.js";

const NOTHING: AtStake = { unsavedWork: false };

interface Asked {
  readonly question: LeaveQuestion;
  readonly answer: (leave: boolean) => void;
}

function composedQuit() {
  const panel = Symbol("panel");
  const unsavedWork = unsavedWorkHolders<symbol>(() => false);
  const atStake = () => ({ unsavedWork: unsavedWork.holding() });
  const asked: Asked[] = [];
  const askFirst = leaveGate({
    atStake,
    ask: (question) =>
      new Promise<boolean>((answer) => {
        asked.push({ question, answer });
      }),
  });
  const quit = desktopQuit();
  let quitAgain = 0;
  quit.holdWhile(
    confirmingHold({
      standing: () => leaveQuestion(LEAVE.QUIT, atStake()) !== undefined,
      confirm: () => askFirst(LEAVE.QUIT),
      again: () => {
        quitAgain += 1;
      },
    }),
  );
  return {
    quit,
    askFirst,
    asked,
    quitsAgain: () => quitAgain,
    tell: (holding: boolean) => unsavedWork.tell(panel, holding),
  };
}

function returnPresses(question: LeaveQuestion): string | undefined {
  return question.buttons[question.defaultId];
}

const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

it("a quit with unsaved description words asks first, with Cancel what Return and Esc press, and quits only once told to", async () => {
  const { quit, asked, quitsAgain, tell } = composedQuit();
  tell(true);

  assert.equal(quit.held(), true);
  assert.equal(asked.length, 1);
  const [{ question, answer }] = asked as [Asked];
  assert.equal(question.message, "Quit Vespin?");
  assert.equal(question.detail, "Edits that haven't saved will be lost.");
  assert.equal(returnPresses(question), "Cancel");
  assert.equal(question.cancelId, question.defaultId);
  assert.equal(question.buttons[LEAVE_ANSWER], "Quit");

  assert.equal(quit.held(), true);
  assert.equal(asked.length, 1);

  answer(false);
  await settled();
  assert.equal(quitsAgain(), 0);
  assert.equal(quit.stage(), QUIT_STAGE.STANDING);

  assert.equal(quit.held(), true);
  asked[1]?.answer(true);
  await settled();
  assert.equal(quitsAgain(), 1);
  assert.equal(quit.held(), false);
});

it("a quit with nothing at stake asks nothing, and a panel that says its words saved is at stake no longer", () => {
  const { quit, asked, tell } = composedQuit();

  assert.equal(quit.held(), false);
  tell(true);
  tell(false);
  assert.equal(quit.held(), false);
  assert.deepEqual(asked, []);
});

it("a window that is gone holds no unsaved work, whatever it last said", () => {
  let gone = false;
  const unsavedWork = unsavedWorkHolders<string>(() => gone);
  unsavedWork.tell("panel", true);

  assert.equal(unsavedWork.holding(), true);
  gone = true;
  assert.equal(unsavedWork.holding(), false);
});

it("a quit, a restart to update, and a sign-out ask under the same conditions, naming what each would lose", () => {
  const stakes: AtStake = { unsavedWork: true };
  const asks = (leave: Leave) => {
    const question = leaveQuestion(leave, stakes);
    assert.ok(question !== undefined);
    return {
      message: question.message,
      detail: question.detail,
      act: question.buttons[LEAVE_ANSWER],
      returnPresses: returnPresses(question),
    };
  };

  assert.deepEqual(asks(LEAVE.QUIT), {
    message: "Quit Vespin?",
    detail: "Edits that haven't saved will be lost.",
    act: "Quit",
    returnPresses: "Cancel",
  });
  assert.deepEqual(asks(LEAVE.RESTART), {
    message: "Restart Vespin to update?",
    detail: "Edits that haven't saved will be lost.",
    act: "Restart",
    returnPresses: "Cancel",
  });
  assert.deepEqual(asks(LEAVE.SIGN_OUT), {
    message: "Sign out of Vespin?",
    detail: "Edits that haven't saved will be lost.",
    act: "Sign out",
    returnPresses: "Cancel",
  });
  for (const leave of Object.values(LEAVE)) {
    assert.equal(leaveQuestion(leave, NOTHING), undefined);
  }
});

it("a restart to update asks while a panel holds unsaved words, goes at once while nothing would be lost, and a second press behind the sheet does nothing", async () => {
  const { askFirst, asked, tell } = composedQuit();

  assert.equal(await askFirst(LEAVE.RESTART), true);
  assert.equal(asked.length, 0);

  tell(true);
  const restart = askFirst(LEAVE.RESTART);
  assert.equal(await askFirst(LEAVE.RESTART), false);
  assert.equal(asked.length, 1);
  assert.equal(asked[0]?.question.message, "Restart Vespin to update?");
  asked[0]?.answer(true);
  assert.equal(await restart, true);
});

it("a question that could not be put is a no", async () => {
  const askFirst = leaveGate({
    atStake: () => ({ ...NOTHING, unsavedWork: true }),
    ask: () => Promise.reject(new Error("no window to ask on")),
  });

  assert.equal(await askFirst(LEAVE.QUIT), false);
});

it("the updater's own quit, behind the teardown it runs first, is never held, though words stand unsaved", async () => {
  const { quit, asked, tell } = composedQuit();
  tell(true);

  await quit.teardown();

  assert.equal(quit.stage(), QUIT_STAGE.TORN_DOWN);
  assert.equal(quit.held(), false);
  assert.deepEqual(asked, []);
});

function composedReload() {
  const unsavedWork = unsavedWorkHolders<string>(() => false);
  const asked: (Asked & { readonly page: string })[] = [];
  const askBeforeReload = reloadGate<string>({
    holds: unsavedWork.holds,
    ask: (page, question) =>
      new Promise<boolean>((answer) => {
        asked.push({ page, question, answer });
      }),
  });
  return { askBeforeReload, asked, tell: unsavedWork.tell };
}

it("a reload asks first, on that window, only while its own page holds unsaved words", async () => {
  const { askBeforeReload, asked, tell } = composedReload();

  assert.equal(await askBeforeReload("left"), true);
  tell("right", true);
  assert.equal(await askBeforeReload("left"), true);
  assert.equal(asked.length, 0);

  const reload = askBeforeReload("right");
  assert.equal(asked.length, 1);
  const [{ page, question, answer }] = asked as [(typeof asked)[number]];
  assert.equal(page, "right");
  assert.equal(question.message, "Reload this window?");
  assert.equal(question.detail, "Edits that haven't saved will be lost.");
  assert.equal(question.buttons[LEAVE_ANSWER], "Reload");
  assert.equal(returnPresses(question), "Cancel");

  assert.equal(await askBeforeReload("right"), false);
  assert.equal(asked.length, 1);

  answer(false);
  assert.equal(await reload, false);
});
