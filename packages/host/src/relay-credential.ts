/**
 * relay-credential.ts -- a service relay's socket opened under the account's call credential, as the terminals and a cloud Browser tab's live view open theirs: the desktop's bearer as the handshake's header, or nothing of the host's own where the credential is a page's cookie, which the browser carries itself.
 */

import { type CallCredential, resolvedCredential } from "@luke/features";
import { Effect, type Scope } from "effect";
import type { OpenTerminalSocket, TerminalSocketOpening } from "./compose-terminals.js";

/** The status a relay refuses an upgrade with for want of an account it answers for. */
const UNAUTHORIZED = 401;

/** The header one attempt carries, read afresh from the credential as it stands now; none where it has nothing to carry. */
function handshakeHeader(credential: CallCredential): Effect.Effect<string | undefined> {
  return Effect.flatMap(resolvedCredential(credential), (current) =>
    current.authorization === undefined ? Effect.succeed(undefined) : current.authorization(),
  );
}

/**
 * A relay socket opened under the account's credential. A credential with
 * no header at all is a page's cookie session (`cookie-account-source.ts`),
 * which the browser carries on the handshake with the page's `Origin`, so
 * the socket opens with no header of the host's own; one that has a header
 * and reads none is a signed-out account, refused before anything opens. A
 * refusal of a header is renewed once, on a header that changed.
 */
export function openedUnderCredential(
  credential: CallCredential,
  openSocket: OpenTerminalSocket,
  address: string,
): Effect.Effect<TerminalSocketOpening, never, Scope.Scope> {
  return Effect.gen(function* () {
    const current = yield* resolvedCredential(credential);
    if (current.authorization === undefined) return yield* openSocket(address, {});
    const header = yield* current.authorization();
    if (header === undefined) return { refused: UNAUTHORIZED } satisfies TerminalSocketOpening;
    const opening = yield* openSocket(address, { authorization: header });
    if (!("refused" in opening) || opening.refused !== UNAUTHORIZED) return opening;
    yield* Effect.ignore(current.renew?.() ?? Effect.void);
    const renewed = yield* handshakeHeader(credential);
    if (renewed === undefined || renewed === header) return opening;
    return yield* openSocket(address, { authorization: renewed });
  });
}
