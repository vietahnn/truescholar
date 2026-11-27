// Kiểm tra toàn bộ database: bảng, policy RLS, trigger, hàm, extension.
// Chạy: node --env-file=.env --experimental-strip-types scripts/audit-db.ts
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  console.log("=== AUDIT DATABASE TrueScholar MVP ===\n");

  const tables = ["profiles", "courses", "classes", "enrollments", "documents", "document_sections", "assignments", "questions", "answer_keys", "attempts", "chat_sessions", "chat_messages"];
  for (const t of tables) {
    const { error } = await admin.from(t).select("*").limit(1);
    console.log(`${error ? "✗" : "✓"} bảng ${t}${error ? ` — ${error.message}` : ""}`);
  }

  console.log("\n=== DỮ LIỆU ===");
  for (const t of tables) {
    const { count } = await admin.from(t).select("*", { count: "exact", head: true });
    console.log(`${t}: ${count ?? "?"} dòng`);
  }

  console.log("\n=== PROFILES SO VỚI AUTH USERS ===");
  const { data: profiles } = await admin.from("profiles").select("id, role, full_name");
  console.log(`profiles: ${profiles?.length ?? 0} dòng`);
  profiles?.forEach((p) => console.log(`  - ${p.id.slice(0, 8)} role=${p.role} name=${p.full_name}`));

  console.log("\n=== STORAGE ===");
  const { data: buckets, error: bucketErr } = await admin.storage.listBuckets();
  if (bucketErr) console.log(`✗ không liệt kê được bucket: ${bucketErr.message}`);
  const docBucket = buckets?.find((b) => b.id === "documents" || b.name === "documents");
  console.log(`${docBucket ? "✓" : "✗"} bucket 'documents'${docBucket ? "" : " — chưa tạo! App upload sẽ lỗi"}`);

  console.log("\n=== HÀM SEARCH ===");
  const { data: searchRes, error: searchErr } = await admin.rpc("search_sections", { p_query: "test", p_limit: 1 });
  console.log(`${searchErr ? "✗" : "✓"} search_sections: ${searchErr ? searchErr.message : `OK, trả ${searchRes?.length ?? 0} kết quả (test)`}`);

  console.log("\n=== XONG ===");
}

main();
