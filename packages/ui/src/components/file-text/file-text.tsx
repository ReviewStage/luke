export const FILE_TEXT_EXTENT = {
  PEEK: "peek",
  WHOLE: "whole",
  BRIEF: "brief",
} as const;

export type FileTextExtent = (typeof FILE_TEXT_EXTENT)[keyof typeof FILE_TEXT_EXTENT];

export function FileText({
  text,
  label,
  extent = FILE_TEXT_EXTENT.WHOLE,
}: {
  text: string;
  label: string;
  extent?: FileTextExtent;
}): React.JSX.Element {
  const scrolls = extent !== FILE_TEXT_EXTENT.PEEK;
  return (
    <section
      className="ui-file-text"
      data-extent={extent}
      aria-label={label}
      tabIndex={scrolls ? 0 : undefined}
    >
      <pre className="ui-file-text-words">{text}</pre>
    </section>
  );
}
