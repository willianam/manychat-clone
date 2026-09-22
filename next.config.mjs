/**
 * Content-Security-Policy.
 *
 * `frame-ancestors 'none'` is the point of this policy: the panel keeps a
 * 30-day SameSite=Lax session cookie, so without it a third-party page can
 * frame the dashboard and trick the operator into clicking "Excluir" or
 * firing a broadcast.
 *
 * script-src keeps 'unsafe-inline' and 'unsafe-eval' on purpose. Next 15
 * inlines the RSC flight payload and the bootstrap script in every HTML
 * response, and the dev server evaluates code for HMR; a nonce-based policy
 * needs the middleware to rewrite every document request, which is a bigger
 * change than this remediation phase should make. Written as a list so the
 * tightening path is obvious rather than buried.
 *
 * img-src allows https: and data: — the inbox renders Instagram CDN avatars
 * and the ref-link page renders QR codes as data URLs.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The app never imports next/image — Avatar.tsx and MediaPicker.tsx both
  // document why (signed, expiring Instagram CDN hosts). Turning the
  // optimizer off removes the unauthenticated /_next/image endpoint, which
  // is the route into the sharp/libvips AVIF advisories.
  images: { unoptimized: true },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
