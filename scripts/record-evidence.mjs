#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { packagedAppExecutable } from "../apps/desktop/scripts/package-layout.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const evidenceRoot = path.join(repoRoot, "artifacts", "evidence");
const appExecutable = packagedAppExecutable(repoRoot);
const recordingPath = path.join(evidenceRoot, "app-hover-transition.mov");
const mp4Path = path.join(evidenceRoot, "app-hover-transition.mp4");
const gifPath = path.join(evidenceRoot, "app-hover-transition.gif");
const electronExecutable = path.join(desktopRoot, "node_modules", ".bin", "electron");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(2_000)]);
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || !("port" in address)) throw new Error("Could not allocate a port");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForTarget(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const targetsResponse = await fetch(`http://127.0.0.1:${port}/json`);
      if (targetsResponse.ok) {
        const targets = await targetsResponse.json();
        const page = targets.find((target) => target.type === "page");
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {
      // The app is still starting.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the Electron renderer");
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  return {
    close: () => socket.close(),
    call(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
  };
}

async function main() {
  if (process.platform !== "darwin") throw new Error("Screen recording requires macOS");
  await run("pnpm", ["package"], { cwd: repoRoot });
  await fs.access(appExecutable);
  await fs.mkdir(evidenceRoot, { recursive: true });
  await Promise.all(
    [recordingPath, mp4Path, gifPath].map((outputPath) => fs.rm(outputPath, { force: true })),
  );

  const port = await availablePort();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "luke-recording-"));
  const appProcess = spawn(
    appExecutable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--fixture",
      "smoke",
      "--compact",
    ],
    { stdio: "ignore" },
  );

  let backdropProcess;
  let rendererCdp;
  try {
    const target = await waitForTarget(port);
    rendererCdp = await connectCdp(target.webSocketDebuggerUrl);
    await delay(500);

    const windowResult = await rendererCdp.call("Runtime.evaluate", {
      expression:
        "({ left: window.screenX, top: window.screenY, width: window.outerWidth, height: window.outerHeight })",
      returnByValue: true,
    });
    const bounds = windowResult.result.value;
    const expandedWidth = 620;
    const expandedHeight = 520;
    const captureX = Math.round(bounds.left - (expandedWidth - bounds.width) / 2);
    const captureY = Math.round(bounds.top);
    const captureRegion = `${captureX},${captureY},${expandedWidth},${expandedHeight}`;
    const backdropScript = path.join(profile, "backdrop.cjs");
    await fs.writeFile(
      backdropScript,
      `const { app, BrowserWindow } = require("electron");
let window;
app.whenReady().then(() => {
  window = new BrowserWindow({
    x: Number(process.argv[2]), y: Number(process.argv[3]),
    width: Number(process.argv[4]), height: Number(process.argv[5]),
    frame: false, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, show: false, backgroundColor: "#111318",
  });
  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.loadURL("data:text/html,<body style='margin:0;background:%23111318'></body>");
  window.once("ready-to-show", () => window.showInactive());
});
`,
    );
    backdropProcess = spawn(
      electronExecutable,
      [
        backdropScript,
        String(captureX),
        String(captureY),
        String(expandedWidth),
        String(expandedHeight),
      ],
      { stdio: "ignore" },
    );
    await delay(500);
    const recorder = spawn(
      "/usr/sbin/screencapture",
      ["-v", "-V6", "-x", `-R${captureRegion}`, recordingPath],
      { stdio: "inherit" },
    );

    await delay(700);
    await rendererCdp.call("Runtime.evaluate", {
      expression: "window.sidecar.setExpanded(true)",
      awaitPromise: true,
    });
    await delay(1_700);
    await rendererCdp.call("Runtime.evaluate", {
      expression: "window.sidecar.setExpanded(false)",
      awaitPromise: true,
    });
    await delay(1_700);
    await rendererCdp.call("Runtime.evaluate", {
      expression: "window.sidecar.setExpanded(true)",
      awaitPromise: true,
    });

    await new Promise((resolve, reject) => {
      recorder.once("error", reject);
      recorder.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`screencapture exited with ${code ?? signal}`));
      });
    });

    await run("ffmpeg", [
      "-y",
      "-i",
      recordingPath,
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mp4Path,
    ]);
    await run("ffmpeg", [
      "-y",
      "-i",
      recordingPath,
      "-vf",
      "fps=15,scale=620:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
      gifPath,
    ]);
    process.stdout.write(`Screen recording: ${mp4Path}\nAnimated preview: ${gifPath}\n`);
  } finally {
    rendererCdp?.close();
    await Promise.all([terminate(backdropProcess), terminate(appProcess)]);
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

await main();
