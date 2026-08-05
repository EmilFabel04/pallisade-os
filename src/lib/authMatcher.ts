/**
 * Which paths NextAuth's middleware fronts.
 *
 * A negative lookahead listing the exclusions. Kept in its own module — with
 * no next-auth import — so it can be unit-tested: widening it by accident
 * leaves a route unauthenticated with no visible symptom.
 *
 * Excluded, and why:
 * - `api/auth`          the sign-in flow itself
 * - `api/content/daily` invoked by the Vercel cron with no session; gated
 *                       inside the handler by CRON_SECRET or a session, so
 *                       fronting it here would just bounce the cron to /login
 * - `login`             the sign-in page
 * - Next internals and static assets
 */
export const AUTH_PATH_MATCHER =
  "/((?!api/auth|api/content/daily|login|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)).*)";
