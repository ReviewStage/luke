import { Context, Effect } from "effect";
import { HostedAuth, HostedPosthog } from "../services/tags.js";
import {
  HOSTED_HTTP_STATUS,
  jsonResponseEffect,
  methodNotAllowed,
  unauthorized,
} from "./http-effect.js";

export class AccountDeleteUser extends Context.Tag("@luke/web/AccountDeleteUser")<
  AccountDeleteUser,
  {
    readonly deleteUser: (userId: string) => Effect.Effect<void>;
  }
>() {}

export const handleAccountDelete = Effect.fn("handleAccountDelete")(function* (request: Request) {
  if (request.method !== "POST") {
    return methodNotAllowed();
  }

  const auth = yield* HostedAuth;
  const userId = yield* auth.resolveUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const posthog = yield* HostedPosthog;
  if (posthog.forgetPerson) {
    yield* posthog.forgetPerson(userId).pipe(
      Effect.catchAll((error: unknown) =>
        Effect.sync(() => {
          process.stderr.write(
            `Analytics erasure did not complete: ${error instanceof Error ? error.message : "unknown error"}\n`,
          );
        }),
      ),
    );
  }

  const deleter = yield* AccountDeleteUser;
  yield* deleter.deleteUser(userId);

  return yield* jsonResponseEffect(HOSTED_HTTP_STATUS.OK, { deleted: true as const });
});
