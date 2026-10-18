import type {
  PictureNode,
  PictureTaken,
  PlanEditorPictures,
} from "@luke/panel/plan-editor/contract";
import type { JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Fragment, type Node as PmNode, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

/**
 * picture-node.ts -- a picture in the plan's text: TipTap's image held inline in its own paragraph, written back escaped, drawn by the panel, and laid in from a paste, a drop, or a file chosen.
 *
 * A picture stands in the plan's Markdown as `![alt](address "caption")`
 * (`@luke/features/plan-attachment-link`). The editor keeps it as TipTap's
 * image node, inline, in a paragraph of its own, and writes it back with
 * its alt text's brackets, its address's parentheses, and its caption's
 * quotes escaped, which TipTap's own writer does not. A picture laid in from
 * a paste, a drop, or a file chosen has no address yet: it waits on an
 * upload the panel names, writes nothing to the text meanwhile, and takes
 * its address once the panel kept it (`settled`). A picture of another plan
 * pasted in is kept again on this one, so its new readers can see it. The
 * node's element is the panel's to draw into, as a mention's is: its
 * picture, its upload, and its tools while selected.
 */

const PICTURE_NODE = "image";

/** What a picture laid in from a pasted screenshot is called until it is described. */
const PASTED_ALT = "Screenshot";

/** Escapes the characters that would end a picture's alt text, address, or title early. */
function escaped(words: string, ends: RegExp): string {
  return words.replace(ends, "\\$&");
}

/** A picture as Markdown writes it: nothing while it waits on its upload. */
function pictureMarkdown(attrs: JSONContent["attrs"]): string {
  if (String(attrs?.upload ?? "") !== "") return "";
  const alt = escaped(String(attrs?.alt ?? ""), /[\\[\]]/gu);
  const src = escaped(String(attrs?.src ?? ""), /[\\()]/gu);
  const title = attrs?.title ? ` "${escaped(String(attrs.title), /[\\"]/gu)}"` : "";
  return `![${alt}](${src}${title})`;
}

/** The node's picture as the panel draws it. */
function pictureOf(node: PmNode): PictureNode {
  return {
    src: String(node.attrs.src ?? ""),
    alt: String(node.attrs.alt ?? ""),
    title: String(node.attrs.title ?? ""),
    upload: String(node.attrs.upload ?? ""),
  };
}

/** A new upload's name, which ties a picture laid in to the panel's keeping of it. */
function uploadName(): string {
  return crypto.randomUUID();
}

/** What a picture laid in from a file is called: its name without its type, or "Screenshot" for a paste that has none worth keeping. */
function altOf(file: File): string {
  const stem = file.name.replace(/\.[^.]*$/u, "").trim();
  return stem === "" || stem === "image" ? PASTED_ALT : stem;
}

/** The image files among a paste's or a drop's, in their order. */
function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith("image/"));
}

/**
 * The picture node: TipTap's image, inline, with the upload it waits on;
 * drawn into its own element by the panel where it can draw one, and as an
 * image element where it cannot, as in a template.
 */
export function pictureNode(pictures: PlanEditorPictures | undefined) {
  const node = Image.extend({
    addAttributes() {
      return { ...this.parent?.(), upload: { default: "", rendered: false } };
    },
    renderMarkdown: (held: JSONContent) => pictureMarkdown(held.attrs),
  }).configure({ inline: true });
  if (pictures === undefined) return node;
  return node.extend({
    addNodeView() {
      return ({ node: held, getPos, editor }) => {
        const dom = document.createElement("span");
        dom.className = "editor-picture";
        dom.contentEditable = "false";
        let current = held;
        let selected = false;
        const drawing = pictures.draw(dom, pictureOf(held), {
          describe: (change) => {
            const pos = getPos();
            if (pos === undefined) return;
            editor.view.dispatch(
              editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...change }),
            );
          },
          remove: () => {
            const pos = getPos();
            if (pos !== undefined) removedAt(editor.view, pos);
          },
        });
        return {
          dom,
          update: (next) => {
            if (next.type !== current.type) return false;
            current = next;
            drawing.redraw(pictureOf(next), selected);
            return true;
          },
          selectNode: () => {
            selected = true;
            drawing.redraw(pictureOf(current), true);
          },
          deselectNode: () => {
            selected = false;
            drawing.redraw(pictureOf(current), false);
          },
          // Note that the panel's own controls inside the picture, its alt text's field among them, keep their events from the editor.
          stopEvent: (event) =>
            event.target instanceof Element &&
            event.target.closest("button, input, textarea") !== null,
          ignoreMutation: () => true,
          destroy: () => drawing.undraw(),
        };
      };
    },
  });
}

