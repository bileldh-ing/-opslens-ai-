import type { Metadata } from "next";
import { StatusScreen } from "@/components/status-screen";

export const metadata: Metadata = { title: "Offline · OpsLens AI" };
export const dynamic = "force-static";

/** Pre-cached by the service worker and served when a navigation fails with no network. */
export default function OfflinePage() {
  return (
    <StatusScreen
      code="offline"
      title="You are offline"
      description="OpsLens needs a connection to load live incidents and run investigations. It will work again as soon as you are back online."
    >
      {/* Plain anchor: a full navigation retries through the network. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium hover:bg-blue-500">Retry</a>
    </StatusScreen>
  );
}
