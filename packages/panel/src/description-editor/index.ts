import { mountComposer } from "./composer-editor.js";
import type { DescriptionEditorModule } from "./contract.js";
import { mountDescriptionEditor } from "./description-editor.js";

/**
 * index.ts -- the editor bundle: TipTap over a description's whole text and under an agent's message box, imported by the panel to mount (`./contract.ts`).
 */

export const descriptionEditor: DescriptionEditorModule = {
  mount: mountDescriptionEditor,
  mountComposer,
};
