import type { NextConfig } from "next";

/* Security headers applied to every response. `microphone=(self)` is kept
   enabled because the app uses the mic for voice input; everything else is
   locked down. A minimal CSP (`frame-ancestors 'none'`) backs up
   X-Frame-Options without risking script breakage. */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
