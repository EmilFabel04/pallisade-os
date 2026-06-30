import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    // Allowlist: only the configured email may complete sign-in.
    signIn({ profile }) {
      const allowed = process.env.AUTH_ALLOWED_EMAIL?.toLowerCase();
      const email = profile?.email?.toLowerCase();
      return (
        !!allowed &&
        !!email &&
        email === allowed &&
        profile?.email_verified === true
      );
    },
    // Used by middleware to authorize requests.
    authorized({ auth }) {
      // Local-dev convenience: when auth isn't configured in development,
      // allow through so the app runs without Google set up.
      // Production ALWAYS enforces (this bypass can never trigger in prod).
      if (
        process.env.NODE_ENV !== "production" &&
        !process.env.AUTH_GOOGLE_ID
      ) {
        return true;
      }
      return !!auth?.user;
    },
  },
});
