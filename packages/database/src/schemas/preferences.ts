import type { AgentMachineKind, ContextWindow } from "@luke/features/agent-wire";
import type { ChaptersModelId } from "@luke/features/chapters-model-choice";
import type { LinkOpen } from "@luke/features/link-open";
import type { ExperimentChoices } from "@luke/settings";
import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * One row per account for scalar cross-device preferences. Platform-local
 * settings stay in each app's own store; only preferences that should follow
 * the signed-in account belong here.
 */
export const accountPreference = pgTable("account_preference", {
  userId: text("user_id")
    .primaryKey()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /**
   * Where the account's Luke links open (`@luke/features/link-open`); null
   * until the account chooses, which reads as the browser. A part of the
   * snapshot of its own rather than the shared preferences, so a build that
   * predates it, writing that part whole, never clears it; written alone, it
   * moves no `updated_at`.
   */
  linkOpen: text("link_open").$type<LinkOpen>(),
  /**
   * The model and effort a coding agent starts on when Start is clicked, as
   * AI Gateway's catalog names them (`packages/service/src/providers/model-catalog.ts`); null on both
   * means the account has never chosen and starts on the catalog's default.
   * The context window beside them is null for the model's whole window,
   * which is also what a choice written before the window could be chosen
   * reads as, and `standard` where the smaller window was chosen.
   */
  codingAgentModel: text("coding_agent_model"),
  codingAgentEffort: text("coding_agent_effort"),
  codingAgentContextWindow: text("coding_agent_context_window").$type<ContextWindow>(),
  /**
   * The Claude model a Generate chapters this account presses runs on
   * (`@luke/features/chapters-model-choice`); null until the account
   * chooses, and a value no build lists any more, both read as Haiku.
   * Written alone, it moves no `updated_at`.
   */
  chaptersModel: text("chapters_model").$type<ChaptersModelId>(),
  /**
   * Each experiment the account turned on or back off, by its key
   * (`@luke/settings`'s `EXPERIMENT`); null on a row that never chose one,
   * which reads as every experiment off. A write merges its keys over what
   * stood, so a Mac that knows fewer experiments never erases another's
   * choice, and a key no build lists any more is left inert.
   */
  experiments: jsonb("experiments").$type<ExperimentChoices>(),
  /**
   * Where the account last chose to run a task, as New task's or a quick
   * add's Runs on sent it (`runs-on-pick.ts`): the cloud, or one of its
   * devices by id, which a task an agent makes for the account starts on;
   * null on both until a start names one, which reads as the cloud. The
   * device is kept by id alone, with no reference to its row, so a device
   * since removed is still told apart from no pick at all. Written alone,
   * it moves no `updated_at`.
   */
  runsOnMachine: text("runs_on_machine").$type<AgentMachineKind>(),
  runsOnDeviceId: uuid("runs_on_device_id"),
  createdAt: createdAt(),
  /**
   * When the preferences part was last written; null on a row only a
   * coding-agent choice opened. The desktop reads the instant's presence as
   * a snapshot to apply over its own settings, so a row with none written
   * must answer none, or a never-synced Mac would take an empty snapshot
   * over the settings it holds.
   */
  updatedAt: timestamptz("updated_at"),
});
