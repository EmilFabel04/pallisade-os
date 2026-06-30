export { auth as middleware } from "@/auth";

export const config = {
  matcher: [
    // Run on all paths EXCEPT: /api/auth/*, /login, Next internals, and static files.
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)).*)",
  ],
};
