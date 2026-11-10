import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist", "pdf-lib", "@pdf-lib/fontkit", "xlsx"],
};

export default nextConfig;
