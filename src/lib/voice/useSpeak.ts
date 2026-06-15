"use client";

import { useCallback, useEffect, useState } from "react";

export interface Speaker {
  /** False when the browser has no speechSynthesis support. */
  supported: boolean;
  speak: (text: string) => void;
}

/** Speaks short text aloud via the browser's built-in speechSynthesis (no API/cost). */
export function useSpeak(): Speaker {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      synth.cancel(); // stop any in-flight utterance
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.85; // a touch slower so it's easy to mimic
      synth.speak(utterance);
    },
    [],
  );

  return { supported, speak };
}
