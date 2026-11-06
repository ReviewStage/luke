import childProcess from "node:child_process";
import os from "node:os";

const COMPUTER_NAME_TIMEOUT_MS = 2_000;

function computerName(): string {
  try {
    return childProcess
      .execFileSync("/usr/sbin/scutil", ["--get", "ComputerName"], {
        encoding: "utf8",
        timeout: COMPUTER_NAME_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();
  } catch {
    return "";
  }
}

export function macDeviceName(): string {
  const chosen = computerName();
  if (chosen.length > 0) return chosen;
  const host = os.hostname().replace(/\.local$/u, "");
  return host.length > 0 ? host : "This Mac";
}
