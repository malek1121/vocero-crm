import { redirect } from "next/navigation";
import { getAuthSession, getSessionOrNull } from "@/lib/auth/session";
import { getBranding } from "@/server/branding";
import { AppNav } from "@/components/app-nav";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const branding = await getBranding(session.organizationId);
  // Deduplicado por request con requireSession (React cache): 1 solo lookup.
  const authSession = await getAuthSession();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppNav
        branding={branding}
        userName={authSession?.user.name ?? "Usuario"}
        role={session.role}
      />
      <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
