import { describe, it, expect } from "vitest";
import { unquotedBody, signedByFounder, judgeThread, classifyThread, type ScanMessage } from "@/lib/gmail/sentScan";

describe("unquotedBody", () => {
  it("cuts at a leading > quote marker", () => {
    const body = "Hi Jane,\n\nWorth a chat?\n\nBest,\nEmil\n\n> earlier text\n> more";
    expect(unquotedBody(body)).toBe("Hi Jane,\n\nWorth a chat?\n\nBest,\nEmil\n");
  });

  it("cuts at a single-line On ... wrote: marker", () => {
    const body = "Following up.\n\nEmil\n\nOn Tue, Jul 28, 2026 at 10:04 AM Jane Roe <jane@acme.com> wrote:\nsure";
    expect(unquotedBody(body)).toBe("Following up.\n\nEmil\n");
  });

  it("cuts when Gmail wraps wrote: onto the next line", () => {
    const body = "Following up.\n\nEmil\n\nOn Tue, Jul 28, 2026 Jane Roe <jane@acme.com>\nwrote:\nsure";
    expect(unquotedBody(body)).toBe("Following up.\n\nEmil\n");
  });

  it("cuts at an Outlook original-message divider", () => {
    const body = "Any thoughts?\n\nEmil\n\n-----Original Message-----\nFrom: Jane";
    expect(unquotedBody(body)).toBe("Any thoughts?\n\nEmil\n");
  });

  it("cuts at a From: line followed by Sent:", () => {
    const body = "Checking in.\n\nEmil\n\nFrom: Jane Roe\nSent: 28 July 2026 10:04\nTo: Emil";
    expect(unquotedBody(body)).toBe("Checking in.\n\nEmil\n");
  });

  it("leaves a body with no quoted section untouched", () => {
    const body = "Short note.\n\nEmil";
    expect(unquotedBody(body)).toBe(body);
  });

  it("does not treat a bare From: line as a quote marker", () => {
    const body = "From: the team at Pallisade\n\nWe build things.\n\nEmil";
    expect(unquotedBody(body)).toBe(body);
  });

  it("keeps the text below a quoted testimonial", () => {
    const body = "As one customer put it:\n> This saved us 10 hours a week.\n\nWorth a chat?\n\nBest,\nEmil";
    expect(unquotedBody(body)).toBe("As one customer put it:\n\nWorth a chat?\n\nBest,\nEmil");
  });
});

describe("signedByFounder", () => {
  it("matches a bare Emil on the last line", () => {
    expect(signedByFounder("Worth a chat?\n\nBest,\nEmil")).toBe(true);
  });

  it("matches Emil Fabel on the last line", () => {
    expect(signedByFounder("Worth a chat?\n\nEmil Fabel")).toBe(true);
  });

  it("matches a valediction and name on one line", () => {
    expect(signedByFounder("Worth a chat?\n\nBest, Emil")).toBe(true);
  });

  it("ignores trailing punctuation and whitespace", () => {
    expect(signedByFounder("Worth a chat?\n\nEmil.  \n\n")).toBe(true);
  });

  it("ignores case", () => {
    expect(signedByFounder("Worth a chat?\n\nEMIL")).toBe(true);
  });

  it("does NOT match when a title line sits below the name", () => {
    expect(signedByFounder("Worth a chat?\n\nEmil Fabel\nFounder, Pallisade Data")).toBe(false);
  });

  it("does not match another sender's sign-off", () => {
    expect(signedByFounder("Thanks for this.\n\nBest,\nJane")).toBe(false);
  });

  it("does not match Emil mentioned mid-sentence", () => {
    expect(signedByFounder("Emil here from Pallisade Data.\n\nSpeak soon,\nJane")).toBe(false);
  });

  it("only inspects the founder's own text, not the quoted reply", () => {
    const body = "Thanks Jane.\n\nJane\n\n> Best,\n> Emil";
    expect(signedByFounder(body)).toBe(false);
  });

  it("returns false for an empty body", () => {
    expect(signedByFounder("")).toBe(false);
  });

  it("still finds the sign-off below a quoted testimonial", () => {
    const body = "As one customer put it:\n> This saved us 10 hours a week.\n\nWorth a chat?\n\nBest,\nEmil";
    expect(signedByFounder(body)).toBe(true);
  });

  it("still finds the sign-off in an interleaved point-by-point reply", () => {
    const body = "> your first question\nAnswer one.\n\n> your second question\nAnswer two.\n\nBest,\nEmil";
    expect(signedByFounder(body)).toBe(true);
  });
});

