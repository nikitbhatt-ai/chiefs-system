import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    typedRoutes: true,
  },
  // public/ assets aren't traced into serverless function bundles by
  // default — they're served as static files via the CDN, but server
  // code that does fs.readFileSync against them comes up empty in
  // production. The upfit PDF renderer needs the vehicle template
  // images on the function's local disk, so explicitly include them.
  outputFileTracingIncludes: {
    "/api/pdf/upfit/**": ["./public/upfit-templates/**/*"],
  },
};

export default nextConfig;
