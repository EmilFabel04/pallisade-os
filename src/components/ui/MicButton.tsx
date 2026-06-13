"use client";

import { Mic, Square, Loader2 } from "lucide-react";
import { useVoiceInput } from "@/lib/voice/useVoiceInput";
import { cn } from "@/lib/utils";

/**
 * Mic toggle that records and drops a Whisper transcript into onTranscript.
 * Renders a disabled hint when no OpenAI key is configured so the feature is
 * discoverable rather than silently absent.
 */
export function MicButton({
  onTranscript,
  size = 15,
  className,
  title = "Dictate",
}: {
  onTranscript: (text: string) => void;
  size?: number;
  className?: string;
  title?: string;
}) {
  const { recording, transcribing, configured, error, toggle } = useVoiceInput(onTranscript);

  const disabled = configured === false || transcribing;
  const hint =
    configured === false
      ? "Add OPENAI_API_KEY to .env.local to enable voice"
      : recording
      ? "Stop & transcribe"
      : error === "mic_denied"
      ? "Microphone permission denied"
      : title;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      title={hint}
      aria-label={hint}
      className={cn(
        "inline-flex items-center justify-center rounded-md border transition-colors h-7 w-7 shrink-0",
        recording
          ? "border-[var(--color-accent)] text-[var(--color-accent)] animate-pulse bg-[var(--color-surface-2)]"
          : "border-[var(--color-line-strong)] text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]",
        disabled && "opacity-40 cursor-not-allowed",
        className,
      )}
    >
      {transcribing ? (
        <Loader2 size={size} className="animate-spin" />
      ) : recording ? (
        <Square size={size - 2} />
      ) : (
        <Mic size={size} />
      )}
    </button>
  );
}
