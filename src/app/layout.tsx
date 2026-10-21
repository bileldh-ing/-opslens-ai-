import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpsLens AI — Intelligent Software Operations",
  description: "Investigate production incidents with AI grounded in your logs, deployments, docs and incident history.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
