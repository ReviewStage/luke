// field-editor-bundle.ts -- SPIKE: the field editor's own bundle: TipTap, its grammars, and the rule's nodes, set on `window` for the panel to mount.

import { mountFieldEditor } from "./field-editor";
import type { FieldEditorModule } from "./field-editor-contract";

window.lukeFieldEditor = { mount: mountFieldEditor } satisfies FieldEditorModule;
