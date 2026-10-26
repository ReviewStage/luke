/**
 * hosts-procedures.ts -- the account's hosts as Settings › Agents › Hosts reads and changes them: listed, removed, and the install tokens that add them kept and revoked.
 *
 * Every procedure is the account's own, on its bearer or its browser's
 * session (`accountMiddleware`), so the Hosts list works in a browser and on
 * a phone as in the desktop, and answers not found, before it touches a row,
 * where the account has the `local-agents` experiment off. An install token
 * reaches here as its SHA-256 alone: the member's own Luke mints the token
 * and shows it where the member is, so the service never holds it. A host
 * removed is refused at once on its secret (`auth/device-secret.ts`); a token
 * revoked enrolls no box again and touches none it already enrolled. Each
 * host is listed with whether its daemon is below the floor, and every
 * answer names the install script on the service's own origin, which the
 * install and upgrade commands name (`@luke/features/host-wire`).
 */

import { accountExperimentOn } from "@luke/database/models/account-store";
import {
  hostsOf,
  mintHostInstallToken,
  removeHost,
  revokeHostInstallToken,
} from "@luke/database/models/host-store";
import { HOST_WIRE, hostVersionMeets } from "@luke/features/host-wire";
import { EXPERIMENT } from "@luke/settings";
import { Effect } from "effect";
import { HOST_VERSION } from "../auth/device-secret.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";

export interface HostsProcedureSeams {
  /** The account behind a request: its bearer, or a browser's session cookie (`accountMiddleware`). */
  resolveUserId: UserIdResolver;
}

const DONE = { done: true } as const;

/** Not found where the account has the `local-agents` experiment off, which hosts sit behind as This Mac does. */
const experimentOn = (userId: string) =>
  Effect.gen(function* () {
    if (!(yield* hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.LOCAL_AGENTS)))) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
  });

/** The install script's address on the origin the request reached, so a Preview's command names its own. */
function installScriptUrlOf(request: Request): string {
  return new URL(HOST_WIRE.INSTALL_SCRIPT_PATH, new URL(request.url).origin).href;
}

/** Kept, or not found where the account holds no such row. */
const keptOrNotFound = (kept: boolean) =>
  kept ? Effect.succeed(DONE) : Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

/** The hosts resource, on the account's bearer or session. */
export function hostsProcedures(seams: HostsProcedureSeams) {
  const hosts = hosted.hosts.use(accountMiddleware(seams.resolveUserId));
  return {
    list: hosts.list.effect(function* ({ context }) {
      yield* experimentOn(context.userId);
      const rows = yield* hostedStoreOrUnavailable(hostsOf(context.userId));
      return {
        hosts: rows.map((row) => ({
          id: row.id,
          name: row.name,
          seenAt: row.lastSeenAt.getTime(),
          version: row.version,
          upgradeNeeded: row.version === null || !hostVersionMeets(row.version, HOST_VERSION.FLOOR),
        })),
        installScriptUrl: installScriptUrlOf(context.request),
      };
    }),
    remove: hosts.remove.effect(function* ({ context, input }) {
      yield* experimentOn(context.userId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(removeHost(context.userId, input.id)),
      );
    }),
    keepInstallToken: hosts.keepInstallToken.effect(function* ({ context, input }) {
      yield* experimentOn(context.userId);
      const minted = yield* hostedStoreOrUnavailable(
        mintHostInstallToken(context.userId, input.tokenHash),
      );
      return {
        id: minted.id,
        expiresAt: minted.expiresAt.getTime(),
        installScriptUrl: installScriptUrlOf(context.request),
      };
    }),
    revokeInstallToken: hosts.revokeInstallToken.effect(function* ({ context, input }) {
      yield* experimentOn(context.userId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(revokeHostInstallToken(context.userId, input.id)),
      );
    }),
  };
}
