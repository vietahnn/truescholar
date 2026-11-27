// Chạy SQL trực tiếp trên Postgres của Supabase qua connection string (service role).
// Cần SUPABASE_DB_URL dạng: postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
import pg from "pg";

const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Thiếu SUPABASE_DB_URL (connection string Postgres, không phải service role key)");
  console.error("Lấy tại: Supabase Dashboard → Project Settings → Database → Connection string → URI");
  process.exit(1);
}

const SQLS = [
  `create or replace function public.i_am_lecturer() returns boolean
   language sql stable security definer set search_path = public as
   $$ select exists (select 1 from public.profiles where id = auth.uid() and role in ('lecturer', 'admin')) $$;`,
  `drop policy if exists "lecturer reads student profiles" on public.profiles;`,
  `create policy "lecturer reads student profiles" on public.profiles
     for select using (public.i_am_lecturer());`,
  `alter table public.courses enable row level security;`,
  `alter table public.courses force row level security;`,
  `drop policy if exists "lecturer manages own courses" on public.courses;`,
  `create policy "lecturer manages own courses" on public.courses
     for all using (created_by = auth.uid() and public.i_am_lecturer())
     with check (created_by = auth.uid() and public.i_am_lecturer());`,
  `alter table public.classes enable row level security;`,
  `alter table public.classes force row level security;`,
  `drop policy if exists "lecturer manages own classes" on public.classes;`,
  `create policy "lecturer manages own classes" on public.classes
     for all using (created_by = auth.uid() and public.i_am_lecturer())
     with check (created_by = auth.uid() and public.i_am_lecturer());`,
  `drop policy if exists "lecturer removes class enrollments" on public.enrollments;`,
  `create policy "lecturer removes class enrollments" on public.enrollments
     for delete using (exists (
       select 1 from public.classes c
       where c.id = class_id and c.created_by = auth.uid() and public.i_am_lecturer()
     ));`,
];

async function main() {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  for (const sql of SQLS) {
    try {
      await client.query(sql);
      console.log("OK:", sql.replace(/\s+/g, " ").slice(0, 70) + "...");
    } catch (e: any) {
      console.log("FAIL:", e.message.slice(0, 120), "→", sql.replace(/\s+/g, " ").slice(0, 60));
    }
  }
  await client.end();
}
main();
