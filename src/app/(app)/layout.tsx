// Layout "đã đăng nhập": chặn truy cập chưa xác thực, bọc AppShell theo role.
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <AppShell role={profile.role} name={profile.full_name || "Người dùng"}>
      {children}
    </AppShell>
  );
}
