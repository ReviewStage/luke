/**
 * mac-command-live.ts -- the commands the account's agents queued for its Mac, as the Mac follows them over the service's held poll: the read declared, and the commands as the Mac claims them.
 *
 * The service answers one statement, the commands of the kinds the Mac runs
 * that no Mac of the account has claimed yet. The Mac claims each it hears
 * of (`mac-command-wire.ts`), on the service's clock, so a command left
 * waiting too long is refused there.
 */

import { Schema } from "effect";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_USER_QUERY } from "./live-wire.js";
import { type MacCommand, macCommandSchema } from "./mac-command-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber } from "./service-wire.js";

const [macShellCommandSchema] = macCommandSchema.members;

/**
 * The commands of the kinds a Mac runs that no Mac of the account has
 * claimed yet: one part, each the command of its kind, and when it was
 * queued in epoch milliseconds, the earliest queued first, so the Mac
 * claims them in the order they were asked for. The kinds are the read's
 * query as the Mac spells them (`macCommandKindsQuery`). Note that a column
 * its kind leaves null is read past, as every key a struct does not name is.
 */
export const MAC_COMMANDS_READ = liveRead({
  name: "macCommands",
  path: HOSTED_SERVICE_PATH.LIVE_MAC_COMMANDS,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER, kinds: LIVE_PARAM.OPTIONAL_TEXT },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    commands: liveRows({
      row: Schema.Struct({ ...macShellCommandSchema.fields, queuedAt: countedNumber }),
      key: "id",
      order: [
        ["queuedAt", ORDER.ASC],
        ["id", ORDER.ASC],
      ],
    }),
  },
});

export type MacCommandsLiveAnswer = LiveReadAnswer<typeof MAC_COMMANDS_READ>;

/** The unclaimed commands, the earliest queued first, so the Mac claims them in the order they were asked for. */
export function macCommandsOfLiveRows(
  rows: typeof MAC_COMMANDS_READ.rows.Type,
): readonly MacCommand[] {
  return orderedLiveRows(MAC_COMMANDS_READ.parts.commands, rows.commands).map(
    (row): MacCommand => ({
      id: row.id,
      kind: row.kind,
      command: row.command,
      timeoutSeconds: row.timeoutSeconds,
    }),
  );
}
