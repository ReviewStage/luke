import { markMacListening, settleMacCommand } from "@repo/database/models/mac-command-store";
import { macCommandKindsRead } from "@repo/features/mac-command-wire";
import { Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { bearerOnlyMiddleware, hosted } from "../orpc/base.js";
import { claimedMacCommand, macCommandsFor } from "./mac-command.js";

export interface MacCommandsProcedureSeams {
  resolveUserId: UserIdResolver;
}

export function macCommandsProcedures(seams: MacCommandsProcedureSeams) {
  const macCommands = hosted.macCommands.use(bearerOnlyMiddleware(seams.resolveUserId));
  return {
    waiting: macCommands.waiting.effect(function* ({ context, input }) {
      const kinds = macCommandKindsRead(input.kinds);
      const commands = yield* hostedStoreOrUnavailable(macCommandsFor(context.userId, kinds));
      return { commands };
    }),
    settle: macCommands.settle.effect(function* ({ context, input }) {
      const settled = yield* hostedStoreOrUnavailable(
        settleMacCommand(context.userId, input.id, input.result),
      );
      if (!settled) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { settled: true } as const;
    }),
    claim: macCommands.claim.effect(function* ({ context, input }) {
      const claimed = yield* hostedStoreOrUnavailable(claimedMacCommand(context.userId, input.id));
      if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { command: claimed.value };
    }),
    listening: macCommands.listening.effect(function* ({ context }) {
      yield* hostedStoreOrUnavailable(markMacListening(context.userId));
      return { listening: true } as const;
    }),
  };
}
