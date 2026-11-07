/**
 * account-preferences.ts -- the account's preferences' live read bound: its one statement, the table it reads, and the topic that wakes it.
 *
 * The account's own row, as stored: the coding agents' default as its three
 * columns stand, the chapters model, and whether our Slack bot writes the
 * account, each null where never chosen, which the reader reads as the
 * snapshot does (`ACCOUNT_PREFERENCES_READ`). No row for an account that
 * stored none.
 *
 * It is woken on the account's topic by a write to any column a view
 * reads. Note that a Start with Runs on, an enroll, and a register write
 * only the row's runs-on pick, and a settings push that changes nothing
 * writes only its instant; the capture ignores both, so none of them wakes
 * this read or the account's other reads.
 */

import { queryBuilder } from "@repo/database/core/query";
import { accountPreference } from "@repo/database/schemas/preferences";
import { TOPIC } from "@repo/database/sync/notification";
import { accountPreferenceSync } from "@repo/database/sync/tables";
import { ACCOUNT_PREFERENCES_READ } from "@repo/features/account-preferences-live";
import { eq } from "drizzle-orm";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

export const accountPreferencesRead = bindLiveRead(ACCOUNT_PREFERENCES_READ, {
  reads: [accountPreferenceSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId }) => ({
    preferences: liveRowsStatement(
      ACCOUNT_PREFERENCES_READ.parts.preferences,
      {
        ordered: false,
        columns: {
          agentModel: accountPreference.agentModel,
          agentEffort: accountPreference.agentEffort,
          agentContextWindow: accountPreference.agentContextWindow,
          chaptersModel: accountPreference.chaptersModel,
          slackNotifications: accountPreference.slackNotifications,
        },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(accountPreference)
          .where(eq(accountPreference.userId, userId)),
    ),
  }),
});
