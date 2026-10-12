import assert from "node:assert/strict";
import { test } from "vitest";
import { confirmingHold, desktopQuit, QUIT_STAGE } from "./quit";

/** A quit as the entry's `before-quit` answers one: held, or torn down. */
function askToQuit(quit: ReturnType<typeof desktopQuit>): void {
  if (quit.stage() === QUIT_STAGE.TORN_DOWN || quit.held()) return;
  void quit.teardown();
}

/** A question the test answers itself, and how many times it was asked. */
function question() {
  const answers: ((yes: boolean) => void)[] = [];
  return {
    answers,
    ask: () =>
      new Promise<boolean>((resolve) => {
        answers.push(resolve);
      }),
  };
}

test("a quit asked for while a call stands waits for a yes, asks once however often it is asked, and quits on the yes", async () => {
  const quit = desktopQuit();
  const asked = question();
  quit.holdWhile(
    confirmingHold({ standing: () => true, confirm: asked.ask, again: () => askToQuit(quit) }),
  );

  askToQuit(quit);
  askToQuit(quit);
  assert.equal(quit.stage(), QUIT_STAGE.STANDING, "nothing is torn down while the question stands");
  assert.equal(asked.answers.length, 1, "a second ⌘Q asks no second question");

  asked.answers[0]?.(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(quit.stage(), QUIT_STAGE.TORN_DOWN);
});

test("a quit the developer cancels leaves the call standing, and the next quit asks again", async () => {
  const quit = desktopQuit();
  const asked = question();
  quit.holdWhile(
    confirmingHold({ standing: () => true, confirm: asked.ask, again: () => askToQuit(quit) }),
  );

  askToQuit(quit);
  asked.answers[0]?.(false);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(quit.stage(), QUIT_STAGE.STANDING);
  assert.equal(quit.launchStanding(), true);

  askToQuit(quit);
  assert.equal(asked.answers.length, 2);
});

test("a quit with no call standing asks nothing and tears down at once", () => {
  const quit = desktopQuit();
  const asked = question();
  quit.holdWhile(
    confirmingHold({ standing: () => false, confirm: asked.ask, again: () => askToQuit(quit) }),
  );

  askToQuit(quit);
  assert.equal(asked.answers.length, 0);
  assert.equal(quit.launchStanding(), false);
});

test("a teardown already under way, as the updater's restart begins one, is never held", () => {
  const quit = desktopQuit();
  const asked = question();
  quit.holdWhile(
    confirmingHold({ standing: () => true, confirm: asked.ask, again: () => askToQuit(quit) }),
  );

  void quit.teardown();
  assert.equal(quit.held(), false);
  assert.equal(asked.answers.length, 0);
});
