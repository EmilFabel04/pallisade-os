export { auth as middleware } from "@/auth";

export const config = {
  matcher: [
    // Run on all paths EXCEPT: /api/auth/*, the cron-invoked daily route,
    // /login, Next internals, and static files. The daily route is gated by
    // CRON_SECRET or a session inside the handler itself, so fronting it here
    // would only bounce Vercel's cron to /login.
    //
    // This MUST stay an inline literal. Next.js statically analyses the
    // `config` export at build time and rejects an imported constant with
    // "Unknown identifier ... at config.matcher[0]" — the build fails, not
    // just the analysis. middlewareMatcher.test.ts reads this file and tests
    // the literal, so it is covered without being extracted.
    "/((?!api/auth|api/content/daily|login|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)).*)",
  ],
};
