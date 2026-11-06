export const PROSE_CLASS = "ui-prose";

export function Prose({ html }: { html: string }): React.JSX.Element {
  return (
    <div
      className={`${PROSE_CLASS} ui-prose-document`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
