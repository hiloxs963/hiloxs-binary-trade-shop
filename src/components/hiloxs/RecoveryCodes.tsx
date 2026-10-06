import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RECOVERY_CODES_FILENAME, recoveryCodesFileContents } from "@/lib/recovery-codes";

/**
 * One-time backup codes with Copy and Download. The codes are held only by the caller's state and
 * disappear when it clears them; nothing is persisted by this component.
 */
export function RecoveryCodes({
  codes,
  heading = "One-time recovery codes",
  description,
  onNotice,
}: {
  codes: readonly string[];
  heading?: string;
  description: string;
  onNotice?: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      onNotice?.("Recovery codes copied.");
    } catch {
      onNotice?.("Copy was unavailable. Select the text and copy it manually.");
    }
  };

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([recoveryCodesFileContents(codes)], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = RECOVERY_CODES_FILENAME;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    onNotice?.("Recovery codes downloaded.");
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{heading}</h3>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy codes"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={download}>
            <Download aria-hidden />
            Download
          </Button>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <ul className="mt-3 grid gap-2 rounded-md border border-border p-4 font-mono text-sm sm:grid-cols-2">
        {codes.map((backupCode) => (
          <li key={backupCode}>{backupCode}</li>
        ))}
      </ul>
    </div>
  );
}
