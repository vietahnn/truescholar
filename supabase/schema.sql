-- TrueScholar MVP — schema Supabase (chạy 1 lần trong SQL Editor)
-- Vai trò: profile.role ∈ {'student','lecturer','admin'}

-- ============ Profiles & lớp học ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'student' check (role in ('student','lecturer','admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- Tự động tạo profile khi user đăng ký qua Supabase Auth (chỉ cho phép student/lecturer)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  requested_role text := coalesce(new.raw_user_meta_data->>'role', 'student');
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when requested_role = 'lecturer' then 'lecturer' else 'student' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper kiểm tra vai trò giảng viên/admin (security definer tránh đệ quy RLS trên profiles)
create or replace function public.is_staff()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('lecturer', 'admin')
  );
$$;

-- Policy trên profiles không được query lại profiles trực tiếp (gây đệ quy RLS);
-- dùng security definer function.
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "lecturer reads student profiles" on public.profiles
  for select using (public.is_staff());

create or replace function public.share_class_with(target uuid)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.enrollments e1
    where e1.user_id = auth.uid()
      and exists (
        select 1 from public.enrollments e2
        where e2.class_id = e1.class_id and e2.user_id = target
      )
  );
$$;

create policy "read profiles of own classes" on public.profiles
  for select using (public.share_class_with(id));

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.courses enable row level security;
alter table public.courses force row level security;
create policy "lecturer manages own courses" on public.courses
  for all using (created_by = auth.uid() and public.is_staff())
  with check (created_by = auth.uid() and public.is_staff());

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.classes enable row level security;
alter table public.classes force row level security;
create policy "lecturer manages own classes" on public.classes
  for all using (created_by = auth.uid() and public.is_staff())
  with check (created_by = auth.uid() and public.is_staff());

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  unique (class_id, user_id)
);
alter table public.enrollments enable row level security;
alter table public.enrollments force row level security;
create policy "read own enrollments" on public.enrollments
  for select using (auth.uid() = user_id);
create policy "lecturer reads class enrollments" on public.enrollments
  for select using (exists (
    select 1 from public.classes c
    join public.profiles p on p.id = auth.uid()
    where c.id = class_id and c.created_by = p.id and p.role in ('lecturer', 'admin')
  ));
create policy "lecturer enrolls students" on public.enrollments
  for insert with check (exists (
    select 1 from public.classes c
    join public.profiles p on p.id = auth.uid()
    where c.id = class_id and c.created_by = p.id and p.role in ('lecturer', 'admin')
  ));
create policy "lecturer removes class enrollments" on public.enrollments
  for delete using (exists (
    select 1 from public.classes c
    join public.profiles p on p.id = auth.uid()
    where c.id = class_id and c.created_by = p.id and p.role in ('lecturer', 'admin')
  ));

-- Cho phép sinh viên đọc thông tin môn/lớp mình đã ghi danh (sau khi bảng enrollments tồn tại)
create policy "student reads enrolled courses" on public.courses
  for select using (exists (
    select 1 from public.classes c
    join public.enrollments e on e.class_id = c.id
    where c.course_id = courses.id and e.user_id = auth.uid()
  ));
create policy "student reads enrolled classes" on public.classes
  for select using (exists (
    select 1 from public.enrollments e
    where e.class_id = classes.id and e.user_id = auth.uid()
  ));

-- ============ Tài liệu & chunk (S13: chỉ published mới SV thấy) ============
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses(id) on delete cascade,
  uploaded_by uuid not null default auth.uid() references public.profiles(id),
  title text not null,
  storage_path text not null,
  visibility text not null default 'course' check (visibility in ('course','center')),
  status text not null default 'pending' check (status in ('pending','published','discarded')),
  created_at timestamptz not null default now()
);
alter table public.documents enable row level security;
alter table public.documents force row level security;
create policy "lecturer manages own documents" on public.documents
  for all using (uploaded_by = auth.uid() and public.is_staff())
  with check (uploaded_by = auth.uid() and public.is_staff());
create policy "student reads published documents" on public.documents
  for select using (
    status = 'published' and (
      visibility = 'center' or exists (
        select 1 from public.classes c
        join public.enrollments e on e.class_id = c.id
        where c.course_id = documents.course_id and e.user_id = auth.uid()
      )
    )
  );

create table if not exists public.document_sections (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  section_index int not null,
  content text not null,
  page_from int,
  page_to int,
  detection text not null default 'lesson' check (detection in ('lesson','suspected_answer','other')),
  decision text check (decision in ('lesson','answer','discard')),
  unique (document_id, section_index)
);
alter table public.document_sections enable row level security;
alter table public.document_sections force row level security;
create policy "lecturer manages sections" on public.document_sections
  for all using (exists (
    select 1 from public.documents d
    where d.id = document_id and d.uploaded_by = auth.uid() and public.is_staff()
  ))
  with check (exists (
    select 1 from public.documents d
    where d.id = document_id and d.uploaded_by = auth.uid() and public.is_staff()
  ));
