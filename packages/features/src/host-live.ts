import { Schema as EffectSchema } from "effect";
import { DEVICE_PLATFORM, HOST_UPDATE } from "./device-agent-wire.js";
import type { Host } from "./host-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";

export const hostsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ hosts: sealedLiveQuerySchema }),
  installScriptUrl: EffectSchema.String,
});

export type HostsLiveAnswer = typeof hostsLiveAnswerSchema.Type;

const hostLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  name: EffectSchema.String,
  platform: EffectSchema.String,
  machineId: EffectSchema.NullOr(EffectSchema.String),
  model: EffectSchema.NullOr(EffectSchema.String),
  update: EffectSchema.NullOr(EffectSchema.String),
});

export type HostLiveRow = typeof hostLiveRowSchema.Type;

export const hostsLiveRowsSchema = EffectSchema.Struct({
  hosts: EffectSchema.Array(hostLiveRowSchema),
});

export type HostLine = Pick<Host, "id" | "name" | "platform" | "machineId" | "model" | "update">;

const readPlatform = EffectSchema.decodeUnknownOption(
  EffectSchema.Literals(Object.values(DEVICE_PLATFORM)),
);
const readUpdate = EffectSchema.decodeUnknownOption(
  EffectSchema.Literals(Object.values(HOST_UPDATE)),
);

function byName(a: HostLiveRow, b: HostLiveRow): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

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