/** The picture at `pos` taken out, with the paragraph it stood alone in. */
function removedAt(view: EditorView, pos: number): void {
  const $pos = view.state.doc.resolve(pos);
  const alone = $pos.parent.type.name === "paragraph" && $pos.parent.childCount === 1;
  const from = alone ? $pos.before() : pos;
  const to = alone ? $pos.after() : pos + ($pos.nodeAfter?.nodeSize ?? 1);
  view.dispatch(view.state.tr.delete(from, to));
}

/**
 * Pictures laid in, each in a paragraph of its own, after the top-level
 * block that `pos` stands in, or after the caret's where none is given; each
 * waits on a new upload, which is handed to the panel with its file.
 */
export function laidInPictures(
  view: EditorView,
  files: readonly File[],
  pictures: PlanEditorPictures,
  pos?: number,
): void {
  if (files.length === 0) return;
  const { state } = view;
  const $at = state.doc.resolve(pos ?? state.selection.from);
  const after = $at.depth === 0 ? $at.pos : $at.after(1);
  const taken: PictureTaken[] = [];
  const paragraphs = files.map((file) => {
    const upload = uploadName();
    taken.push({ upload, file });
    const picture = state.schema.node(PICTURE_NODE, { src: "", alt: altOf(file), upload });
    return state.schema.node("paragraph", null, [picture]);
  });
  view.dispatch(state.tr.insert(after, paragraphs).scrollIntoView());
  pictures.take(taken);
}

/** The position of the picture waiting on `upload`; none where the text no longer holds it. */
function waitingAt(view: EditorView, upload: string): number | undefined {
  let found: number | undefined;
  view.state.doc.descendants((node, pos) => {
    if (found === undefined && node.type.name === PICTURE_NODE && node.attrs.upload === upload) {
      found = pos;
    }
  });
  return found;
}

/** The picture waiting on `upload` given its address, which the text now writes; nothing where it was taken out meanwhile. */
export function settledPicture(view: EditorView, upload: string, src: string): void {
  const pos = waitingAt(view, upload);
  const node = pos === undefined ? undefined : view.state.doc.nodeAt(pos);
  if (pos === undefined || node === undefined || node === null) return;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src, upload: "" }));
}

/** The picture waiting on `upload` taken out of the text. */
export function removedPicture(view: EditorView, upload: string): void {
  const pos = waitingAt(view, upload);
  if (pos !== undefined) removedAt(view, pos);
}

/** A paste of image files laid in as pictures after the caret's block; answers whether it was one. */
export function pastedPictures(
  view: EditorView,
  event: ClipboardEvent,
  pictures: PlanEditorPictures,
): boolean {
  const files = imageFiles(event.clipboardData?.files);
  if (files.length === 0) return false;
  laidInPictures(view, files, pictures);
  return true;
}

/** A drop of image files from outside the editor laid in as pictures after the block they landed on; answers whether it was one. */
export function droppedPictures(
  view: EditorView,
  event: DragEvent,
  moved: boolean,
  pictures: PlanEditorPictures,
): boolean {
  const files = imageFiles(event.dataTransfer?.files);
  if (moved || files.length === 0) return false;
  const landed = view.posAtCoords({ left: event.clientX, top: event.clientY });
  laidInPictures(view, files, pictures, landed?.pos);
  return true;
}

/** A fragment with each picture in it made again by `change`, at any depth, every other node as it was. */
function withPictures(fragment: Fragment, change: (picture: PmNode) => PmNode): Fragment {
  const nodes: PmNode[] = [];
  fragment.forEach((child) => {
    if (child.type.name === PICTURE_NODE) nodes.push(change(child));
    else nodes.push(child.isLeaf ? child : child.copy(withPictures(child.content, change)));
  });
  return Fragment.fromArray(nodes);
}

/**
 * A pasted slice's pictures of another plan, each made to wait on a new
 * upload that keeps it again on this plan, and handed to the panel to keep;
 * every other picture as it was.
 */
export function copiedPictures(slice: Slice, pictures: PlanEditorPictures): Slice {
  const taken: PictureTaken[] = [];
  const content = withPictures(slice.content, (picture) => {
    const src = String(picture.attrs.src ?? "");
    if (!pictures.copies(src)) return picture;
    const upload = uploadName();
    taken.push({ upload, from: src });
    return picture.type.create({ ...picture.attrs, src: "", upload }, null, picture.marks);
  });
  if (taken.length === 0) return slice;
  pictures.take(taken);
  return new Slice(content, slice.openStart, slice.openEnd);
}
