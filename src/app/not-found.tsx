import { StatusScreen } from "@/components/status-screen";

export default function NotFound() {
  return <StatusScreen code="404" title="Page not found" description="This page does not exist, or you do not have access to it." />;
}
