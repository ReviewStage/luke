import { useClipped } from "@luke/ui/use-clipped";
import { Tooltip } from "../tooltip";

/**
 * one-line.tsx -- a row's words held to one line, an ellipsis where the row cuts them short, and the pointer resting on them reading them whole.
 *
 * An address has nowhere to wrap but its dots and hyphens, so in a narrow
 * row it ran under the control beside it or out of its card. Held to one
 * line it ends in an ellipsis instead (`.settings-one-line`), and only then
 * does it raise the window's pill with its whole words: a line drawn whole
 * says nothing twice. The words ride the pill rather than a `title`, which
 * session replay would carry unmasked.
 */
export function OneLine({
  as: Element,
  text,
}: {
  /** The row's name (`strong`) or the detail under it (`small`). */
  as: "strong" | "small";
  text: string;
}): React.JSX.Element {
  const [line, clipped] = useClipped();
  return (
    <Tooltip label={clipped ? text : undefined}>
      <Element ref={line} className="settings-one-line">
        {text}
      </Element>
    </Tooltip>
  );
}
