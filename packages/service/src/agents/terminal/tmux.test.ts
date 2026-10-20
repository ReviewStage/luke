import assert from "node:assert/strict";
import { test } from "vitest";
import {
  attachTerminal,
  holdsTerminal,
  killTerminal,
  listTerminals,
  renameTerminal,
  startTerminal,
  TMUX,
  terminalsOf,
} from "./tmux.js";

/**
 * A Terminal tab's shells as tmux sessions in the agent's sandbox: the
 * commands that start, name, and end one name its session exactly, never by
 * a prefix tmux would take for another, and splice nothing into shell text;
 * a list reads back only the sessions a tab started, oldest first, each
 * named as the developer named it or as its foreground command is, and
 * running where that command is not the shell at its prompt. Every command
 * runs with the inheritable, ambient, and bounding capability sets emptied,
 * so tmux's server and its shells hold no capability and no sudo, the server
 * on a socket no server started before the drop listens on, and none
 * installs anything or reaches for sudo itself.
 */

/** What every command runs under: `setpriv` emptying each capability set, then the script's own shell. */
const CAPABILITIES_DROPPED = [
  "--inh-caps=-all",
  "--ambient-caps=-all",
  "--bounding-set=-all",
  "--",
  "sh",
  "-c",
];

/** The script a command runs, past the capability drop and `sh -c`. */
function scriptOf(ask: { readonly args: readonly string[] }): string | undefined {
  return ask.args[CAPABILITIES_DROPPED.length];
}

const SHELL_A = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const SHELL_B = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";

/** One field as the list prints it: what tmux printed, newline and all, in base64. */
const field = (value: string) => Buffer.from(`${value}\n`).toString("base64");

/** One line as the list prints it: the session's name, when it was created, and its free-text fields in base64. */
function listed(
  name: string,
  created: number,
  title: string,
  command: string,
  cwd: string,
): string {
  return [name, String(created), field(title), field(command), field(cwd)].join(" ");
}

test("starting, naming, and ending a shell target its session exactly and carry a name as one argument", () => {
  const exact = `=luke-${SHELL_A}`;
  const hostile = "dev server; rm -rf / $(id) 'q'";
  const started = startTerminal(SHELL_A, hostile);
  const renamed = renameTerminal(SHELL_A, hostile);
  const killed = killTerminal(SHELL_A);

  for (const ask of [started, renamed, killed]) {
    assert.ok(!scriptOf(ask)?.includes(hostile), "nothing typed is spliced into the script");
  }
  // tmux would take a bare name as a prefix of another session's; an option command takes the session's own pane.
  assert.ok(started.args.includes(`${exact}:`) && renamed.args.includes(`${exact}:`));
  assert.ok(killed.args.includes(exact));
  assert.equal(started.args.at(-1), hostile);
  assert.equal(renamed.args.at(-1), hostile);
  assert.ok(startTerminal(SHELL_A, undefined).args.includes(TMUX.START_DIRECTORY));
  assert.ok(!startTerminal(SHELL_A, undefined).args.includes(TMUX.TITLE_OPTION));
});

test("every command runs with every capability dropped, on a tmux server of its own, and none installs tmux or reaches for sudo", () => {
  const asks = [
    listTerminals(),
    startTerminal(SHELL_A, "dev server"),
    attachTerminal(SHELL_A),
    holdsTerminal(SHELL_A),
    renameTerminal(SHELL_A, "dev server"),
    killTerminal(SHELL_A),
  ];

  for (const ask of asks) {
    assert.equal(ask.command, "setpriv");
    assert.deepEqual(ask.args.slice(0, CAPABILITIES_DROPPED.length), CAPABILITIES_DROPPED);
    assert.doesNotMatch(scriptOf(ask) ?? "", /\b(sudo|apt-get|dnf)\b/);
    // A server on tmux's default socket may predate the drop and hold the capabilities still.
    assert.match(scriptOf(ask) ?? "", /tmux -L luke-unprivileged "\$@"/);
  }
});

test("a list reads back a tab's shells oldest first, named and marked running as they stand, and nothing else tmux holds", () => {
  const stdout = [
    listed(`luke-${SHELL_B}`, 200, "dev server", "node", "/workspace/repository/apps/web"),
    listed("main", 50, "", "bash", "/root"),
    listed("luke-not-an-id", 60, "", "bash", "/root"),
    listed(`luke-${SHELL_A}`, 100, "", "zsh", "/workspace/repository"),
    "",
  ].join("\n");

  assert.deepEqual(terminalsOf({ exitCode: 0, stdout, stderr: "" }), [
    { id: SHELL_A, title: "zsh", command: "zsh", cwd: "/workspace/repository", running: false },
    {
      id: SHELL_B,
      title: "dev server",
      command: "node",
      cwd: "/workspace/repository/apps/web",
      running: true,
    },
  ]);
});

test("a title or folder with spaces is read back whole, and a list that failed is none at all", () => {
  const stdout = listed(`luke-${SHELL_A}`, 100, "dev  server", "node", "/workspace/my app");

  assert.deepEqual(terminalsOf({ exitCode: 0, stdout, stderr: "" }), [
    { id: SHELL_A, title: "dev  server", command: "node", cwd: "/workspace/my app", running: true },
  ]);
  assert.deepEqual(terminalsOf({ exitCode: 0, stdout: "", stderr: "" }), []);
  assert.equal(terminalsOf({ exitCode: 1, stdout: "", stderr: "" }), undefined);
});
