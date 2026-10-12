import type { FieldEditorModule } from "./contract";
import { mountFieldEditor } from "./field-editor";

/**
 * index.ts -- the field editor's own bundle: TipTap and a rule's nodes, set on `window` for the plan document to mount (`./contract.ts`).
 */

window.lukeFieldEditor = { mount: mountFieldEditor } satisfies FieldEditorModule;
