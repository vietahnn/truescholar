// Kiểm tra nhanh dữ liệu courses/classes bằng service role.
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  const { data: courses, error: e1 } = await admin.from("courses").select("id, code, title, created_by");
  console.log("courses:", e1 ? "LỖI " + e1.message : JSON.stringify(courses?.map(c => ({ id: c.id.slice(0, 8), code: c.code, by: c.created_by?.slice(0, 8) })), null, 1));
  const { data: classes, error: e2 } = await admin.from("classes").select("id, name, course_id, created_by");
  console.log("classes:", e2 ? "LỖI " + e2.message : JSON.stringify(classes?.map(c => ({ id: c.id.slice(0, 8), name: c.name, by: c.created_by?.slice(0, 8) })), null, 1));
}
main();
