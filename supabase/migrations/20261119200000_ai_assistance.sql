-- AI outputs are broker-private suggestions; these RPCs never mutate renewal_cases.
alter table public.source_segments add column preparation text not null default 'manual-citation'
  check(preparation in ('manual-citation','browser-ai-input'));
create table public.ai_batches (
  id uuid primary key default gen_random_uuid(), case_id text not null references public.renewal_cases(id),
  workspace_id uuid not null references public.workspaces(id), created_by uuid not null references auth.users(id),
  idempotency_key uuid not null, request jsonb not null, source_segment_ids jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp(), unique(case_id,created_by,idempotency_key)
);
create table public.ai_steps (
  batch_id uuid not null references public.ai_batches(id), step_index integer not null check(step_index between 0 and 5),
  section_ids jsonb not null, status text not null default 'pending' check(status in ('pending','running','completed','failed')),
  result jsonb, error_code text, attempt_id uuid, lease_until timestamptz, attempted_at timestamptz, finished_at timestamptz,
  input_sha256 text check(input_sha256 is null or input_sha256 ~ '^[a-f0-9]{64}$'),
  primary key(batch_id,step_index),
  check((status='completed' and result is not null) or (status<>'completed' and result is null)),
  check(status<>'running' or (attempt_id is not null and lease_until is not null))
);
create table public.ai_attempts (
  id uuid primary key, workspace_id uuid not null references public.workspaces(id), case_id text not null references public.renewal_cases(id),
  batch_id uuid not null, step_index integer not null, requested_by uuid not null references auth.users(id),
  idempotency_key uuid not null, attempted_at timestamptz not null default clock_timestamp(),
  foreign key(batch_id,step_index) references public.ai_steps(batch_id,step_index), unique(batch_id,step_index)
);
create index ai_attempts_workspace_day on public.ai_attempts(workspace_id,attempted_at);
create table public.ai_step_reviews (
  id uuid primary key default gen_random_uuid(), batch_id uuid not null, step_index integer not null,
  reviewed_by uuid not null references auth.users(id), idempotency_key uuid not null,
  decision text not null check(decision in ('reviewed','dismissed')), note text not null check(length(note)<=2000),
  created_at timestamptz not null default clock_timestamp(), foreign key(batch_id,step_index) references public.ai_steps(batch_id,step_index),
  unique(batch_id,step_index,reviewed_by,idempotency_key)
);
create trigger immutable before update or delete on public.ai_batches for each row execute function app_private.immutable_record();
create trigger immutable before update or delete on public.ai_attempts for each row execute function app_private.immutable_record();
create trigger immutable before update or delete on public.ai_step_reviews for each row execute function app_private.immutable_record();
do $$ declare t text; begin
  foreach t in array array['ai_batches','ai_steps','ai_attempts','ai_step_reviews'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant select on public.ai_batches,public.ai_steps,public.ai_step_reviews to authenticated;
create policy private_ai_batches on public.ai_batches for select to authenticated using(app_private.is_broker(case_id));
create policy private_ai_steps on public.ai_steps for select to authenticated using(exists(select 1 from public.ai_batches b where b.id=batch_id and app_private.is_broker(b.case_id)));
create policy private_ai_reviews on public.ai_step_reviews for select to authenticated using(exists(select 1 from public.ai_batches b where b.id=batch_id and app_private.is_broker(b.case_id)));

create function public.create_ai_batch(p_case_id text,p_actor uuid,p_request jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.renewal_cases; prior public.ai_batches; b uuid; s jsonb; d public.document_versions; seg uuid;
  refs jsonb:='{}'; ids jsonb; idx integer:=0;
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
  if p_request->>'purpose' not in ('extract','compare') or jsonb_typeof(p_request->'sections')<>'array'
    or jsonb_array_length(p_request->'sections') not between 1 and 40
    or (select coalesce(sum(length(x->>'text')),0) from jsonb_array_elements(p_request->'sections')x)>40000
    or (select count(*) from jsonb_array_elements(p_request->'sections')x where x->>'kind'='image')>5
    or (select count(distinct x->>'id') from jsonb_array_elements(p_request->'sections')x)<>jsonb_array_length(p_request->'sections')
    then raise exception 'INVALID_AI_BATCH' using errcode='22023'; end if;
  for s in select * from jsonb_array_elements(p_request->'sections') loop
    select * into d from public.document_versions v where v.case_id=p_case_id and v.source_version_id=s->>'documentVersionId'
      and v.upload_status='finalized' and v.sha256=s->>'sha256' and exists(select 1 from jsonb_array_elements(c.state->'documents')x
        where x->>'id'=v.source_version_id and x#>>'{file,id}'=v.id::text and x#>>'{file,sha256}'=v.sha256) for share;
    if not found then raise exception 'SOURCE_FILE_REQUIRED' using errcode='22023'; end if;
    if s->>'kind' not in ('text','image') or length(s->>'locator') not between 1 and 240
      or (s->>'kind'='text' and length(s->>'text') not between 1 and 40000) then raise exception 'INVALID_AI_SECTION' using errcode='22023'; end if;
    seg:=gen_random_uuid();
    -- A browser-prepared excerpt is evidence for AI review, never an independently verified transcription.
    insert into public.source_segments(id,document_version_id,locator,excerpt,preparation) values(seg,d.id,s->>'locator',
      case when s->>'kind'='text' then s->>'text' else '[Locally prepared image page; not transcribed]' end,'browser-ai-input');
    refs:=refs||jsonb_build_object(s->>'id',seg);
  end loop;
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

create function public.ai_workspace_budget(p_workspace uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('attemptsToday',(select count(*) from public.ai_attempts a where a.workspace_id=p_workspace
    and a.attempted_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
    'limit',40,'inFlightUntil',(select max(s.lease_until) from public.ai_steps s join public.ai_batches b on b.id=s.batch_id
      where b.workspace_id=p_workspace and s.status='running' and s.lease_until>now()));
$$;

create function public.reserve_ai_step(p_case_id text,p_actor uuid,p_batch uuid,p_step integer,p_idempotency_key uuid,p_input_sha256 text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.ai_batches; s public.ai_steps; attempt uuid;
begin
  select * into b from public.ai_batches where id=p_batch and case_id=p_case_id;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  perform 1 from public.workspaces where id=b.workspace_id for update;
  perform 1 from public.memberships where workspace_id=b.workspace_id and user_id=p_actor and role='broker' for share;
  if not found then raise exception 'BROKER_REQUIRED' using errcode='42501';end if;
  -- The provider call is aborted at 35 s. A 120 s lease prevents concurrent retries after an interrupted Edge invocation.
  update public.ai_steps st set status='failed',error_code='AI_INTERRUPTED',finished_at=clock_timestamp(),lease_until=null
    from public.ai_batches batches where st.batch_id=batches.id and batches.workspace_id=b.workspace_id
      and st.status='running' and st.lease_until<=clock_timestamp();
  select * into s from public.ai_steps where batch_id=p_batch and step_index=p_step for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  if s.status in ('completed','failed') then return jsonb_build_object('run',false,'step',to_jsonb(s));end if;
  if s.status='running' or exists(select 1 from public.ai_steps st join public.ai_batches batches on batches.id=st.batch_id
    where batches.workspace_id=b.workspace_id and st.status='running') then raise exception 'AI_IN_FLIGHT' using errcode='P0001';end if;
  if (public.ai_workspace_budget(b.workspace_id)->>'attemptsToday')::integer>=40 then raise exception 'AI_DAILY_LIMIT' using errcode='P0001';end if;
  attempt:=gen_random_uuid();
  insert into public.ai_attempts(id,workspace_id,case_id,batch_id,step_index,requested_by,idempotency_key)
    values(attempt,b.workspace_id,p_case_id,p_batch,p_step,p_actor,p_idempotency_key);
  update public.ai_steps set status='running',attempt_id=attempt,lease_until=clock_timestamp()+interval '120 seconds',attempted_at=clock_timestamp(),input_sha256=p_input_sha256
    where batch_id=p_batch and step_index=p_step returning * into s;
  return jsonb_build_object('run',true,'step',to_jsonb(s));
end $$;

create function public.refresh_ai_leases(p_case_id text,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare workspace uuid;
begin
  select workspace_id into workspace from public.renewal_cases where id=p_case_id;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  perform 1 from public.workspaces where id=workspace for update;
  perform 1 from public.memberships where workspace_id=workspace and user_id=p_actor and role='broker' for share;
  if not found then raise exception 'BROKER_REQUIRED' using errcode='42501';end if;
  update public.ai_steps s set status='failed',error_code='AI_INTERRUPTED',finished_at=clock_timestamp(),lease_until=null
    from public.ai_batches b where b.id=s.batch_id and b.workspace_id=workspace and s.status='running' and s.lease_until<=clock_timestamp();
end $$;

create function public.finish_ai_step(p_case_id text,p_actor uuid,p_batch uuid,p_step integer,p_attempt uuid,p_result jsonb,p_error text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.ai_batches; s public.ai_steps;
begin
  select * into b from public.ai_batches where id=p_batch and case_id=p_case_id;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  perform 1 from public.workspaces where id=b.workspace_id for update;
  perform 1 from public.memberships where workspace_id=b.workspace_id and user_id=p_actor and role='broker' for share;
  if not found then raise exception 'BROKER_REQUIRED' using errcode='42501';end if;
  select * into s from public.ai_steps where batch_id=p_batch and step_index=p_step for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  if s.status in ('completed','failed') then return to_jsonb(s);end if;
  if s.status<>'running' or s.attempt_id is distinct from p_attempt or s.lease_until<=clock_timestamp() then raise exception 'AI_LEASE_EXPIRED' using errcode='P0001';end if;
  if (p_result is null)=(p_error is null) or (p_error is not null and p_error !~ '^AI_[A-Z_]{1,60}$') then raise exception 'INVALID_AI_RESULT' using errcode='22023';end if;
  update public.ai_steps set status=case when p_error is null then 'completed' else 'failed' end,result=p_result,error_code=p_error,
    finished_at=clock_timestamp(),lease_until=null where batch_id=p_batch and step_index=p_step returning * into s;
  return to_jsonb(s);
end $$;

create function public.review_ai_step(p_case_id text,p_actor uuid,p_batch uuid,p_step integer,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.ai_batches; r public.ai_step_reviews;
begin
  select * into b from public.ai_batches where id=p_batch and case_id=p_case_id;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  perform 1 from public.memberships where workspace_id=b.workspace_id and user_id=p_actor and role='broker' for share;
  if not found then raise exception 'BROKER_REQUIRED' using errcode='42501';end if;
  perform 1 from public.ai_steps where batch_id=p_batch and step_index=p_step and status='completed' for update;
  if not found then raise exception 'AI_RESULT_REQUIRED' using errcode='22023';end if;
  select * into r from public.ai_step_reviews where batch_id=p_batch and step_index=p_step and reviewed_by=p_actor and idempotency_key=(p_request->>'idempotencyKey')::uuid;
  if found then
    if r.decision is distinct from p_request->>'decision' or r.note is distinct from p_request->>'note' then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023';end if;
    return to_jsonb(r);
  end if;
  insert into public.ai_step_reviews(batch_id,step_index,reviewed_by,idempotency_key,decision,note)
    values(p_batch,p_step,p_actor,(p_request->>'idempotencyKey')::uuid,p_request->>'decision',p_request->>'note') returning * into r;
  return to_jsonb(r);
end $$;

revoke all on function public.create_ai_batch(text,uuid,jsonb),public.ai_workspace_budget(uuid),public.reserve_ai_step(text,uuid,uuid,integer,uuid,text),public.refresh_ai_leases(text,uuid),
  public.finish_ai_step(text,uuid,uuid,integer,uuid,jsonb,text),public.review_ai_step(text,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.create_ai_batch(text,uuid,jsonb),public.ai_workspace_budget(uuid),public.reserve_ai_step(text,uuid,uuid,integer,uuid,text),public.refresh_ai_leases(text,uuid),
  public.finish_ai_step(text,uuid,uuid,integer,uuid,jsonb,text),public.review_ai_step(text,uuid,uuid,integer,jsonb) to service_role;
