import type { PlanEditorModule } from "./contract";
import { mountPlanEditor } from "./plan-editor";

/**
 * index.ts -- the plan editor's own bundle: TipTap over a plan's whole text, set on `window` for the plan document to mount (`./contract.ts`).
 */

window.lukePlanEditor = { mount: mountPlanEditor } satisfies PlanEditorModule;
