import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorDiagram } from "./contract";

/**
 * diagram-preview.ts -- a Mermaid code block's diagram previewed under it while a plan's text is edited, drawn by the panel.
 *
 * The block stays code, as the text holds it, and its diagram stands under
 * it as a widget, which is never part of the text, so nothing about it is
 * saved. The panel draws into the widget's element (`./contract.ts`'s
 * `drawDiagram`), the same way it draws the read view's, so Mermaid is
 * loaded once per window and never joins this bundle. A widget is known by
 * its block's code: an edit elsewhere in the text keeps every preview
 * standing, and an edit inside the block stands a new one, handed the code
 * the block held before, whose picture stays while the new one is drawn.
 */

/** The language a code block names to be previewed as a diagram. */
const DIAGRAM_LANGUAGE = "mermaid";

/** The node a fence opens as. */
const CODE_BLOCK = "codeBlock";

/** The classes the preview's element wears: the read view's figure, the preview's own place, and out of the screen recording, since a picture of words cannot be masked. */
const PREVIEW_CLASS = "plan-diagram plan-diagram-preview ph-no-capture";

/** How the panel draws a block's diagram into an element, answering what takes it down. */
type DiagramDrawer = (element: HTMLElement, diagram: EditorDiagram) => () => void;

const PREVIEWS = new PluginKey<DecorationSet>("diagramPreview");

/**
 * What an editor's previews remember: what takes each drawing down, by the
 * element it was drawn into, and the code each widget was stood for, by its
 * spec, which a widget keeps as the text's changes map it.
 */
interface PreviewMemory {
  readonly takedowns: WeakMap<Node, () => void>;
  readonly codes: WeakMap<object, string>;
}

/**
 * A preview under each Mermaid code block of the text, each handed the code
 * its block held where the previews before the change stood.
 */
function previewsOf(
  doc: PmNode,
  before: DecorationSet,
  draw: DiagramDrawer,
  { takedowns, codes }: PreviewMemory,
): DecorationSet {
  const widgets: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== CODE_BLOCK) return true;
    if (node.attrs.language !== DIAGRAM_LANGUAGE) return false;
    const end = pos + node.nodeSize;
    const code = node.textContent;
    const was = before.find(end, end, (spec) => codes.has(spec))[0];
    const previous = was === undefined ? undefined : codes.get(was.spec);
    const stand = () => {
      const element = document.createElement("div");
      element.className = PREVIEW_CLASS;
      element.setAttribute("contenteditable", "false");
      takedowns.set(element, draw(element, { code, previous }));
      return element;
    };
    const spec = {
      key: code,
      side: 1,
      ignoreSelection: true,
      destroy: (element: Node) => {
        takedowns.get(element)?.();
        takedowns.delete(element);
      },
    };
    codes.set(spec, code);
    widgets.push(Decoration.widget(end, stand, spec));
    return false;
  });
  return DecorationSet.create(doc, widgets);
}

/** The previews of a text's Mermaid code blocks, drawn through the panel's drawer. */
export function diagramPreview(draw: DiagramDrawer): Extension {
  return Extension.create({
    name: "diagramPreview",
    addProseMirrorPlugins() {
      const memory: PreviewMemory = { takedowns: new WeakMap(), codes: new WeakMap() };
      return [
        new Plugin<DecorationSet>({
          key: PREVIEWS,
          state: {
            init: (_config, state) => previewsOf(state.doc, DecorationSet.empty, draw, memory),
            apply: (tr, previews) =>
              tr.docChanged
                ? previewsOf(tr.doc, previews.map(tr.mapping, tr.doc), draw, memory)
                : previews,
          },
          props: { decorations: (state) => PREVIEWS.getState(state) },
        }),
      ];
    },
  });
}
