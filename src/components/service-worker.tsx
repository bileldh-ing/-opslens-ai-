"use client";

import { useEffect } from "react";

/** Registers /sw.js in production builds (offline fallback + installability). */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => console.warn("Service worker registration failed", err));
  }, []);
  return null;
}
