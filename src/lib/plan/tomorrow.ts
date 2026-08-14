/* ============================================================
   Tomorrow plan — deterministic ranking, NOT a model call.

   This ranks open tasks, due follow-ups and the latest scorecard
   with plain `if`/`sort` logic. There is no AI involved here and
   never was; it was previously mislabelled as part of the mock AI
   layer in src/lib/ai.ts. It lives here on its own because it is
   ordinary business logic, independent of whatever eventually
   replaces the mock AI functions.
   ============================================================ */

import type { Scorecard, Task } from "@/lib/types";

export function tomorrowPlan(input: {
  scorecard?: Scorecard | null;
  openTasks: Task[];
  dueFollowUps: number;
}): { priorities: string[]; outreachFocus: string; buildFocus: string } {
  const priorities: string[] = [];

  if (input.dueFollowUps > 0)
    priorities.push(`Clear ${input.dueFollowUps} follow-up${input.dueFollowUps > 1 ? "s" : ""} due — start the day on the pipeline.`);

  const hiTask = input.openTasks
    .filter((t) => t.priority === "high" && t.status !== "done")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))[0];
  if (hiTask) priorities.push(`Advance high-priority task: ${shorten(hiTask.title, 80)}.`);

  const sc = input.scorecard;
  if (sc && sc.dials < 20)
    priorities.push("Hit a real dial target — book at least one new conversation.");
  else if (sc && sc.productHours < 1)
    priorities.push("Protect a deep-work block on the active build.");

  const fallbacks = [
    "Book 3 discovery conversations from warm leads.",
    "Push the top project one milestone forward.",
    "Send 5 tailored outreach messages before noon.",
  ];
  let i = 0;
  while (priorities.length < 3) priorities.push(fallbacks[i++]);

  return {
    priorities: priorities.slice(0, 3),
    outreachFocus:
      input.dueFollowUps > 0
        ? "Follow-ups first, then fresh outreach to keep the top of funnel full."
        : "Fresh outreach: 30 quality touches across calls, LinkedIn and email.",
    buildFocus:
      sc && sc.productHours > 0
        ? "Continue the active deliverable toward demo-ready."
        : "Carve out one focused build block on the highest-leverage product.",
  };
}

function shorten(s: string, max = 80): string {
  const t = s.trim().replace(/[.;]+$/, "");
  return t.length > max ? t.slice(0, max - 1).trim() + "…" : t;
}
