/* ============================================================
   TypeSafe "System One" wire types (server-only).
   Mirrors the documented shape of POST /v1/systemone. Nothing
   in here knows about email, leads or this app.
   ============================================================ */

export interface JevNoulAnswer {
  type: "noul";
  /** Probability the statement is true, 0-1. */
  noul: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevScoreAnswer {
  type: "score";
  /** Fractional position across the criteria levels, e.g. 1.05 on a 0-2 scale. */
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export type JevQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: JevUsage;
}

/** Every failure this client raises, so callers can catch one type and degrade. */
export class JevError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "JevError";
  }
}
