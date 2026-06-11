import type { Tone } from "@/lib/badges";
import { TONE_STYLE } from "@/lib/badges";
import { cn } from "@/lib/utils";

export function Badge({
  tone = "neutral",
  children,
  dot = true,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  const s = TONE_STYLE[tone];
  return (
    <span
      className={cn("chip", className)}
      style={{ color: s.color, borderColor: s.border, background: s.bg }}
    >
      {dot && (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: "currentColor",
            display: "inline-block",
          }}
        />
      )}
      <span style={{ color: "inherit" }}>{children}</span>
    </span>
  );
}
