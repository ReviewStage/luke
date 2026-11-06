import { mountComposer } from "./composer-editor.js";
import type { DescriptionEditorModule } from "./contract.js";
import { mountDescriptionEditor } from "./description-editor.js";

export const descriptionEditor: DescriptionEditorModule = {
  mount: mountDescriptionEditor,
  mountComposer,
};
