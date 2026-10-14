import { bundleAtom } from "./bundle-loader";
import { PLAN_EDITOR_ASSET } from "./plan-editor/contract";
import { rendererRegistry } from "./renderer-runtime";

/**
 * editor-bundle.ts -- the editor bundle (`plan-editor/`), loaded once per window and started as the panel first paints, so a plan's text and an agent's message box find it there.
 *
 * The bundle is a local file, so started after the panel's first paint it
 * has landed long before an agent's tab or a plan's editor is opened; a
 * surface that is drawn before it lands draws itself inert until it does.
 * The voice window loads the panel's bundle too, and never this one.
 */

/** The editor bundle, as what its script set on `window`. */
export const editorBundleAtom = bundleAtom(
  { script: PLAN_EDITOR_ASSET.SCRIPT },
  () => window.lukePlanEditor,
  "The editor could not be loaded.",
);

/** Starts the editor bundle loading, where it has not started already. */
export function prefetchEditorBundle(): void {
  rendererRegistry.get(editorBundleAtom);
}
