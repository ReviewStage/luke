import { type CallCredential, resolvedCredential } from "@repo/features";
import { Effect, type Scope } from "effect";
import type { OpenTerminalSocket, TerminalSocketOpening } from "./compose-terminals.js";

const UNAUTHORIZED = 401;

function handshakeHeader(credential: CallCredential): Effect.Effect<string | undefined> {
  return Effect.flatMap(resolvedCredential(credential), (current) =>
    current.authorization === undefined ? Effect.succeed(undefined) : current.authorization(),
  );
}

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
