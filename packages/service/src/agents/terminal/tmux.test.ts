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

function scriptOf(ask: { readonly args: readonly string[] }): string | undefined {
  return ask.args[1];
}

const SHELL_A = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const SHELL_B = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";

const field = (value: string) => Buffer.from(`${value}\n`).toString("base64");

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
  const exact = `=terminal-${SHELL_A}`;
  const hostile = "dev server; rm -rf / $(id) 'q'";
  const started = startTerminal(SHELL_A, hostile);
  const renamed = renameTerminal(SHELL_A, hostile);
  const killed = killTerminal(SHELL_A);

  for (const ask of [started, renamed, killed]) {
    assert.ok(!scriptOf(ask)?.includes(hostile), "nothing typed is spliced into the script");
  }
  assert.ok(started.args.includes(`${exact}:`) && renamed.args.includes(`${exact}:`));
  assert.ok(killed.args.includes(exact));
  assert.equal(started.args.at(-1), hostile);
  assert.equal(renamed.args.at(-1), hostile);
  assert.ok(startTerminal(SHELL_A, undefined).args.includes(TMUX.START_DIRECTORY));
  assert.ok(!startTerminal(SHELL_A, undefined).args.includes(TMUX.TITLE_OPTION));
});

test("every command runs on a tmux server of its own, and none installs tmux or reaches for sudo", () => {
  const asks = [
    listTerminals(),
    startTerminal(SHELL_A, "dev server"),
    attachTerminal(SHELL_A),
    holdsTerminal(SHELL_A),
    renameTerminal(SHELL_A, "dev server"),
    killTerminal(SHELL_A),
  ];

  for (const ask of asks) {
    assert.deepEqual(ask.args.slice(0, 1), ["-c"]);
    assert.doesNotMatch(scriptOf(ask) ?? "", /\b(sudo|apt-get|dnf)\b/);
    assert.match(scriptOf(ask) ?? "", /tmux -L terminal "\$@"/);
  }
});

test("a list reads back a tab's shells oldest first, named and marked running as they stand, and nothing else tmux holds", () => {
  const stdout = [
    listed(`terminal-${SHELL_B}`, 200, "dev server", "node", "/workspace/repository/apps/web"),
    listed("main", 50, "", "bash", "/root"),
    listed("terminal-not-an-id", 60, "", "bash", "/root"),
    listed(`terminal-${SHELL_A}`, 100, "", "zsh", "/workspace/repository"),
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
  const stdout = listed(`terminal-${SHELL_A}`, 100, "dev  server", "node", "/workspace/my app");

  assert.deepEqual(terminalsOf({ exitCode: 0, stdout, stderr: "" }), [
    { id: SHELL_A, title: "dev  server", command: "node", cwd: "/workspace/my app", running: true },
  ]);
  assert.deepEqual(terminalsOf({ exitCode: 0, stdout: "", stderr: "" }), []);
  assert.equal(terminalsOf({ exitCode: 1, stdout: "", stderr: "" }), undefined);
});
