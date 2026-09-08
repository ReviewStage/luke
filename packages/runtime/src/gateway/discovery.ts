import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { GATEWAY_PROTOCOL_VERSION, type GatewayBuildIdentity } from "@sidecar/runtime-contracts";
import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";

/**
 * How a client finds the Gateway on this machine: one file under Luke's own
 * application data, readable by its owner alone, naming the loopback port the
 * host listens on and the token that authenticates a connection to it. The
 * token is minted once per host process and lives nowhere else on disk; a
 * client reads it here, sends it on the handshake, and keeps it out of its
 * own state and its logs. The file is published atomically and only once the
 * host is ready to answer, so a reader never finds a half-written record or a
 * port nothing is listening on yet.
 */
export interface GatewayDiscoveryRecord extends GatewayBuildIdentity {
  host: typeof GATEWAY_LOOPBACK_HOST;
  port: number;
  token: string;
  pid: number;
  startedAt: number;
}

export const GATEWAY_LOOPBACK_HOST = "127.0.0.1";

export const GATEWAY_DISCOVERY_FILE_MODE = 0o600;
export const GATEWAY_DISCOVERY_DIRECTORY_MODE = 0o700;
const TOKEN_BYTES = 32;

export function createGatewayToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function gatewayDiscoveryToWire(record: GatewayDiscoveryRecord): WireRecord {
  return {
    protocolVersion: record.protocolVersion,
    buildVersion: record.buildVersion,
    host: record.host,
    port: record.port,
    token: record.token,
    pid: record.pid,
    startedAt: record.startedAt,
  };
}

export function gatewayDiscoveryFromWire(
  value: UnparsedWireValue,
): GatewayDiscoveryRecord | undefined {
  if (!isRecord(value)) return undefined;
  const { protocolVersion, buildVersion, host, port, token, pid, startedAt } = value;
  if (!isWireNumber(protocolVersion) || !Number.isInteger(protocolVersion)) return undefined;
  if (!isWireString(buildVersion) || buildVersion.length === 0) return undefined;
  if (host !== GATEWAY_LOOPBACK_HOST) return undefined;
  if (!isWireNumber(port) || !Number.isInteger(port) || port <= 0 || port > 65_535) {
    return undefined;
  }
  if (!isWireString(token) || token.length === 0) return undefined;
  if (!isWireNumber(pid) || !Number.isInteger(pid) || pid <= 0) return undefined;
  if (!isWireNumber(startedAt)) return undefined;
  return { protocolVersion, buildVersion, host, port, token, pid, startedAt };
}

/**
 * Writes the record beside its final name and renames it into place, so a
 * reader sees the old record, the new one, or none, never a partial one. The
 * temporary file is created owner-only before a byte is written; the rename
 * carries the mode with it.
 */
export async function publishGatewayDiscovery(
  filePath: string,
  record: GatewayDiscoveryRecord,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), {
    recursive: true,
    mode: GATEWAY_DISCOVERY_DIRECTORY_MODE,
  });
  const temporary = `${filePath}.${record.pid}.${record.startedAt}.tmp`;
  const handle = await fs.open(temporary, "wx", GATEWAY_DISCOVERY_FILE_MODE);
  try {
    await handle.writeFile(JSON.stringify(gatewayDiscoveryToWire(record)), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, filePath);
}

/**
 * Reads the record, or nothing: for a missing file, a shape this build
 * cannot read, or, where the platform keeps file modes, a file another user
 * could read, since a token anyone can read authenticates no one.
 */
export async function readGatewayDiscovery(
  filePath: string,
): Promise<GatewayDiscoveryRecord | undefined> {
  let text: string;
  try {
    if (process.platform !== "win32") {
      const stat = await fs.stat(filePath);
      if ((stat.mode & 0o077) !== 0) return undefined;
    }
    text = await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
  try {
    // SAFETY: JSON.parse returns a wire value; the reader is the validation.
    return gatewayDiscoveryFromWire(JSON.parse(text) as UnparsedWireValue);
  } catch {
    return undefined;
  }
}

/**
 * Removes the record only while it still names the given process, so a host
 * leaving late never takes down the record its successor just published.
 */
export async function withdrawGatewayDiscovery(filePath: string, pid: number): Promise<boolean> {
  const standing = await readGatewayDiscovery(filePath);
  if (!standing || standing.pid !== pid) return false;
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Whether a record was published by a host this client can operate: the same protocol and the same build. */
export function discoveryMatchesBuild(
  record: GatewayBuildIdentity,
  expected: GatewayBuildIdentity,
): boolean {
  return (
    record.protocolVersion === expected.protocolVersion &&
    record.protocolVersion === GATEWAY_PROTOCOL_VERSION &&
    record.buildVersion === expected.buildVersion
  );
}
