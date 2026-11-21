alter table public.source_segments alter column document_version_id drop not null;
alter table public.source_segments add column workspace_standard_terms_version_id uuid
  references public.workspace_standard_terms_versions(id);
alter table public.source_segments add constraint source_segments_one_source
  check(num_nonnulls(document_version_id,workspace_standard_terms_version_id)=1);
create index source_segments_workspace_terms on public.source_segments(workspace_standard_terms_version_id)
  where workspace_standard_terms_version_id is not null;

create function app_private.is_workspace_terms_broker(p_version uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.workspace_standard_terms_versions v join public.memberships m on m.workspace_id=v.workspace_id
    where v.id=p_version and m.user_id=auth.uid() and m.role='broker');
$$;
revoke all on function app_private.is_workspace_terms_broker(uuid) from public,anon;
grant execute on function app_private.is_workspace_terms_broker(uuid) to authenticated,service_role;

drop policy private_segments on public.source_segments;
create policy private_segments on public.source_segments for select to authenticated using(
  (document_version_id is not null and exists(
    select 1 from public.document_versions d where d.id=document_version_id and app_private.is_broker(d.case_id)))
  or (workspace_standard_terms_version_id is not null and app_private.is_workspace_terms_broker(workspace_standard_terms_version_id))
);

create table public.ai_finding_reviews (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  step_index integer not null,
  finding_index integer not null check(finding_index between 0 and 29),
  reviewed_by uuid not null references auth.users(id),
  idempotency_key uuid not null,
  decision text not null check(decision in ('accepted','rejected','follow-up')),
  note text not null check(length(note) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(batch_id,step_index) references public.ai_steps(batch_id,step_index),
  unique(batch_id,step_index,finding_index,reviewed_by,idempotency_key)
);
alter table public.ai_finding_reviews enable row level security;
revoke all on public.ai_finding_reviews from anon,authenticated;
grant all on public.ai_finding_reviews to service_role;
grant select on public.ai_finding_reviews to authenticated;
create policy private_ai_finding_reviews on public.ai_finding_reviews for select to authenticated using(
  exists(select 1 from public.ai_batches b where b.id=batch_id and app_private.is_broker(b.case_id))
);
create trigger immutable_ai_finding_reviews before update or delete on public.ai_finding_reviews
  for each row execute function app_private.immutable_record();

create or replace function public.create_ai_batch(p_case_id text,p_actor uuid,p_request jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.renewal_cases; prior public.ai_batches; b uuid; s jsonb; d public.document_versions;
  terms public.workspace_standard_terms_versions; seg uuid; refs jsonb:='{}'; ids jsonb; idx integer:=0;
  has_prior boolean:=false; has_terms boolean:=false; has_prior_text boolean:=false; has_terms_text boolean:=false; source_type text;
begin
  select * into c from public.renewal_cases where id=p_case_id;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.workspaces where id=c.workspace_id for update;
  perform 1 from public.memberships where workspace_id=c.workspace_id and user_id=p_actor and role='broker' for share;
  if not found then raise exception 'BROKER_REQUIRED' using errcode='42501'; end if;
  select * into prior from public.ai_batches where case_id=p_case_id and created_by=p_actor and idempotency_key=(p_request->>'idempotencyKey')::uuid;
  if found then
    if prior.request is distinct from p_request then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
    return prior.id;
  end if;
  if p_request->>'purpose' not in ('extract','compare','clause-review') or jsonb_typeof(p_request->'sections')<>'array'
    or jsonb_array_length(p_request->'sections') not between 1 and 40
    or (select coalesce(sum(length(x->>'text')),0) from jsonb_array_elements(p_request->'sections')x)>40000
    or (select count(*) from jsonb_array_elements(p_request->'sections')x where x->>'kind'='image')>5
    or (select count(distinct x->>'id') from jsonb_array_elements(p_request->'sections')x)<>jsonb_array_length(p_request->'sections')
    then raise exception 'INVALID_AI_BATCH' using errcode='22023'; end if;
  for s in select * from jsonb_array_elements(p_request->'sections') loop
    source_type:=coalesce(s->>'sourceType','case');
    if source_type='case' then
      select * into d from public.document_versions v where v.case_id=p_case_id and v.source_version_id=s->>'documentVersionId'
        and v.upload_status='finalized' and v.sha256=s->>'sha256' and exists(select 1 from jsonb_array_elements(c.state->'documents')x
          where x->>'id'=v.source_version_id and x#>>'{file,id}'=v.id::text and x#>>'{file,sha256}'=v.sha256) for share;
      if not found then raise exception 'SOURCE_FILE_REQUIRED' using errcode='22023'; end if;
      if p_request->>'purpose'='clause-review' and exists(select 1 from jsonb_array_elements(c.state->'documents')x
        where x->>'id'=d.source_version_id and x->>'type'='prior-slip' and x->>'status' in ('agreed','issued')
          and x->>'periodEnd'<c.state#>>'{terms,periodStart}' and x#>>'{file,id}'=d.id::text and x#>>'{file,sha256}'=d.sha256)
        then has_prior:=true; end if;
      if p_request->>'purpose'='clause-review' and s->>'kind'='text' and exists(select 1 from jsonb_array_elements(c.state->'documents')x
        where x->>'id'=d.source_version_id and x->>'type'='prior-slip' and x->>'status' in ('agreed','issued')
          and x->>'periodEnd'<c.state#>>'{terms,periodStart}' and x#>>'{file,id}'=d.id::text and x#>>'{file,sha256}'=d.sha256)
        then has_prior_text:=true; end if;
      insert into public.source_segments(id,document_version_id,workspace_standard_terms_version_id,locator,excerpt,preparation)
        values(gen_random_uuid(),d.id,null,s->>'locator',
          case when s->>'kind'='text' then s->>'text' else '[Locally prepared image page; not transcribed]' end,'browser-ai-input')
        returning id into seg;
    elsif source_type='workspace-standard-terms' then
      select * into terms from public.workspace_standard_terms_versions v where v.id::text=s->>'documentVersionId'
        and v.workspace_id=c.workspace_id and v.upload_status='finalized' and v.sha256=s->>'sha256' for share;
      if not found then raise exception 'SOURCE_FILE_REQUIRED' using errcode='22023'; end if;
      has_terms:=true;
      if s->>'kind'='text' then has_terms_text:=true; end if;
      insert into public.source_segments(id,document_version_id,workspace_standard_terms_version_id,locator,excerpt,preparation)
        values(gen_random_uuid(),null,terms.id,s->>'locator',
          case when s->>'kind'='text' then s->>'text' else '[Locally prepared image page; not transcribed]' end,'browser-ai-input')
        returning id into seg;
    else
      raise exception 'INVALID_AI_SECTION' using errcode='22023';
    end if;
    if s->>'kind' not in ('text','image') or length(s->>'locator') not between 1 and 240
      or (s->>'kind'='text' and length(s->>'text') not between 1 and 40000) then raise exception 'INVALID_AI_SECTION' using errcode='22023'; end if;
    refs:=refs||jsonb_build_object(s->>'id',seg);
  end loop;
  if p_request->>'purpose'='clause-review' and (not has_prior or not has_terms or not has_prior_text or not has_terms_text) then
    raise exception 'AI_CLAUSE_SOURCES_REQUIRED' using errcode='22023';
  end if;
  b:=gen_random_uuid();
  insert into public.ai_batches(id,case_id,workspace_id,created_by,idempotency_key,request,source_segment_ids)
    values(b,p_case_id,c.workspace_id,p_actor,(p_request->>'idempotencyKey')::uuid,p_request,refs);
  select jsonb_agg(x->>'id') into ids from jsonb_array_elements(p_request->'sections')x where x->>'kind'='text';
  if ids is not null then insert into public.ai_steps(batch_id,step_index,section_ids)values(b,idx,ids);idx:=idx+1;end if;
  for s in select * from jsonb_array_elements(p_request->'sections')x where x->>'kind'='image' loop
    insert into public.ai_steps(batch_id,step_index,section_ids)values(b,idx,coalesce(ids,'[]'::jsonb)||jsonb_build_array(s->>'id'));idx:=idx+1;
  end loop;
  return b;
end $$;

create function public.review_ai_finding(p_case_id text,p_actor uuid,p_batch uuid,p_step integer,p_finding integer,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.ai_batches; s public.ai_steps; r public.ai_finding_reviews;
begin
  select * into b from public.ai_batches where id=p_batch and case_id=p_case_id;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.memberships where workspace_id=b.workspace_id and user_id=p_actor and role='broker' for share;
  if not found then raise exception 'BROKER_REQUIRED' using errcode='42501'; end if;
  if b.request->>'purpose' is distinct from 'clause-review' or p_step not between 0 and 5 or p_finding is null or p_finding not between 0 and 29
    or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_request->'idempotencyKey') is distinct from 'string'
    or p_request->>'idempotencyKey' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or jsonb_typeof(p_request->'decision') is distinct from 'string' or coalesce(p_request->>'decision','') not in ('accepted','rejected','follow-up')
    or jsonb_typeof(p_request->'note') is distinct from 'string'
    or coalesce(length(p_request->>'note'),0) not between 1 and 2000
    or (select count(*) from jsonb_object_keys(p_request))<>3 then
    raise exception 'INVALID_AI_FINDING_REVIEW' using errcode='22023';
  end if;
  select * into s from public.ai_steps where batch_id=p_batch and step_index=p_step for update;
  if not found or s.status<>'completed' or jsonb_typeof(s.result->'findings') is distinct from 'array'
    or p_finding>=jsonb_array_length(s.result->'findings') then
    raise exception 'AI_FINDING_REQUIRED' using errcode='22023';
  end if;
  select * into r from public.ai_finding_reviews where batch_id=p_batch and step_index=p_step and finding_index=p_finding
    and reviewed_by=p_actor and idempotency_key=(p_request->>'idempotencyKey')::uuid;
  if found then
    if r.decision is distinct from p_request->>'decision' or r.note is distinct from p_request->>'note' then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023';
    end if;
    return to_jsonb(r);
  end if;
  insert into public.ai_finding_reviews(batch_id,step_index,finding_index,reviewed_by,idempotency_key,decision,note)
    values(p_batch,p_step,p_finding,p_actor,(p_request->>'idempotencyKey')::uuid,p_request->>'decision',p_request->>'note')
    returning * into r;
  return to_jsonb(r);
end $$;

revoke all on function public.review_ai_finding(text,uuid,uuid,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.review_ai_finding(text,uuid,uuid,integer,integer,jsonb) to service_role;
