import { Schema } from "effect";
import { DEVICE_PLATFORM, HOST_UPDATE } from "./device-agent-wire.js";
import type { Host } from "./host-wire.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

/**
 * host-live.ts -- the account's hosts as Settings › Hosts follows them over the service's held poll: the read declared, and the hosts as the section draws them.
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

/** The account's hosts as Settings › Hosts follows them: one part, every host of the account's by name and then id, and the install script's address its commands name. */
export const HOSTS_READ = liveRead({
  name: LIVE_READ.HOSTS,
  path: HOSTED_SERVICE_PATH.LIVE_HOSTS,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    hosts: liveRows({
      row: Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        platform: Schema.String,
        machineId: Schema.NullOr(Schema.String),
        model: Schema.NullOr(Schema.String),
        update: Schema.NullOr(Schema.String),
      }),
      key: "id",
      order: [
        ["name", ORDER.ASC],
        ["id", ORDER.ASC],
      ],
    }),
  },
  beside: { installScriptUrl: Schema.String },
});

export type HostsLiveAnswer = LiveReadAnswer<typeof HOSTS_READ>;

/** One host as the statement delivers it. */
export type HostLiveRow = LiveRowOf<typeof HOSTS_READ.parts.hosts>;

/** One host as Settings › Hosts draws it: what the section reads of a listed host, and nothing else. */
export type HostLine = Pick<Host, "id" | "name" | "platform" | "machineId" | "model" | "update">;

const readPlatform = Schema.decodeUnknownOption(Schema.Literals(Object.values(DEVICE_PLATFORM)));
const readUpdate = Schema.decodeUnknownOption(Schema.Literals(Object.values(HOST_UPDATE)));

/** The account's hosts as the held read answers them, by name and then id, each field this build does not know left out. */
export function hostsOfLiveRows(rows: readonly HostLiveRow[]): readonly HostLine[] {
  return orderedLiveRows(HOSTS_READ.parts.hosts, rows).map((row) => {
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
