import { acceptInvitation } from "@/app/actions/invitations";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await acceptInvitation(token);
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-red-400">{result?.error}</p>
    </main>
  );
}
