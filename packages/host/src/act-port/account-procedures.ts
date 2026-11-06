import type { AccountSnapshot } from "@repo/credentials/snapshot";
import { Effect, Option } from "effect";
import { ACCOUNT_ACT_KIND } from "../contract/index.js";
import type { HostOperator } from "../host-operator.js";
import { actPort } from "./base.js";

export interface AccountProceduresDependencies {
  host: Pick<
    HostOperator,
    | "beginSignIn"
    | "signInAgain"
    | "cancelSignIn"
    | "signOut"
    | "deleteAccount"
    | "accountSnapshot"
    | "supportAccess"
  >;
  askBeforeSignOut?: () => Promise<boolean>;
  haltSessionReplay: () => void;
  resumeSessionReplay: () => void;
}

export function accountProcedures(dependencies: AccountProceduresDependencies) {
  const { host, haltSessionReplay, resumeSessionReplay, askBeforeSignOut } = dependencies;
  const halted = (action: Effect.Effect<AccountSnapshot>): Effect.Effect<AccountSnapshot> =>
    Effect.suspend(() => {
      haltSessionReplay();
      return Effect.tapDefect(action, () => Effect.sync(resumeSessionReplay));
    });

  return {
    [ACCOUNT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: actPort[
      ACCOUNT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN
    ].effect(function* ({ input }) {
      return yield* host.beginSignIn(input.provider);
    }),
    [ACCOUNT_ACT_KIND.ACCOUNT_SIGN_IN_AGAIN]: actPort[
      ACCOUNT_ACT_KIND.ACCOUNT_SIGN_IN_AGAIN
    ].effect(function* ({ input }) {
      return yield* host.signInAgain(input.provider);
    }),
    [ACCOUNT_ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: actPort[
      ACCOUNT_ACT_KIND.ACCOUNT_CANCEL_SIGN_IN
    ].effect(function* () {
      yield* host.cancelSignIn();
    }),
    [ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT]: actPort[ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT].effect(
      function* () {
        if (askBeforeSignOut !== undefined && !(yield* Effect.promise(askBeforeSignOut))) {
          const standing = yield* host.accountSnapshot();
          if (Option.isSome(standing)) return standing.value;
        }
        return yield* halted(host.signOut());
      },
    ),
    [ACCOUNT_ACT_KIND.ACCOUNT_DELETE]: actPort[ACCOUNT_ACT_KIND.ACCOUNT_DELETE].effect(
      function* () {
        return yield* halted(host.deleteAccount());
      },
    ),
    [ACCOUNT_ACT_KIND.ACCOUNT_SUPPORT_ACCESS]: actPort[
      ACCOUNT_ACT_KIND.ACCOUNT_SUPPORT_ACCESS
    ].effect(function* ({ input }) {
      return yield* host.supportAccess(input.grant);
    }),
  };
}
