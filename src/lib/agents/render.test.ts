import { describe, it, expect } from "vitest";
import { renderBody } from "@/lib/agents/render";
import type { AgentContext } from "@/lib/agents/types";

const ctx: AgentContext = {
  today: "2026-08-13", businessName: "Pallisade Data", founderName: "Emil",
  services: "AI systems", snapshot: null, proposals: [],
  emailEnabled: false, calendarEnabled: false, driveAccountId: null,
};

describe("renderBody", () => {
  it("substitutes every known placeholder", () => {
    expect(renderBody("{{today}} {{businessName}} {{founderName}} {{services}}", ctx))
      .toBe("2026-08-13 Pallisade Data Emil AI systems");
  });

  it("substitutes a placeholder used more than once", () => {
    expect(renderBody("{{founderName}} and {{founderName}}", ctx)).toBe("Emil and Emil");
  });

  it("leaves an unknown placeholder untouched rather than blanking it", () => {
    expect(renderBody("{{nope}}", ctx)).toBe("{{nope}}");
  });

  it("returns a body with no placeholders unchanged", () => {
    expect(renderBody("plain text", ctx)).toBe("plain text");
  });
});