describe("judgeThread", () => {
  const base = { subject: "hello", labelNames: ["SENT"], ownMessageBodies: ["hi\n\nJane"] };

  it("includes a thread whose subject contains the keyword", () => {
    expect(judgeThread({ ...base, subject: "Pallisade Data — quick question" }))
      .toEqual({ included: true, reason: "subject" });
  });

  it("matches the subject keyword case-insensitively", () => {
    expect(judgeThread({ ...base, subject: "re: pallisade intro" }).included).toBe(true);
  });

  it("includes a thread signed off by the founder even with an unrelated subject", () => {
    expect(judgeThread({ ...base, subject: "Re: intro from Sarah", ownMessageBodies: ["Hi\n\nBest,\nEmil"] }))
      .toEqual({ included: true, reason: "signoff" });
  });

  it("checks every one of the founder's messages for a sign-off", () => {
    const input = { ...base, subject: "Re: intro", ownMessageBodies: ["first note\n\nJane", "second\n\nEmil"] };
    expect(judgeThread(input).included).toBe(true);
  });

  it("excludes a warming-labelled thread even when the subject matches", () => {
    const input = { subject: "Pallisade Data", labelNames: ["SENT", "Apollo Mailwarming"], ownMessageBodies: ["x\n\nEmil"] };
    expect(judgeThread(input)).toEqual({ included: false, reason: "warming_label" });
  });

  it("excludes a thread matching neither rule, and says why", () => {
    expect(judgeThread({ ...base, subject: "Re: intro from Sarah" }))
      .toEqual({ included: false, reason: "no_subject_no_signoff" });
  });

  it("excludes a thread with no messages from the founder", () => {
    expect(judgeThread({ ...base, subject: "Re: intro", ownMessageBodies: [] }))
      .toEqual({ included: false, reason: "no_subject_no_signoff" });
  });
});

const own = new Set(["emil@pallisade.com"]);

// classifyThread only reads `from` and `date`, so recipients stay empty here.
const msg = (from: string, date: string): ScanMessage =>
  ({ from, to: [], date, text: "" });

describe("classifyThread", () => {
  it("returns no_reply when only the founder has written", () => {
    const messages = [
      msg("emil@pallisade.com", "2026-07-01T09:00:00Z"),
      msg("emil@pallisade.com", "2026-07-08T09:00:00Z"),
    ];
    expect(classifyThread(messages, own)).toBe("no_reply");
  });

  it("returns awaiting_you when their message is last", () => {
    const messages = [
      msg("emil@pallisade.com", "2026-07-01T09:00:00Z"),
      msg("jane@acme.com", "2026-07-02T09:00:00Z"),
    ];
    expect(classifyThread(messages, own)).toBe("awaiting_you");
  });

  it("returns stalled when they replied but the founder answered last", () => {
    const messages = [
      msg("emil@pallisade.com", "2026-07-01T09:00:00Z"),
      msg("jane@acme.com", "2026-07-02T09:00:00Z"),
      msg("emil@pallisade.com", "2026-07-03T09:00:00Z"),
    ];
    expect(classifyThread(messages, own)).toBe("stalled");
  });

  it("orders by date rather than trusting array order", () => {
    const messages = [
      msg("jane@acme.com", "2026-07-02T09:00:00Z"),
      msg("emil@pallisade.com", "2026-07-01T09:00:00Z"),
    ];
    expect(classifyThread(messages, own)).toBe("awaiting_you");
  });

  it("matches the founder's own address case-insensitively", () => {
    const messages = [
      msg("Emil@Pallisade.com", "2026-07-01T09:00:00Z"),
      msg("emil@pallisade.com", "2026-07-02T09:00:00Z"),
    ];
    expect(classifyThread(messages, own)).toBe("no_reply");
  });

  it("treats every connected inbox as the founder", () => {
    const multi = new Set(["emil@pallisade.com", "emil@pallisadedata.io"]);
    const messages = [
      msg("emil@pallisade.com", "2026-07-01T09:00:00Z"),
      msg("emil@pallisadedata.io", "2026-07-02T09:00:00Z"),
    ];
    expect(classifyThread(messages, multi)).toBe("no_reply");
  });

  it("returns no_reply for an empty thread", () => {
    expect(classifyThread([], own)).toBe("no_reply");
  });

  it("keeps an undated message in Gmail's original position rather than first", () => {
    const messages: ScanMessage[] = [
      msg("jane@acme.com", "2026-07-02T09:00:00Z"),
      { from: "emil@pallisade.com", to: [], date: "", text: "" },
    ];
    expect(classifyThread(messages, own)).toBe("stalled");
  });

  it("classifies an undated final reply from them as awaiting_you", () => {
    const messages: ScanMessage[] = [
      msg("emil@pallisade.com", "2026-07-01T09:00:00Z"),
      { from: "jane@acme.com", to: [], date: "", text: "" },
    ];
    expect(classifyThread(messages, own)).toBe("awaiting_you");
  });
});
