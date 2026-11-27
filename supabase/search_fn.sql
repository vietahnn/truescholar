-- Hàm full-text search các section đã duyệt (chạy sau schema.sql)
-- Cần extension: create extension if not exists pg_trgm;
create extension if not exists pg_trgm;

create or replace function public.search_sections(p_query text, p_limit int default 6)
returns table (
  id uuid,
  document_id uuid,
  content text,
  page_from int,
  page_to int,
  document_title text,
  rank double precision
)
language sql stable security invoker as $$
  with q as (
    select
      plainto_tsquery('simple', coalesce(p_query, '')) as and_q,
      (
        select to_tsquery('simple', string_agg(quote_literal(lexeme), ' | '))
        from unnest(to_tsvector('simple', coalesce(p_query, ''))) as t(lexeme, positions)
      ) as or_q
  )
  select
    ds.id, ds.document_id, ds.content, ds.page_from, ds.page_to,
    d.title as document_title,
    (
      ts_rank(to_tsvector('simple', ds.content), q.and_q)::double precision * 2.0
      + coalesce(ts_rank(to_tsvector('simple', ds.content), q.or_q)::double precision, 0)
      + similarity(ds.content, coalesce(p_query, ''))::double precision * 0.5
    ) as rank
  from public.document_sections ds
  join public.documents d on d.id = ds.document_id
  cross join q
  where ds.decision = 'lesson'
    and d.status = 'published'
    and (d.visibility = 'center' or exists (
      select 1 from public.classes c
      join public.enrollments e on e.class_id = c.id
      where c.course_id = d.course_id and e.user_id = auth.uid()
    ))
    and (
      to_tsvector('simple', ds.content) @@ q.and_q
      or (q.or_q is not null and to_tsvector('simple', ds.content) @@ q.or_q)
      or similarity(ds.content, coalesce(p_query, '')) > 0.3
    )
  order by rank desc
  limit p_limit;
$$;
