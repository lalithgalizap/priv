import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Cache, security, and bundle settings.
 *
 * Static assets emitted under /_next/static/ are content-hashed by Next.js
 * and safe to cache forever at the CDN edge. Everything else stays uncached:
 * API responses are dynamic, /login etc. are personalised.
 */
const securityHeaders = [
  // Force browsers to never downgrade to HTTP after the first HTTPS visit.
  // 6 months is the conservative starting value; bump to 1y + preload once
  // the domain is fully on HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
  // Block click-jacking via iframe.
  { key: "X-Frame-Options", value: "DENY" },
  // Browsers must not sniff a content-type away from what the server declared.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Stop sending the full URL of our pages to third-party origins.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Lock down dangerous browser features we don't use.
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "interest-cohort=()",
      "payment=()",
      "usb=()",
    ].join(", "),
  },
  // CSP — applied only in production. Dev mode uses Fast Refresh and
  // source maps that would otherwise need extra whitelist entries.
  ...(isProd
    ? [
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: blob:",
            "font-src 'self' data: https://fonts.gstatic.com",
            "connect-src 'self' https://*.supabase.co",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join("; "),
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Security headers on every served document.
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Static, content-hashed assets — cache aggressively at the edge.
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Non-hashed public assets — long cache with revalidation.
        source: "/:path*\\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        // API responses must never be cached by the CDN.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
        ],
      },
    ];
  },

  // Production builds fail on TS errors; dev tolerates them. Lint runs
  // in CI, not in the build pipeline, so we don't gate next build on it.
  typescript: { ignoreBuildErrors: !isProd },
};

export default nextConfig;
