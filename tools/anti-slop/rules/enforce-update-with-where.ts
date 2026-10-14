import { writeWithWhereRule } from "../shared/write-with-where.ts";

/** Ban a Drizzle `update` with no `where`, which reaches every row of its table. */
export const enforceUpdateWithWhereRule = writeWithWhereRule("update");
