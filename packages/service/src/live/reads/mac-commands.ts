/**
 * mac-commands.ts -- the account's unclaimed Mac commands' live read bound: its one statement, the table it reads, the topic that wakes it, and how often a held poll looks.
 *
 * The account's commands of the kinds the Mac's query names that no Mac has
 * claimed yet, read as its held read always read them
 * (`macCommandKindsRead`), each with the instant it was queued in epoch
 * milliseconds (`MAC_COMMANDS_READ`). Note that it names no claim window,
 * because a live read measures nothing from the clock: the claim
 * (`claimMacCommand`) keeps the window, on the service's clock.
 *
 * It is woken by a command queued, claimed, settled, or taken back, each of
 * which names the account, and a held poll looks at it every second, since
 * a Mac waits on what it hears.
 */

import { queryBuilder } from "@repo/database/core/query";
import { macCommand } from "@repo/database/schemas/mac-command";
import { TOPIC } from "@repo/database/sync/notification";
import { macCommandSync } from "@repo/database/sync/tables";
import { MAC_COMMANDS_READ } from "@repo/features/mac-command-live";
import { macCommandKindsRead } from "@repo/features/mac-command-wire";
import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { bindLiveRead, liveRowsStatement, WATCHED_LOOK } from "../live-read-binding.js";

export const macCommandsRead = bindLiveRead(MAC_COMMANDS_READ, {
  reads: [macCommandSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId, kinds }) => ({
    commands: liveRowsStatement(
      MAC_COMMANDS_READ.parts.commands,
      {
        ordered: false,
        columns: {
          id: macCommand.id,
          kind: macCommand.kind,
          // SAFETY: a shell command, the one kind a Mac reads, always holds its text, which the column alone does not say; it is selected as the column, so the statement names it as it always did.
          command: macCommand.command as unknown as SQL<string>,
          timeoutSeconds: macCommand.timeoutSeconds,
        },
        instants: { queuedAt: macCommand.queuedAt },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(macCommand)
          .where(
            and(
              eq(macCommand.userId, userId),
              inArray(macCommand.kind, macCommandKindsRead(kinds)),
              isNull(macCommand.claimedAt),
            ),
          ),
    ),
  }),
  look: WATCHED_LOOK,
});
