/**
 * A curated, deterministic daily affirmation for the Pallisade progress
 * dashboard. One is shown per calendar day (by day-of-year), so it is stable
 * for the whole day and rotates every day. No AI, no network.
 */
export const AFFIRMATIONS: string[] = [
  "You are building something real, one deliberate day at a time.",
  "Every call you make moves Pallisade forward, whether it lands or not.",
  "Discipline today is the compound interest of tomorrow's success.",
  "You do not need permission to build the future you see.",
  "Progress over perfection — ship, learn, repeat.",
  "The founder who keeps showing up outlasts the one waiting to feel ready.",
  "Your pipeline reflects your effort; pour into it without apology.",
  "Rejection is data, not a verdict on your worth.",
  "You have already done hard things — this is just the next one.",
  "Consistency is a superpower, and it is one you own.",
  "The work you avoid is usually the work that moves the needle.",
  "You are the kind of person who finishes what they start.",
  "Small wins stacked daily become an undeniable trajectory.",
  "You turn uncertainty into momentum by taking the next action.",
  "Every pitch sharpens the story only you can tell.",
  "Focus on what you can control: the next call, the next build, the next day.",
  "You are allowed to want more and to go get it.",
  "Clarity comes from action, not from waiting to feel clear.",
  "The market rewards those who keep swinging with intent.",
  "You are becoming the operator this business needs.",
  "Hard days are proof you are doing something that matters.",
  "Your future clients are waiting for you to reach out.",
  "Build like it's inevitable, because you make it so.",
  "You are not behind; you are exactly one action from ahead.",
  "Momentum loves a founder who starts before they're ready.",
  "The best time to do the work is the time you have right now.",
  "You close the gap between vision and reality by showing up.",
  "Trust the process you designed; then execute it relentlessly.",
  "Every 'no' clears the path toward the right 'yes'.",
  "You are the calm, competent center of your own operation.",
  "What you build today, someone will depend on tomorrow.",
  "Your effort compounds even on the days you can't see it.",
  "Lead with value and the results will follow you home.",
  "You are proof that persistence beats raw talent.",
  "One focused hour from you is worth a distracted day from most.",
];

export function affirmationForDate(date: Date): string {
  const startUTC = Date.UTC(date.getFullYear(), 0, 0);
  const dateUTC = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOfYear = Math.floor((dateUTC - startUTC) / 86_400_000);
  return AFFIRMATIONS[dayOfYear % AFFIRMATIONS.length];
}
