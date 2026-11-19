-- Rekonvia pilot: the browser has no canonical write grants.
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(), name text not null,
  created_at timestamptz not null default now()
);
create table public.memberships (
  workspace_id uuid not null references public.workspaces(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('broker','client')),
  primary key(workspace_id,user_id)
);
create table public.renewal_cases (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$'),
  workspace_id uuid not null references public.workspaces(id),
  state jsonb not null, lock_version bigint not null default 0 check(lock_version >= 0),
  created_at timestamptz not null default now(),
  check ((state->>'id') is not distinct from id and (state->>'lockVersion')::bigint is not distinct from lock_version),
  unique(id,workspace_id)
);
create table public.client_case_assignments (
  case_id text not null, workspace_id uuid not null, user_id uuid not null,
  primary key(case_id,user_id),
  foreign key(case_id,workspace_id) references public.renewal_cases(id,workspace_id),
  foreign key(workspace_id,user_id) references public.memberships(workspace_id,user_id)
);
create index assignments_user on public.client_case_assignments(user_id,case_id);
create index memberships_user on public.memberships(user_id,workspace_id);
create index cases_workspace on public.renewal_cases(workspace_id);

create function app_private.is_broker(p_case text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.renewal_cases c join public.memberships m
    on m.workspace_id=c.workspace_id where c.id=p_case and m.user_id=auth.uid() and m.role='broker');
$$;
create function app_private.is_assigned(p_case text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.client_case_assignments a join public.memberships m
    on m.workspace_id=a.workspace_id and m.user_id=a.user_id
    where a.case_id=p_case and a.user_id=auth.uid() and m.role='client');
$$;
revoke all on function app_private.is_broker(text), app_private.is_assigned(text) from public;
grant execute on function app_private.is_broker(text), app_private.is_assigned(text) to authenticated,service_role;

create table public.document_versions (
  id uuid primary key default gen_random_uuid(), case_id text not null references public.renewal_cases(id),
  source_version_id text not null, display_name text not null check(length(display_name) <= 240),
  object_path text not null unique, mime_type text not null,
  byte_size bigint not null check(byte_size between 1 and 10485760),
  sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),
  upload_status text not null default 'pending' check(upload_status in ('pending','finalized')),
  shared_with_clients boolean not null default false,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '2 hours', finalized_at timestamptz,
  unique(case_id,source_version_id),
  check(upload_status='pending' or (sha256 is not null and finalized_at is not null))
);
create table public.source_segments (
  id uuid primary key default gen_random_uuid(), document_version_id uuid not null references public.document_versions(id),
  locator text not null, excerpt text not null
);
create table public.proposal_snapshots (
  case_id text not null references public.renewal_cases(id), id text not null,
  snapshot jsonb not null, primary key(case_id,id)
);
-- Physically separate allowlisted data: an RLS row policy cannot hide columns.
create table public.published_client_proposals (
  case_id text not null, id text not null, snapshot jsonb not null,
  primary key(case_id,id), foreign key(case_id,id) references public.proposal_snapshots(case_id,id)
);
create table public.insurer_responses (
  case_id text not null references public.renewal_cases(id), id text not null,
  response jsonb not null, primary key(case_id,id)
);
create table public.client_submissions (
  case_id text not null references public.renewal_cases(id), id text not null,
  submitted_by uuid not null references auth.users(id), submission jsonb not null,
  primary key(case_id,id)
);
create table public.export_artifacts (
  id uuid primary key, case_id text not null references public.renewal_cases(id),
  object_path text not null unique, manifest jsonb not null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(), case_id text not null references public.renewal_cases(id),
  actor_id uuid not null references auth.users(id), role text not null, command_type text not null,
  lock_version bigint not null, at timestamptz not null default now(), unique(case_id,lock_version)
);
create table public.command_receipts (
  case_id text not null references public.renewal_cases(id), actor_id uuid not null references auth.users(id),
  idempotency_key uuid not null, request jsonb not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(case_id,actor_id,idempotency_key)
);

create function app_private.immutable_record() returns trigger
language plpgsql set search_path = '' as $$ begin
  raise exception 'Immutable evidence must be replaced by a new version' using errcode='42501';
