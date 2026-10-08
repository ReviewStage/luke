import {
  carried,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  type NotebookReadResult,
} from "@sidecar/gateway";
import type { HostedNotebookClient } from "@sidecar/hosted";
import { Effect } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-notebook.ts -- the notebook read for the Settings page that shows what Luke has saved.
 *
 * The read asks only behind an open gate, since a run that sends nothing or
 * an account whose capabilities are down has nothing to ask, and answers the
 * service's own record or, short of one, an empty record the client reads as
 * unreadable just now. Nothing of it is kept here: the page that asked is the
 * one place it is drawn.
 */
export interface NotebookDependencies {
  runMode: Pick<RunMode, "sendsNetwork">;
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: Pick<HostedNotebookClient, "notebook">;
}

export function composeNotebook(dependencies: NotebookDependencies): Composer {
  const { runMode, account, client } = dependencies;
  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.NOTEBOOK_READ]: () =>
      Effect.gen(function* () {
        if (!runMode.sendsNetwork || !account.capabilitiesActive()) return {};
        const answer = yield* Effect.provide(client.notebook(), FetchHttpClient.layer);
        return answer === undefined ? {} : carried<NotebookReadResult>(answer);
      }),
  };
  return { methods, lifetime: Effect.void };
}
