import type { MetadataRoute } from "next";

/** Web app manifest (served at /manifest.webmanifest): makes OpsLens installable as a PWA. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "OpsLens AI — Incident Intelligence",
    short_name: "OpsLens",
    description: "Investigate production incidents with AI grounded in your logs, deployments, docs and incident history.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    background_color: "#0a0d14",
    theme_color: "#0a0d14",
    categories: ["developer", "productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
