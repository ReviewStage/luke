import { useLayoutEffect, useState } from "react";
import { isReported, type ReportedFailure, type Unreported } from "../../reported-failure.js";
import type { ButtonSize } from "../button/button.js";
import { CopyButton } from "../copy-button/copy-button.js";

const DETAILS_WHAT = "details";

export function useFailureDetails(failure: ReportedFailure | undefined): string | undefined {
  const [read, setRead] = useState<{
    readonly of: ReportedFailure;
    readonly details: string | undefined;
  }>();
  useLayoutEffect(() => {
    if (failure === undefined) return undefined;
    setRead({ of: failure, details: failure.shown() });
    return () => failure.hidden();
  }, [failure]);
  return read !== undefined && read.of === failure ? read.details : undefined;
}

export function FailureCopy({
  failure,
  size,
}: {
  failure: ReportedFailure | Unreported | undefined;
  size?: ButtonSize | undefined;
}): React.JSX.Element | null {
  const reported = isReported(failure) ? failure : undefined;
  const details = useFailureDetails(reported);
  if (reported === undefined || details === undefined) return null;
  return (
    <CopyButton
      text={details}
      what={DETAILS_WHAT}
      copy={reported.copy}
      {...(size === undefined ? {} : { size })}
    />
  );
}
