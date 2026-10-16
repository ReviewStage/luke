import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "vitest";
import { closeEveryMacTerminal, type MacTerminalTools, startMacTerminal } from "./mac-terminal.js";

/**
 * A terminal of this Mac over this system's own `script`: the script runs on
 * a real terminal, takes what is typed, follows a resize, says how it ended,
 * and a close hangs up what it started. The test machine's `script` and
 * `stty` take Linux's arguments, which the tools seam hands in.
 */

const LINUX_TOOLS: MacTerminalTools = {
  script: (file) => ["script", ["-q", "-e", "-c", `/bin/bash ${file}`, "/dev/null"]],
  resize: (tty, cols, rows) => ["stty", ["-F", tty, "rows", String(rows), "cols", String(cols)]],
  hangUp: (tty) => ["pkill", ["-HUP", "-t", tty.replace(/^\/dev\//u, "")]],
};

/** A terminal running the script, and a promise of each output marker and of its end. */
function open(script: (ttyFile: string) => string) {
  let printed = "";
  const waiters: { text: string; resolve: () => void }[] = [];
  let exited: (code: number | null) => void = () => undefined;
  const ended = new Promise<number | null>((resolve) => {
    exited = resolve;
  });
  const terminal = startMacTerminal({
    build: script,
    tools: LINUX_TOOLS,
    onOutput: (bytes) => {
      printed += Buffer.from(bytes).toString("utf8");
      for (const waiter of waiters.splice(0)) {
        if (printed.includes(waiter.text)) waiter.resolve();
        else waiters.push(waiter);
      }
    },
    onExit: (code) => exited(code),
  });
  const until = (text: string) =>
    new Promise<void>((resolve) => {
      if (printed.includes(text)) resolve();
      else waiters.push({ text, resolve });
    });
  return { terminal, until, ended, printed: () => printed };
}

/** Whether a process of that id still runs. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("the script runs on a real terminal, takes what is typed, follows a resize, and says how it ended", async () => {
  const { terminal, until, ended, printed } = open((ttyFile) =>
    [
      `tty > ${ttyFile}`,
      "test -t 0 && echo on-a-terminal",
      "echo ready",
      "read -r line",
      'echo "typed:$line"',
      "read -r _",
      'echo "size:$(stty size)"',
      "exit 5",
      "",
    ].join("\n"),
  );

  await until("ready");
  terminal.write("hello\r");
  await until("typed:hello");
  terminal.resize(100, 40);
  // Note that the size is read after the resize has had its own command's time, by typing once more.
  execFileSync("sleep", ["0.2"]);
  terminal.write("\r");
  const code = await ended;

  assert.match(printed(), /on-a-terminal/u);
  assert.match(printed(), /size:40 100/u);
  assert.equal(code, 5);
});

test("a close hangs up what the terminal started", async () => {
  const { terminal, until, ended, printed } = open((ttyFile) =>
    [`tty > ${ttyFile}`, 'sleep 60 & echo "child:$!"', "wait", ""].join("\n"),
  );

  await until("child:");
  const child = Number(/child:(\d+)/u.exec(printed())?.[1]);
  assert.ok(alive(child));
  terminal.close();
  await ended;
  execFileSync("sleep", ["0.2"]);

  assert.equal(alive(child), false);
});

test("closing every terminal ends what each still open started", async () => {
  const one = open((ttyFile) =>
    [`tty > ${ttyFile}`, 'sleep 60 & echo "child:$!"', "wait", ""].join("\n"),
  );
  await one.until("child:");
  const child = Number(/child:(\d+)/u.exec(one.printed())?.[1]);

  closeEveryMacTerminal();
  await one.ended;
  execFileSync("sleep", ["0.2"]);

  assert.equal(alive(child), false);
});

test("a close hangs up a job in a process group of its own on the terminal", async () => {
  const { terminal, until, ended, printed } = open((ttyFile) =>
    [`tty > ${ttyFile}`, "set -m", 'sleep 60 & echo "child:$!"', "wait", ""].join("\n"),
  );

  await until("child:");
  const child = Number(/child:(\d+)/u.exec(printed())?.[1]);
  assert.ok(alive(child));
  terminal.close();
  await ended;
  execFileSync("sleep", ["0.2"]);

  assert.equal(alive(child), false);
});

test("a terminal that cannot start says why and ends, and Luke goes on", async () => {
  let printed = "";
  const code = await new Promise<number | null>((resolve) => {
    startMacTerminal({
      build: () => "",
      tools: { ...LINUX_TOOLS, script: () => ["/nonexistent/script", []] },
      onOutput: (bytes) => {
        printed += Buffer.from(bytes).toString("utf8");
      },
      onExit: resolve,
    });
  });

  assert.equal(code, null);
  assert.match(printed, /Could not start a terminal: .*ENOENT/u);
});

// This Mac's own `script`, as Luke starts it: under a parent whose pipes are sockets, as Node's are on macOS.
test.runIf(process.platform === "darwin")(
  "on macOS the script runs on a real terminal, takes what is typed, and says how it ended",
  async () => {
    let printed = "";
    let typed: (data: string) => void = () => undefined;
    const ended = new Promise<number | null>((resolve) => {
      const terminal = startMacTerminal({
        build: (ttyFile) =>
          [`tty > ${ttyFile}`, "tty", "read line", 'echo "got:$line"', "exit 3", ""].join("\n"),
        onOutput: (bytes) => {
          printed += Buffer.from(bytes).toString("utf8");
        },
        onExit: resolve,
      });
      typed = (data) => terminal.write(data);
    });
    typed("hello\n");

    assert.equal(await ended, 3);
    assert.match(printed, /\/dev\/ttys\d+/u);
    assert.match(printed, /got:hello/u);
    assert.doesNotMatch(printed, /Operation not supported/u);
  },
);
