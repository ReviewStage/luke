import type { ReactNode } from "react";

const FILES =
  "ui-composer-files flex flex-wrap gap-tight-gap px-ui-12 pt-ui-12 pb-0 " +
  "group-data-[look=field]/composer:px-ui-6 group-data-[look=field]/composer:pt-ui-6 " +
  "group-data-[look=input]/composer:px-ui-6 group-data-[look=input]/composer:pt-ui-6 " +
  "group-data-[look=bare]/composer:p-0 [&:not(:has(>:not([hidden])))]:hidden";

export function ComposerBody({
  files,
  children,
}: {
  files?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <>
      {files === undefined || files === null ? null : <div className={FILES}>{files}</div>}
      {children}
    </>
  );
}
