import { mountComposer } from "./composer-editor";
import type { PlanEditorModule } from "./contract";
import { mountPlanEditor } from "./plan-editor";

/**
 * index.ts -- the editor bundle: TipTap over a plan's whole text and under an agent's message box, imported by the panel to mount (`./contract.ts`).
 */

export const planEditor: PlanEditorModule = { mount: mountPlanEditor, mountComposer };
