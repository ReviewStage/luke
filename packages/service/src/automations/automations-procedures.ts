import {
  AUTOMATION_ACCESS,
  listAutomationRuns,
  listAutomations,
  readAutomation,
} from "@repo/database/models/automation-store";
import { Effect, Option } from "effect";
import { routedSessions } from "../agents/coder-host/runtime-sessions.js";
import type { EveTypedTurn } from "../agents/eve-host/eve-sessions.js";
import { SERVER_AUTOMATION_SOURCE } from "../events/server-events.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { AUTOMATION_RUNS_READ } from "./automation-live.js";
import {
  changeAutomationAs,
  createAutomationAs,
  removeAutomationAs,
  runAutomationNowAs,
  runSummaries,
  summaryOf,
} from "./automation-writes.js";

export interface AutomationsProcedureSeams {
  resolveUserId: UserIdResolver;
}

export function automationsProcedures(seams: AutomationsProcedureSeams) {
  const automations = hosted.automations.use(accountMiddleware(seams.resolveUserId));
  return {
    list: automations.list.effect(function* ({ input, context }) {
      const listed =
        input.planId === undefined
          ? yield* hostedStoreOrUnavailable(
              listAutomations(context.userId, { organizationId: input.workspaceId }),
            )
          : [];
      const summaries = yield* Effect.forEach(listed, (each) => summaryOf(context.userId, each));
      return { automations: summaries };
    }),

    create: automations.create.effect(function* ({ input: made, context: { userId } }) {
      const created = yield* createAutomationAs(userId, made, SERVER_AUTOMATION_SOURCE.MEMBER);
      return {
        automation: created.automation,
        ...(created.webhookSecret === undefined
          ? undefined
          : { webhookSecret: created.webhookSecret }),
        ...(created.txid === undefined ? undefined : { txid: created.txid }),
      };
    }),

    read: automations.read.effect(function* ({ input, context: { userId } }) {
      const id = yield* pathUuid(input.id);
      const standing = yield* hostedStoreOrUnavailable(readAutomation(userId, id));
      if (Option.isNone(standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { automation: yield* summaryOf(userId, standing.value) };
    }),

    change: automations.change.effect(function* ({
      input: { params, body: asked },
      context: { userId },
    }) {
      const id = yield* pathUuid(params.id);
      const standing = yield* hostedStoreOrUnavailable(readAutomation(userId, id));
      if (Option.isNone(standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const written = yield* changeAutomationAs(
        userId,
        standing.value,
        asked,
        SERVER_AUTOMATION_SOURCE.MEMBER,
      );
      return {
        automation: written.automation,
        ...(written.webhookSecret === undefined
          ? undefined
          : { webhookSecret: written.webhookSecret }),
        ...(written.txid === undefined ? undefined : { txid: written.txid }),
      };
    }),

    remove: automations.remove.effect(function* ({ input, context: { userId } }) {
      const id = yield* pathUuid(input.id);
      const standing = yield* hostedStoreOrUnavailable(readAutomation(userId, id));
      if (Option.isNone(standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return {
        txid: yield* removeAutomationAs(userId, standing.value, SERVER_AUTOMATION_SOURCE.MEMBER),
      };
    }),

    run: automations.run.effect(function* ({ input, context }) {
      const { userId } = context;
      const id = yield* pathUuid(input.params.id);
      const key = input.body.idempotencyKey;
      const automation = yield* hostedStoreOrUnavailable(
        readAutomation(userId, id, AUTOMATION_ACCESS.RUN),
      );
      if (Option.isNone(automation)) {
        const readable = yield* hostedStoreOrUnavailable(readAutomation(userId, id));
        return yield* Effect.fail(
          Option.isSome(readable) ? HOSTED_REFUSAL.NOT_PERMITTED : HOSTED_REFUSAL.NOT_FOUND,
        );
      }
      const ran = yield* runAutomationNowAs(userId, automation.value, key, () =>
        routedSessions<EveTypedTurn>(userId),
      );
      return {
        status: ran.made ? HOSTED_HTTP_STATUS.CREATED : HOSTED_HTTP_STATUS.OK,
        body: ran.txid === undefined ? { run: ran.run } : { run: ran.run, txid: ran.txid },
      };
    }),

    runs: automations.runs.effect(function* ({ input, context: { userId } }) {
      const id = yield* pathUuid(input.id);
      const automation = yield* hostedStoreOrUnavailable(readAutomation(userId, id));
      if (Option.isNone(automation)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const runs = yield* hostedStoreOrUnavailable(
        listAutomationRuns(userId, id, AUTOMATION_RUNS_READ),
      );
      return { runs: yield* runSummaries(userId, runs) };
    }),
  };
}
