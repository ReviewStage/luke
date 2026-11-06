import { RetryIcon } from "../../icons/lucide-glyphs.js";
import { FoldingButton } from "../folding-button/folding-button.js";

const RETRY_WORD = "Retry";

export function RetryButton({
  onRetry,
  label = RETRY_WORD,
}: {
  onRetry: () => void;
  label?: string;
}): React.JSX.Element {
  return <FoldingButton label={label} icon={<RetryIcon />} turns onClick={onRetry} />;
}
