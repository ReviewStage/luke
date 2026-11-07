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
 * stands, and, for a host a pairing's approve made whose box has yet to
 * collect its secret, when that pairing lapses. Such a host is drawn until
 * that instant and gone from it, at the reader's own instant
 * (`hostsOfLiveRows`), since the statement cannot bound it by the clock and
 * only a later pairing's start deletes it. A platform or an update this build does not know is read as none,
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
        /** When the pairing that made the host lapses, in epoch milliseconds, while its box has yet to collect its secret; null once it has, or for a host no pairing made. Absent from a service that answers none. */
        pairingLapsesAt: Schema.optionalKey(Schema.NullOr(Schema.Number)),
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

/** When the pairing that made a host lapses while its box has yet to collect its secret; none for any other host. */
function lapseOf(row: HostLiveRow): number | undefined {
  return row.pairingLapsesAt ?? undefined;
}

/** The account's hosts as the held read answers them at `now`, by name and then id, those whose pairing lapsed uncollected left out, each field this build does not know left out. */
export function hostsOfLiveRows(rows: readonly HostLiveRow[], now: number): readonly HostLine[] {
  return orderedLiveRows(HOSTS_READ.parts.hosts, rows).flatMap((row) => {
    const lapse = lapseOf(row);
    if (lapse !== undefined && lapse <= now) return [];
    const platform = readPlatform(row.platform);
    const update = readUpdate(row.update);
    return [
      {
        id: row.id,
        name: row.name,
        ...(platform._tag === "Some" ? { platform: platform.value } : undefined),
        ...(row.machineId === null ? undefined : { machineId: row.machineId }),
        ...(row.model === null ? undefined : { model: row.model }),
        ...(update._tag === "Some" ? { update: update.value } : undefined),
      },
    ];
  });
}

/**
 * The instant after `now` the soonest uncollected host's pairing lapses, where
 * one does, which is when the hosts built from `rows` next leave one out
 * with no row moving; none where none will.
 */
export function nextHostLapse(rows: readonly HostLiveRow[], now: number): number | undefined {
  const lapsing = rows.flatMap((row) => {
    const lapse = lapseOf(row);
    return lapse !== undefined && lapse > now ? [lapse] : [];
  });
  return lapsing.length === 0 ? undefined : Math.min(...lapsing);
}
