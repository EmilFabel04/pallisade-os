"use client";

import { cn } from "@/lib/utils";
import { MicButton } from "./MicButton";

/**
 * A textarea with a mic in the corner. Voice transcripts are appended to the
 * current value. Uses an onValueChange callback (rather than a raw change event)
 * so both typing and dictation funnel through one setter.
 */
export function DictateTextArea({
  value,
  onValueChange,
  className,
  rows = 3,
  ...rest
}: {
  value: string;
  onValueChange: (v: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const append = (text: string) => {
    const sep = value && !/\s$/.test(value) ? " " : "";
    onValueChange(`${value}${sep}${text}`);
  };

  return (
    <div className="relative">
      <textarea
        {...rest}
        value={value}
        rows={rows}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn("textarea pr-10", className)}
      />
      <div className="absolute right-2 bottom-2">
        <MicButton onTranscript={append} title="Dictate notes" />
      </div>
    </div>
  );
}
