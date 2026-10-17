import { macRepositorySchema } from "@luke/features/mac-terminal-wire";
import { carried, GATEWAY_METHOD, invalid } from "@luke/gateway";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result } from "effect";
import type { Composer } from "./composer.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import type { SettingsStore } from "./settings-store.js";

/**
 * compose-mac-terminal.ts -- the run command each repository opens with in a terminal of this Mac, read and set.
 *
 * The terminal itself is the desktop's (`@luke/host/node`'s
 * `startMacTerminal`, behind its act rows); what the host keeps for it is
 * this Mac's run commands, held in the settings store beside the rest of
 * this Mac's settings. A host with no Mac to open a terminal on leaves this
 * concern out.
 */

export interface MacTerminalDependencies {
  store: Pick<SettingsStore, "macRepositories" | "setMacRepository">;
}

export function composeMacTerminal(dependencies: MacTerminalDependencies): Composer {
  const { store } = dependencies;
  const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.MAC_TERMINAL> = {
    [GATEWAY_METHOD.MAC_REPOSITORIES_READ]: () =>
      Effect.map(Effect.orDie(store.macRepositories()), (repositories) =>
        carried({ repositories }),
      ),
    [GATEWAY_METHOD.MAC_REPOSITORY_SET]: (params) =>
      Effect.gen(function* () {
        const read = readEither(macRepositorySchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("a repository names itself and its command or null");
        }
        yield* Effect.orDie(store.setMacRepository(read.success));
        return carried({ repositories: yield* Effect.orDie(store.macRepositories()) });
      }),
  };
  return { methods, lifetime: Effect.void };
}
