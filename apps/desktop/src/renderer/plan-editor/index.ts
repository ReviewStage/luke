import { mountComposer } from "./composer-editor";
import type { PlanEditorModule } from "./contract";
import { mountPlanEditor } from "./plan-editor";

/**
 * index.ts -- the editor bundle: TipTap over a plan's whole text and under an agent's message box, set on `window` for the panel to mount (`./contract.ts`).
 */

window.lukePlanEditor = { mount: mountPlanEditor, mountComposer } satisfies PlanEditorModule;
