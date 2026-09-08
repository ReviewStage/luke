import fs from "node:fs/promises";
import path from "node:path";
import { isRecord, isWireNumber, type UnparsedWireValue } from "@sidecar/wire";

/**
 * The lock that keeps one Gateway writing under one state root. The Electron
 * host takes its own single-instance lock under the Gateway's distinct
 * profile first; this file is the portable half a client can read for the
 * holder's pid, and it is never trusted alone: a pid that is not alive is a
 * stale lock and is broken, and a pid that is alive still proves nothing
 * about health, which only a handshake and a hello answer. What the lock
 * refuses is the one thing it can: two hosts of this build opening the same
 * databases at once.
 */
export interface GatewayLockHolder {
  pid: number;
  startedAt: number;
}

export type GatewayLockAcquisition =
  | { acquired: true; release: () => Promise<void> }
  | { acquired: false; holder: GatewayLockHolder };

export interface GatewayLockOptions {
  filePath: string;
  pid: number;
  startedAt: number;
  /** Whether a process still runs; a holder that does not is stale and its lock is broken. */
  isAlive: (pid: number) => boolean;
}

const LOCK_FILE_MODE = 0o600;

function holderFromText(text: string): GatewayLockHolder | undefined {
  try {
    // SAFETY: JSON.parse returns a wire value; the reader is the validation.
    const value = JSON.parse(text) as UnparsedWireValue;
    if (!isRecord(value) || !isWireNumber(value.pid) || !isWireNumber(value.startedAt)) {
      return undefined;
    }
    return { pid: value.pid, startedAt: value.startedAt };
  } catch {
    return undefined;
  }
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // SAFETY: process.kill throws an ErrnoException; EPERM means the process exists under another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function acquireGatewayInstanceLock(
  options: GatewayLockOptions,
): Promise<GatewayLockAcquisition> {
  await fs.mkdir(path.dirname(options.filePath), { recursive: true, mode: 0o700 });
  const holder: GatewayLockHolder = { pid: options.pid, startedAt: options.startedAt };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(options.filePath, "wx", LOCK_FILE_MODE);
      try {
        await handle.writeFile(JSON.stringify(holder), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return {
        acquired: true,
        release: async () => {
          const standing = await readGatewayLockHolder(options.filePath);
          if (standing?.pid !== options.pid) return;
          await fs.unlink(options.filePath).catch(() => undefined);
        },
      };
    } catch (error) {
      // SAFETY: fs throws an ErrnoException; only its code is read, and any other error is rethrown.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const standing = await readGatewayLockHolder(options.filePath);
    if (standing && standing.pid !== options.pid && options.isAlive(standing.pid)) {
      return { acquired: false, holder: standing };
    }
    // Unreadable, or held by a process no longer running: the lock is stale
    // and the next attempt takes it.
    await fs.unlink(options.filePath).catch(() => undefined);
  }
  const standing = await readGatewayLockHolder(options.filePath);
  return { acquired: false, holder: standing ?? { pid: 0, startedAt: 0 } };
}

export async function readGatewayLockHolder(
  filePath: string,
): Promise<GatewayLockHolder | undefined> {
  try {
    return holderFromText(await fs.readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}