end $$;
create function app_private.protect_document() returns trigger
language plpgsql set search_path = '' as $$ begin
  if old.upload_status='finalized' and (to_jsonb(new)-'shared_with_clients') is distinct from (to_jsonb(old)-'shared_with_clients') then
    raise exception 'Finalized evidence is immutable' using errcode='42501';
  end if;
  return new;
end $$;
create trigger protect_document_update before update on public.document_versions for each row execute function app_private.protect_document();
create trigger protect_document_delete before delete on public.document_versions for each row execute function app_private.immutable_record();

do $$ declare t text; begin
  foreach t in array array['workspaces','memberships','renewal_cases','client_case_assignments','document_versions','source_segments','proposal_snapshots','published_client_proposals','insurer_responses','client_submissions','export_artifacts','audit_events','command_receipts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  foreach t in array array['source_segments','proposal_snapshots','published_client_proposals','insurer_responses','client_submissions','export_artifacts','audit_events','command_receipts'] loop
    execute format('create trigger immutable before update or delete on public.%I for each row execute function app_private.immutable_record()',t);
  end loop;
end $$;
grant select on public.memberships, public.renewal_cases, public.document_versions, public.source_segments,
  public.proposal_snapshots, public.published_client_proposals, public.insurer_responses,
  public.client_submissions, public.export_artifacts, public.audit_events to authenticated;
create policy own_membership on public.memberships for select to authenticated using(user_id=auth.uid());
create policy broker_cases on public.renewal_cases for select to authenticated using(app_private.is_broker(id));
create policy broker_proposals on public.proposal_snapshots for select to authenticated using(app_private.is_broker(case_id));
create policy published_proposals on public.published_client_proposals for select to authenticated using(app_private.is_broker(case_id) or app_private.is_assigned(case_id));
create policy broker_responses on public.insurer_responses for select to authenticated using(app_private.is_broker(case_id));
create policy own_submissions on public.client_submissions for select to authenticated using(app_private.is_broker(case_id) or (submitted_by=auth.uid() and app_private.is_assigned(case_id)));
create policy private_exports on public.export_artifacts for select to authenticated using(app_private.is_broker(case_id));
create policy private_audit on public.audit_events for select to authenticated using(app_private.is_broker(case_id));
create policy finalized_documents on public.document_versions for select to authenticated using(
  upload_status='finalized' and (app_private.is_broker(case_id) or (shared_with_clients and app_private.is_assigned(case_id))));
create policy private_segments on public.source_segments for select to authenticated using(exists(
  select 1 from public.document_versions d where d.id=document_version_id and app_private.is_broker(d.case_id)));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('renewal-documents','renewal-documents',false,10485760,array[
  'application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp']);
-- No authenticated Storage policies: every signed URL is authorized by the Edge Function.

create function public.commit_case_command(
  p_case_id text, p_actor uuid, p_expected_version bigint, p_idempotency_key uuid,
  p_request jsonb, p_next_state jsonb, p_client_proposal jsonb default null,
  p_artifact jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.renewal_cases; m public.memberships; receipt public.command_receipts;
  item jsonb; previous jsonb; kind text := p_request->>'type'; result jsonb; doc public.document_versions;
begin
  select * into c from public.renewal_cases where id=p_case_id for update;
  if not found then raise exception 'CASE_NOT_FOUND' using errcode='P0002'; end if;
  select * into m from public.memberships where workspace_id=c.workspace_id and user_id=p_actor for share;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if m.role='client' then
    perform 1 from public.client_case_assignments where case_id=p_case_id and user_id=p_actor for share;
    if not found or kind not in ('submitLocations','clientAgree','clientInstruct') or p_artifact is not null or p_client_proposal is not null then
      raise exception 'FORBIDDEN' using errcode='42501';
    end if;
  end if;
  if m.role='broker' and kind in ('submitLocations','clientAgree','clientInstruct') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into receipt from public.command_receipts where case_id=p_case_id and actor_id=p_actor and idempotency_key=p_idempotency_key;
  if found then
    if receipt.request <> p_request then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
    return receipt.result;
  end if;
  if c.lock_version<>p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='P0001'; end if;
  if p_next_state->>'id' is distinct from p_case_id or (p_next_state->>'lockVersion')::bigint is distinct from c.lock_version+1
    or p_next_state#>>'{activity,-1,actor,id}' is distinct from p_actor::text or p_next_state#>>'{activity,-1,actor,role}' is distinct from m.role
    or p_request->>'caseId' is distinct from p_case_id or (p_request->>'expectedVersion')::bigint is distinct from p_expected_version
    or p_request->>'idempotencyKey' is distinct from p_idempotency_key::text then
    raise exception 'INVALID_TRANSITION' using errcode='22023';
  end if;
  -- Previously committed snapshots cannot be edited by a later command.
  foreach kind in array array['proposals','insurerResponses','submissions','agreements','instructions','quoteSnapshots','dfsSnapshots','bindingRequests','bindingAcknowledgments'] loop
    previous:=c.state->kind;
    if jsonb_array_length(p_next_state->kind)<jsonb_array_length(previous) then raise exception 'HISTORY_CHANGED' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(previous) loop
      if not (p_next_state->kind @> jsonb_build_array(item)) then raise exception 'HISTORY_CHANGED' using errcode='22023'; end if;
    end loop;
  end loop;
  kind:=p_request->>'type';
  if kind='attachEvidence' then
    if p_artifact is null or p_artifact->>'kind'<>'upload' then raise exception 'UPLOAD_REQUIRED' using errcode='22023'; end if;
    select * into doc from public.document_versions where id=(p_artifact->>'id')::uuid and case_id=p_case_id for update;
    if not found or doc.upload_status<>'pending' or doc.created_by<>p_actor or doc.expires_at<now()
      or not exists(select 1 from storage.objects o where o.bucket_id='renewal-documents' and o.name=doc.object_path
        and (o.metadata->>'size')::bigint=doc.byte_size and o.metadata->>'mimetype'=doc.mime_type)
      or not exists(select 1 from jsonb_array_elements(p_next_state->'documents') d
        where d->>'id'=doc.source_version_id and d#>>'{file,id}'=doc.id::text
        and d#>>'{file,sha256}'=p_artifact->>'sha256'
        and (d#>>'{file,byteSize}')::bigint=doc.byte_size and d#>>'{file,mimeType}'=doc.mime_type) then
      raise exception 'INVALID_UPLOAD' using errcode='22023';
    end if;
    update public.document_versions set upload_status='finalized',sha256=p_artifact->>'sha256',finalized_at=now() where id=doc.id;
  elsif p_artifact->>'kind'='export' and kind='recordExport' and m.role='broker' then
    if not exists(select 1 from storage.objects where bucket_id='renewal-documents' and name=p_artifact->>'path') then raise exception 'EXPORT_MISSING' using errcode='22023'; end if;
    insert into public.export_artifacts(id,case_id,object_path,manifest,created_by)
      values((p_artifact->>'id')::uuid,p_case_id,p_artifact->>'path',p_artifact->'manifest',p_actor);
  elsif p_artifact is not null or kind='recordExport' then raise exception 'INVALID_ARTIFACT' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_next_state->'proposals') where not(c.state->'proposals' @> jsonb_build_array(value)) loop
    if kind<>'publishProposal' or p_client_proposal is null or item->>'id'<>p_client_proposal->>'id' then raise exception 'SAFE_PROPOSAL_REQUIRED' using errcode='22023'; end if;
    insert into public.proposal_snapshots values(p_case_id,item->>'id',item);
    insert into public.published_client_proposals values(p_case_id,item->>'id',p_client_proposal);
  end loop;
  for item in select value from jsonb_array_elements(p_next_state->'insurerResponses') where not(c.state->'insurerResponses' @> jsonb_build_array(value)) loop
    insert into public.insurer_responses values(p_case_id,item->>'id',item);
  end loop;
  for item in select value from jsonb_array_elements(p_next_state->'submissions') where not(c.state->'submissions' @> jsonb_build_array(value)) loop
    insert into public.client_submissions values(p_case_id,item->>'id',p_actor,item);
  end loop;
  update public.renewal_cases set state=p_next_state,lock_version=c.lock_version+1 where id=p_case_id;
  insert into public.audit_events(case_id,actor_id,role,command_type,lock_version) values(p_case_id,p_actor,m.role,kind,c.lock_version+1);
  result:=jsonb_build_object('state',p_next_state,'artifact',p_artifact);
  insert into public.command_receipts(case_id,actor_id,idempotency_key,request,result) values(p_case_id,p_actor,p_idempotency_key,p_request,result);
  return result;
end $$;
revoke all on function public.commit_case_command(text,uuid,bigint,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_case_command(text,uuid,bigint,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
