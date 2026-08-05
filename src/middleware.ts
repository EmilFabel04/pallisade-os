import { AUTH_PATH_MATCHER } from "@/lib/authMatcher";

export { auth as middleware } from "@/auth";

export const config = {
  // The pattern lives in @/lib/authMatcher so it can be unit-tested without
  // pulling next-auth into the test environment.
  matcher: [AUTH_PATH_MATCHER],
};
