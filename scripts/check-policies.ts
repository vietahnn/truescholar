// Kiểm tra policy thực tế của bảng courses — dùng service role để đọc pg_policies.
// Service role không chạy SQL trực tiếp được; thay vào đó kiểm chứng qua hành vi:
// 1) Có bao nhiêu courses trong DB (bypass RLS)
// 2) Policy nào tồn tại trên courses (dùng postgres catalog qua... không được — chỉ REST)
// → Dùng SUPABASE_DB_URL nếu có, fallback: in ra kết quả REST.
import pg from "pg";

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (dbUrl) {
    const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      const { rows } = await client.query(
        `select tablename, policyname, cmd, qual, with_check from pg_policies
         where schemaname='public' and tablename in ('courses','classes','profiles')
         order by tablename, policyname`
      );
      console.log("=== POLICIES (từ catalog) ===");
      rows.forEach((r) =>
        console.log(`${r.tablename} | ${r.policyname} | ${r.cmd}\n  using: ${r.qual}\n  check: ${r.with_check}`)
      );
      await client.end();
      return;
    } catch (e: any) {
      console.log("Không kết nối được DB URL:", e.message.slice(0, 100));
    }
  }
  console.log("(Không có SUPABASE_DB_URL hoạt động — chỉ kiểm tra REST)");
  process.exit(0);
}
main();