create policy "student reads published lesson sections" on public.document_sections
  for select using (
    decision = 'lesson' and exists (
      select 1 from public.documents d
      where d.id = document_id
        and d.status = 'published'
        and (d.visibility = 'center' or exists (
          select 1 from public.classes c
          join public.enrollments e on e.class_id = c.id
          where c.course_id = d.course_id and e.user_id = auth.uid()
        ))
    )
  );

-- Full-text search index thay pgvector (Groq không có embedding API)
create index if not exists idx_sections_fts
  on public.document_sections using gin (to_tsvector('simple', content));

-- ============ Storage bucket 'documents' ============
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "staff uploads documents" on storage.objects;
create policy "staff uploads documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and public.is_staff());

drop policy if exists "staff manages own storage objects" on storage.objects;
create policy "staff manages own storage objects" on storage.objects
  for all to authenticated
  using (bucket_id = 'documents' and owner = auth.uid() and public.is_staff());

-- ============ Bài tập (S4: đáp án nằm ngoài tầm với của SV) ============
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null,
  description text default '',
  due_at timestamptz,
  max_attempts int not null default 3,
  status text not null default 'draft' check (status in ('draft','published')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.assignments enable row level security;
alter table public.assignments force row level security;
create policy "lecturer manages own assignments" on public.assignments
  for all using (created_by = auth.uid() and public.is_staff())
  with check (created_by = auth.uid() and public.is_staff());
create policy "student reads published assignments of own class" on public.assignments
  for select using (
    status = 'published' and exists (
      select 1 from public.enrollments e
      where e.class_id = assignments.class_id and e.user_id = auth.uid()
    )
  );

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  position int not null,
  prompt text not null,
  kind text not null check (kind in ('mcq','numeric','expression','essay')),
  options jsonb default '[]',           -- MCQ: [{key:"A", label:"..."}]
  variant_params jsonb default '{}',    -- {"l":"1.2","g":"9.81"}
  max_score numeric not null default 10
);
alter table public.questions enable row level security;
alter table public.questions force row level security;
create policy "lecturer manages questions" on public.questions
  for all using (exists (
    select 1 from public.assignments a
    where a.id = assignment_id and a.created_by = auth.uid() and public.is_staff()
  ))
  with check (exists (
    select 1 from public.assignments a
    where a.id = assignment_id and a.created_by = auth.uid() and public.is_staff()
  ));
create policy "student reads questions of published assignments" on public.questions
  for select using (exists (
    select 1 from public.assignments a
    join public.enrollments e on e.class_id = a.class_id
    where a.id = assignment_id and a.status = 'published' and e.user_id = auth.uid()
  ));

-- Khóa đáp án: chỉ GV sở hữu đọc được (đáp án không bao giờ về client SV)
create table if not exists public.answer_keys (
  question_id uuid primary key references public.questions(id) on delete cascade,
  encrypted text not null,              -- AES-256-GCM (SEALED_KEY)
  hint_ladder jsonb not null default '[]', -- [{level, content, unlock_after, penalty}]
  public_criteria text default ''
);
alter table public.answer_keys enable row level security;
alter table public.answer_keys force row level security;
create policy "lecturer manages answer keys" on public.answer_keys
  for all using (exists (
    select 1 from public.questions q
    join public.assignments a on a.id = q.assignment_id
    where q.id = question_id and a.created_by = auth.uid() and public.is_staff()
  ))
  with check (exists (
    select 1 from public.questions q
    join public.assignments a on a.id = q.assignment_id
    where q.id = question_id and a.created_by = auth.uid() and public.is_staff()
  ));

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  answer text not null,
  score numeric,
  graded jsonb,                         -- {correct, criteria_met[], feedback}
  created_at timestamptz not null default now()
);
alter table public.attempts enable row level security;
alter table public.attempts force row level security;
create policy "student manages own attempts" on public.attempts
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "lecturer reads attempts of own class" on public.attempts
  for select using (exists (
    select 1 from public.questions q
    join public.assignments a on a.id = q.assignment_id
    where q.id = question_id and a.created_by = auth.uid() and public.is_staff()
  ));

-- ============ Chat (grounded, có trích nguồn) ============
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null default 'academic' check (mode in ('academic','learning','hub')),
  title text not null default 'Cuộc trò chuyện mới',
  created_at timestamptz not null default now()
);
alter table public.chat_sessions enable row level security;
alter table public.chat_sessions force row level security;
create policy "own sessions" on public.chat_sessions
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  citations jsonb default '[]',         -- [{sectionId, documentTitle, page, index}]
  created_at timestamptz not null default now()
);
alter table public.chat_messages enable row level security;
alter table public.chat_messages force row level security;
create policy "own messages" on public.chat_messages
  for all using (exists (
    select 1 from public.chat_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.chat_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  ));

-- ============ Helper: lấy role hiện tại ============
create or replace function public.current_role()
returns text language sql stable as $$
  select role from public.profiles where id = auth.uid()
$$;
