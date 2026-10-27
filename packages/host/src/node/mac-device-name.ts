import childProcess from "node:child_process";
import os from "node:os";

/**
 * mac-device-name.ts -- a Mac's name as Runs on and an agent's tab say it, which This Mac and a Mac's host register under alike.
 */

/** How long the Mac's Computer Name is waited for, which `scutil` reads from the system's own configuration at once. */
const COMPUTER_NAME_TIMEOUT_MS = 2_000;

/** The Mac's Computer Name, as System Settings › General › About and Sharing say it; none where `scutil` answers nothing. */
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

/**
 * The Mac's name: its Computer Name, else its host name without the
 * `.local` Bonjour adds, else "This Mac". Note that the Computer Name comes
 * first, because the host name is often one the network or Bonjour
 * generated ("Mac-1898.lan") that the member never chose.
 */
export function macDeviceName(): string {
  const chosen = computerName();
  if (chosen.length > 0) return chosen;
  const host = os.hostname().replace(/\.local$/u, "");
  return host.length > 0 ? host : "This Mac";
}
