import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorDiagram } from "./contract.js";

const DIAGRAM_LANGUAGE = "mermaid";

const CODE_BLOCK = "codeBlock";

const PREVIEW_CLASS =
  "description-diagram description-diagram-preview ph-no-capture mt-tight-gap mb-block-gap px-card-compact py-list-inset select-none";

type DiagramDrawer = (element: HTMLElement, diagram: EditorDiagram) => () => void;

const PREVIEWS = new PluginKey<DecorationSet>("diagramPreview");

interface PreviewMemory {
  readonly takedowns: WeakMap<Node, () => void>;
  readonly codes: WeakMap<object, string>;
}

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
