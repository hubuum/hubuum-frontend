import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";

function getBackendOrigin(): string | null {
  const raw = process.env.BACKEND_BASE_URL;
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

const backendOrigin = getBackendOrigin();

const csp = [
  "default-src 'self'",
  isDevelopment
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  `connect-src 'self'${backendOrigin ? ` ${backendOrigin}` : ""}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/api/v0/auth/login",
        destination: "/api/auth/login"
      },
      {
        source: "/api/v0/auth/logout",
        destination: "/api/auth/logout"
      },
      {
        source: "/api/v0/meta/:path*",
        destination: "/api/hubuum/api/v0/meta/:path*"
      },
      {
        source: "/api/v1/:path*",
        destination: "/api/hubuum/api/v1/:path*"
      }
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      }
    ];
  }
};

export default nextConfig;
