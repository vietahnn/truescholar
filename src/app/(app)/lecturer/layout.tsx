// Chặn sinh viên truy cập các trang giảng viên.
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";

export default async function LecturerLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "lecturer" && profile.role !== "admin") {
    redirect("/chat");
  }
  return <>{children}</>;
}
