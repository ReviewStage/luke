/**
 * integration-statuses.ts -- the account's integrations' live read bound: its one statement, the table it reads, the topic that wakes it, the sign-in window it binds from the clock, and the providers beside it.
 *
 * Every row the account holds: each by its id, under the name it goes by,
 * its provider, its label, and where it stands as stored
 * (`storedStatusWord`), each under the key the reader reads it by
 * (`INTEGRATION_STATUSES_READ`). The grant's subject, the state, and the
 * tools are never selected.
 *
 * It is woken on the account's integrations topic alone, which a sign-in
 * begun, completed, or ended, a label, an expiry, and a disconnect each
 * name. Note that a sign-in counts as under way while it began at
 * `issuedSince` or later, which is served from the clock, since a live
 * statement reads none; one that lapses with no write turns not pending
 * only as the read is looked at again. Which providers the account is
 * offered, and which take several accounts, come from the deployment and
 * the account's email, which no statement reads, so they are answered
 * beside the rows on every poll.
 */

import { queryBuilder } from "@repo/database/core/query";
import { integrationConnection } from "@repo/database/schemas/integration";
import { TOPIC } from "@repo/database/sync/notification";
import { integrationConnectionSync } from "@repo/database/sync/tables";
import { INTEGRATION_STATUSES_READ } from "@repo/features/integration-live";
import { INTEGRATION_PROVIDER_LIST } from "@repo/features/integration-wire";
import { eq } from "drizzle-orm";
import { Clock, Effect } from "effect";
import { hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { accountIntegrationConnect } from "../../integrations/integration-connect.js";
import { storedStatusWord } from "../../integrations/integration-store.js";
import { signInIssuedSince } from "../../integrations/integrations-app.js";
import { instantParam } from "../../sync/live-param.js";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

export const integrationStatusesRead = bindLiveRead(INTEGRATION_STATUSES_READ, {
  reads: [integrationConnectionSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT_INTEGRATIONS, userId]],
  statements: ({ userId, issuedSince }) => ({
    connections: liveRowsStatement(
      INTEGRATION_STATUSES_READ.parts.connections,
      {
        ordered: false,
        columns: {
          id: integrationConnection.id,
          connection: integrationConnection.connectionName,
          provider: integrationConnection.provider,
          label: integrationConnection.label,
          status: storedStatusWord(instantParam(issuedSince)),
        },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(integrationConnection)
          .where(eq(integrationConnection.userId, userId)),
    ),
  }),
  serve: () =>
    Effect.map(Clock.currentTimeMillis, (now) => ({ issuedSince: String(signInIssuedSince(now)) })),
  beside: ({ params }) =>
    Effect.map(hostedStoreOrUnavailable(accountIntegrationConnect(params.userId)), (connect) => {
      const offered = INTEGRATION_PROVIDER_LIST.filter((provider) => connect[provider].configured);
      return {
        offered,
        multiple: offered.filter((provider) => connect[provider].multipleAccounts),
      };
    }),
});
