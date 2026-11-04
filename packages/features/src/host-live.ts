import { Schema as EffectSchema } from "effect";
import { DEVICE_PLATFORM, HOST_UPDATE } from "./device-agent-wire.js";
import type { Host } from "./host-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";

/**
 * host-live.ts -- the account's hosts as Settings › Hosts follows them over the service's held poll: the statement the service answers, the rows it delivers, and the hosts as the section draws them.
 *
 * The service answers one statement, every machine of the account's enrolled
 * with a secret of its own or made by a pairing's approve and not removed,
 * by name and then id, with the install script's address on its own origin
 * beside it, which no statement carries since it comes from the request.
 * Each row says only what the section draws: its name, its platform, which
 * machine it is and its model where its host said, and where its update
 * stands. A platform or an update this build does not know is read as none,
 * as the hosts read is read leniently, so one host of a newer kind hides none
 * of the others.
 */

/** The account's hosts sealed for following: the address, the one statement of its hosts, and the install script's address the section's commands name. */
export const hostsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ hosts: sealedLiveQuerySchema }),
  installScriptUrl: EffectSchema.String,
});

export type HostsLiveAnswer = typeof hostsLiveAnswerSchema.Type;

/** One host as the statement delivers it. */
const hostLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  name: EffectSchema.String,
  platform: EffectSchema.String,
  machineId: EffectSchema.NullOr(EffectSchema.String),
  model: EffectSchema.NullOr(EffectSchema.String),
  update: EffectSchema.NullOr(EffectSchema.String),
});

export type HostLiveRow = typeof hostLiveRowSchema.Type;

/** The account's hosts as Realtime delivers them, decoded at the boundary before anything reads them. */
export const hostsLiveRowsSchema = EffectSchema.Struct({
  hosts: EffectSchema.Array(hostLiveRowSchema),
});

/** One host as Settings › Hosts draws it: what the section reads of a listed host, and nothing else. */
export type HostLine = Pick<Host, "id" | "name" | "platform" | "machineId" | "model" | "update">;

const readPlatform = EffectSchema.decodeUnknownOption(
  EffectSchema.Literals(Object.values(DEVICE_PLATFORM)),
);
const readUpdate = EffectSchema.decodeUnknownOption(
  EffectSchema.Literals(Object.values(HOST_UPDATE)),
);

/** By name, then by id, as the statement orders them. */
function byName(a: HostLiveRow, b: HostLiveRow): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The account's hosts as the held read answers them, by name and then id, each field this build does not know left out. */
export function hostsOfLiveRows(rows: readonly HostLiveRow[]): readonly HostLine[] {
  return rows.toSorted(byName).map((row) => {
    const platform = readPlatform(row.platform);
    const update = readUpdate(row.update);
    return {
      id: row.id,
      name: row.name,
      ...(platform._tag === "Some" ? { platform: platform.value } : undefined),
      ...(row.machineId === null ? undefined : { machineId: row.machineId }),
      ...(row.model === null ? undefined : { model: row.model }),
      ...(update._tag === "Some" ? { update: update.value } : undefined),
    };
  });
}
