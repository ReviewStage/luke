/**
 * hosts.ts -- the account's hosts' live read bound: its one statement, the tables it reads, the topic that wakes it, and the install script's address beside it.
 *
 * Every machine of the account's enrolled with a secret of its own or made
 * by a pairing's approve, and not removed, each with its id, name, platform,
 * machine and model, where its host reported them, and where its update
 * stands (`HOSTS_READ`). Note that a version stands for `listed()` here,
 * which a statement Realtime follows cannot carry, since it reads
 * `host_pairing`: a register never writes a version, an enroll writes it
 * beside the secret, a pairing's approve inserts the row with the box's
 * (`@repo/database/models/host-pairing-store`), a removal stamps
 * `removed_at`, and a later pairing's start deletes an approved host that
 * never collected its secret. The secret's hash is never selected, since what a statement
 * selects is what leaves.
 *
 * It is woken on the account's topic by a host enrolled, approved, renamed,
 * removed, or moving through an update, or reporting another platform,
 * machine, or model. Note that a beat wakes nothing, since `deviceSync`
 * ignores when a device was last seen: a window judges a host by its own
 * presence read.
 */

import { queryBuilder } from "@repo/database/core/query";
import { device } from "@repo/database/schemas/device";
import { TOPIC } from "@repo/database/sync/notification";
import { deviceSync } from "@repo/database/sync/tables";
import { HOSTS_READ } from "@repo/features/host-live";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { installScriptUrlOf } from "../../agents/hosts-procedures.js";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

export const hostsRead = bindLiveRead(HOSTS_READ, {
  reads: [deviceSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId }) => ({
    hosts: liveRowsStatement(
      HOSTS_READ.parts.hosts,
      {
        columns: {
          id: device.id,
          name: device.name,
          platform: device.platform,
          machineId: device.machineId,
          model: device.model,
          update: device.updatePhase,
        },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(device)
          .where(
            and(eq(device.userId, userId), isNull(device.removedAt), isNotNull(device.version)),
          ),
    ),
  }),
  beside: ({ request }) => Effect.succeed({ installScriptUrl: installScriptUrlOf(request) }),
});
