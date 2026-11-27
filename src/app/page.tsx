import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  redirect(
    profile.role === "lecturer" || profile.role === "admin"
      ? "/lecturer/documents"
      : "/chat"
  );
}
