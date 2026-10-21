/**
 * relay-bearer.ts -- a service relay's socket opened under the account's bearer, as the terminals and a cloud Browser tab's live view open theirs.
 */

import { Effect, type Scope } from "effect";
import type { AccountComposer } from "./compose-account.js";
import type { OpenTerminalSocket, TerminalSocketOpening } from "./compose-terminals.js";

/** A relay socket opened under the account's bearer; a refusal of it is renewed once, on a bearer that changed. */
export function openedUnderBearer(
  token: Pick<AccountComposer, "token">["token"],
  openSocket: OpenTerminalSocket,
  address: string,
): Effect.Effect<TerminalSocketOpening, never, Scope.Scope> {
  return Effect.gen(function* () {
    const bearer = yield* token.readAccessToken();
    if (bearer === undefined) return { refused: 401 } satisfies TerminalSocketOpening;
    const opening = yield* openSocket(address, { authorization: `Bearer ${bearer}` });
    if (!("refused" in opening) || opening.refused !== 401) return opening;
    yield* Effect.ignore(token.refreshAccount());
    const renewed = yield* token.readAccessToken();
    if (renewed === undefined || renewed === bearer) return opening;
    return yield* openSocket(address, { authorization: `Bearer ${renewed}` });
  });
}
