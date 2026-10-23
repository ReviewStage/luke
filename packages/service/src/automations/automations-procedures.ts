import {
  AUTOMATION_ACCESS,
  listAutomationRuns,
  listAutomations,
  readAutomation,
} from "@luke/database/models/automation-store";
import { Effect, Option } from "effect";
import type { EveTypedTurn } from "../agents/brain-host/eve-sessions.js";
import { type EveReach, eveFor } from "../agents/coder-host/stop.js";
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

/**
 * automations-procedures.ts -- the account's automations: list and make them, change and delete one, run one now, and read its runs.
 *
 * Every procedure resolves the caller (`accountMiddleware`, on the resource
 * so it runs before an input is read) before it touches a row, and the store
 * gates every row on the account owning the automation and still reaching
 * its task (`automation-store.ts`), so an automation of another account, or
 * on a task of a workspace the account left, answers as not found. What is
 * written is checked as a Start checks it: a schedule must read (five-field
 * cron in a known zone, no more often than every fifteen minutes, which the
 * desktop checks with the same module before it sends), a model choice must
 * be one the catalog offers the account, and the task must name a
 * repository, but for an automation aimed at the account's own operator,
 * which works in none; those checks, and the webhook secret a write mints,
 * are `automation-writes.ts`'s, which the agents' automation tools write
 * through too.
 *
 * "Run now" records a manual firing under the client's key and acts on it
 * at once, through the same guards and the same start a scheduled run
 * takes (`automations/automation-runs.ts`), reaching eve as the developer under
 * the request's own bearer; the same key again answers the run it made. A
 * run's agent is summarized with its status as the agent's tab reads it.
 */

export interface AutomationsProcedureSeams extends EveReach {
  resolveUserId: UserIdResolver;
}

/**
 * The automations resource: every procedure to a signed-in caller. The
 * caller is resolved, and a body's length bounded, on the resource rather
 * than on each procedure, so both run before an input is read, in the old
 * group's order: an unsigned request is refused as unauthenticated and an
 * oversized one as too large, whatever it sent. A "Run now" carries its key
 * alone, bounded tighter once its key reads.
 */
export function automationsProcedures(seams: AutomationsProcedureSeams) {
  const automations = hosted.automations.use(accountMiddleware(seams.resolveUserId));
  return {
    /** The account's automations, or one task's, or one workspace's. */
    list: automations.list.effect(function* ({ input, context }) {
      const listed = yield* hostedStoreOrUnavailable(
        listAutomations(context.userId, {
          taskId: input.planId,
          organizationId: input.workspaceId,
        }),
      );
      const summaries = yield* Effect.forEach(listed, (each) => summaryOf(context.userId, each));
      return { automations: summaries };
    }),

    /** An automation made on one of the account's tasks with a repository, or on a workspace of the account's with the repositories its runs work in. */
    create: automations.create.effect(function* ({ input: made, context: { userId } }) {
      const created = yield* createAutomationAs(userId, made);
      return {
        automation: created.automation,
        ...(created.webhookSecret === undefined
          ? undefined
          : { webhookSecret: created.webhookSecret }),
        ...(created.txid === undefined ? undefined : { txid: created.txid }),
      };
    }),

    /** One automation as the account reads it. */
    read: automations.read.effect(function* ({ input, context: { userId } }) {
      const id = yield* pathUuid(input.id);
      const standing = yield* hostedStoreOrUnavailable(readAutomation(userId, id));
      if (Option.isNone(standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { automation: yield* summaryOf(userId, standing.value) };
    }),

    /** One automation changed, answered as it then stands, with a webhook secret the change minted. */
    change: automations.change.effect(function* ({
      input: { params, body: asked },
      context: { userId },
    }) {
      const id = yield* pathUuid(params.id);
      const standing = yield* hostedStoreOrUnavailable(readAutomation(userId, id));
      if (Option.isNone(standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const written = yield* changeAutomationAs(userId, standing.value, asked);
      return {
        automation: written.automation,
        ...(written.webhookSecret === undefined
          ? undefined
          : { webhookSecret: written.webhookSecret }),
        ...(written.txid === undefined ? undefined : { txid: written.txid }),
      };
    }),

    /** One automation deleted with its history; one the account reads but may not delete is refused as not permitted, not as gone. */
    remove: automations.remove.effect(function* ({ input, context: { userId } }) {
      const id = yield* pathUuid(input.id);
      const standing = yield* hostedStoreOrUnavailable(readAutomation(userId, id));
      if (Option.isNone(standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { txid: yield* removeAutomationAs(userId, id) };
    }),

    /** The automation run now, under the client's key: 201 with the run this call made, 200 with the one the key already made. */
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
      // Note that the run reaches eve as this request's caller, whoever made the automation, as a Start does.
      const ran = yield* runAutomationNowAs(userId, automation.value, key, () =>
        eveFor<EveTypedTurn>(seams, context.request, userId),
      );
      return {
        status: ran.made ? HOSTED_HTTP_STATUS.CREATED : HOSTED_HTTP_STATUS.OK,
        body: ran.txid === undefined ? { run: ran.run } : { run: ran.run, txid: ran.txid },
      };
    }),

    /** The automation's runs, newest first. */
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
