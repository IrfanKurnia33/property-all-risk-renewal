create table public.workspace_capabilities (
  workspace_id uuid not null,
  user_id uuid not null,
  is_superadmin boolean not null default false,
  can_manage_standard_terms boolean not null default false,
  updated_by uuid references auth.users(id),
  provisioned_by_owner boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(workspace_id,user_id),
  foreign key(workspace_id,user_id) references public.memberships(workspace_id,user_id),
  check(is_superadmin or can_manage_standard_terms)
);

create table public.workspace_admin_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  actor_id uuid references auth.users(id),
  subject_id uuid not null references auth.users(id),
  before_state jsonb not null,
  after_state jsonb not null,
  provisioned_by_owner boolean not null default false,
  at timestamptz not null default now()
);

create table public.workspace_standard_terms_versions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  version integer not null check(version > 0),
  display_name text not null check(length(display_name) between 1 and 240),
  object_path text not null unique,
  mime_type text not null check(mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  byte_size bigint not null check(byte_size between 1 and 10485760),
  sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),
  upload_status text not null default 'pending' check(upload_status in ('pending','finalized')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '2 hours',
  finalized_at timestamptz,
  unique(workspace_id,version),
  check(upload_status='pending' or (sha256 is not null and finalized_at is not null))
);

create function app_private.protect_workspace_terms() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.upload_status='finalized' then
    raise exception 'Finalized workspace Standard T&C versions are immutable' using errcode='42501';
  end if;
  return new;
end $$;
create trigger protect_workspace_terms_update before update on public.workspace_standard_terms_versions
  for each row execute function app_private.protect_workspace_terms();
create trigger protect_workspace_terms_delete before delete on public.workspace_standard_terms_versions
  for each row execute function app_private.immutable_record();
create trigger immutable_workspace_admin_events before update or delete on public.workspace_admin_events
  for each row execute function app_private.immutable_record();

alter table public.workspace_capabilities enable row level security;
alter table public.workspace_admin_events enable row level security;
alter table public.workspace_standard_terms_versions enable row level security;
revoke all on public.workspace_capabilities,public.workspace_admin_events,public.workspace_standard_terms_versions from anon,authenticated;
grant all on public.workspace_capabilities,public.workspace_admin_events,public.workspace_standard_terms_versions to service_role;

create function public.broker_workspace_settings(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.memberships where user_id=p_actor and role='broker') then
    raise exception 'BROKER_REQUIRED' using errcode='42501';
  end if;
  select jsonb_build_object('workspaces',coalesce(jsonb_agg(jsonb_build_object(
    'workspaceId',w.id,'name',w.name,'isSuperadmin',coalesce(c.is_superadmin,false),
    'canManageStandardTerms',coalesce(c.is_superadmin,false) or coalesce(c.can_manage_standard_terms,false),
    'members',case when coalesce(c.is_superadmin,false) then (
      select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'email',u.email,'role',m.role,
        'superadmin',coalesce(mc.is_superadmin,false),'canManageStandardTerms',coalesce(mc.is_superadmin,false) or coalesce(mc.can_manage_standard_terms,false))
        order by u.email,m.user_id),'[]'::jsonb)
      from public.memberships m join auth.users u on u.id=m.user_id
      left join public.workspace_capabilities mc on mc.workspace_id=m.workspace_id and mc.user_id=m.user_id
      where m.workspace_id=w.id
    ) else '[]'::jsonb end,
    'standardTerms',(
      select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'displayName',v.display_name,
        'mimeType',v.mime_type,'byteSize',v.byte_size,'sha256',v.sha256,'createdAt',v.finalized_at,'createdBy',v.created_by)
        order by v.version desc),'[]'::jsonb)
      from public.workspace_standard_terms_versions v where v.workspace_id=w.id and v.upload_status='finalized'
    )) order by w.name,w.id),'[]'::jsonb))
  into result
  from public.memberships m join public.workspaces w on w.id=m.workspace_id
  left join public.workspace_capabilities c on c.workspace_id=m.workspace_id and c.user_id=m.user_id
  where m.user_id=p_actor and m.role='broker';
  return result;
end $$;

create function public.reserve_workspace_standard_terms(p_workspace uuid,p_actor uuid,p_id uuid,p_name text,p_mime text,p_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_version integer; v_path text; v_expires timestamptz;
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not found then raise exception 'WORKSPACE_NOT_FOUND' using errcode='P0002'; end if;
  if not exists(select 1 from public.memberships m left join public.workspace_capabilities c
    on c.workspace_id=m.workspace_id and c.user_id=m.user_id
    where m.workspace_id=p_workspace and m.user_id=p_actor and m.role='broker'
      and (coalesce(c.is_superadmin,false) or coalesce(c.can_manage_standard_terms,false))) then
    raise exception 'STANDARD_TERMS_PERMISSION_REQUIRED' using errcode='42501';
  end if;
  if p_id is null or p_name is null or length(p_name) not between 1 and 240
    or position('/' in p_name)>0 or position(chr(92) in p_name)>0 or p_name ~ '[[:cntrl:]]'
    or p_mime is null or p_mime not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    or p_size is null or p_size not between 1 and 10485760
    or (p_mime='application/pdf' and lower(p_name) not like '%.pdf')
    or (p_mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document' and lower(p_name) not like '%.docx') then
    raise exception 'INVALID_STANDARD_TERMS_UPLOAD' using errcode='22023';
  end if;
  v_version:=coalesce((select max(version) from public.workspace_standard_terms_versions where workspace_id=p_workspace),0)+1;
  v_path:=p_workspace::text||'/standard-terms/'||p_id::text;
  insert into public.workspace_standard_terms_versions(id,workspace_id,version,display_name,object_path,mime_type,byte_size,created_by)
    values(p_id,p_workspace,v_version,p_name,v_path,p_mime,p_size,p_actor)
    returning expires_at into v_expires;
  return jsonb_build_object('id',p_id,'path',v_path,'version',v_version,'expiresAt',v_expires);
end $$;

create function public.finalize_workspace_standard_terms(p_workspace uuid,p_actor uuid,p_id uuid,p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.workspace_standard_terms_versions;
begin
  select * into v from public.workspace_standard_terms_versions where id=p_id and workspace_id=p_workspace for update;
  if not found then raise exception 'WORKSPACE_TERMS_NOT_FOUND' using errcode='P0002'; end if;
  if not exists(select 1 from public.memberships m left join public.workspace_capabilities c
    on c.workspace_id=m.workspace_id and c.user_id=m.user_id
    where m.workspace_id=p_workspace and m.user_id=p_actor and m.role='broker'
      and (coalesce(c.is_superadmin,false) or coalesce(c.can_manage_standard_terms,false))) then
    raise exception 'STANDARD_TERMS_PERMISSION_REQUIRED' using errcode='42501';
  end if;
  if v.upload_status='finalized' then
    if v.sha256=p_sha256 then
      return jsonb_build_object('id',v.id,'version',v.version,'sha256',v.sha256,'status',v.upload_status);
    end if;
    raise exception 'WORKSPACE_TERMS_FINALIZED' using errcode='22023';
  end if;
  if v.created_by<>p_actor or v.expires_at<now() then raise exception 'WORKSPACE_TERMS_UPLOAD_EXPIRED' using errcode='22023'; end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or not exists(select 1 from storage.objects o
    where o.bucket_id='renewal-documents' and o.name=v.object_path
      and (o.metadata->>'size')::bigint=v.byte_size and o.metadata->>'mimetype'=v.mime_type) then
    raise exception 'WORKSPACE_TERMS_UPLOAD_INCOMPLETE' using errcode='22023';
  end if;
  update public.workspace_standard_terms_versions set upload_status='finalized',sha256=p_sha256,finalized_at=now() where id=p_id;
  return jsonb_build_object('id',v.id,'version',v.version,'sha256',p_sha256,'status','finalized');
end $$;

create function public.set_workspace_memberships(p_workspace uuid,p_actor uuid,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item jsonb; v_user uuid; v_role text; v_superadmin boolean; v_terms boolean;
  prior public.memberships; prior_cap public.workspace_capabilities; before_value jsonb; after_value jsonb; v_admin_count integer;
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not found then raise exception 'WORKSPACE_NOT_FOUND' using errcode='P0002'; end if;
  if not exists(select 1 from public.memberships m join public.workspace_capabilities c
    on c.workspace_id=m.workspace_id and c.user_id=m.user_id
    where m.workspace_id=p_workspace and m.user_id=p_actor and m.role='broker' and c.is_superadmin) then
    raise exception 'WORKSPACE_SUPERADMIN_REQUIRED' using errcode='42501';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then raise exception 'INVALID_WORKSPACE_MEMBERS' using errcode='22023'; end if;
  if jsonb_array_length(p_changes)>100 then raise exception 'INVALID_WORKSPACE_MEMBERS' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_changes) as x(value)
    where jsonb_typeof(x.value) is distinct from 'object' or not (x.value ?& array['userId','role','superadmin','canManageStandardTerms'])
      or (select count(*) from jsonb_object_keys(x.value))<>4)
    or (select count(*) from jsonb_array_elements(p_changes))<>
       (select count(distinct lower(x.value->>'userId')) from jsonb_array_elements(p_changes) x) then
    raise exception 'INVALID_WORKSPACE_MEMBERS' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_changes) loop
    if item->>'userId' is null or item->>'userId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or item->>'role' not in ('broker','client')
      or jsonb_typeof(item->'superadmin') is distinct from 'boolean'
      or jsonb_typeof(item->'canManageStandardTerms') is distinct from 'boolean'
      or ((item->>'role')='client' and ((item->>'superadmin')::boolean or (item->>'canManageStandardTerms')::boolean)) then
      raise exception 'INVALID_WORKSPACE_MEMBERS' using errcode='22023';
    end if;
    v_user:=(item->>'userId')::uuid; v_role:=item->>'role';
    v_superadmin:=(item->>'superadmin')::boolean; v_terms:=(item->>'canManageStandardTerms')::boolean;
    if v_user=p_actor then raise exception 'SELF_PERMISSION_CHANGE' using errcode='22023'; end if;
    select * into prior from public.memberships where workspace_id=p_workspace and user_id=v_user for update;
    if not found then raise exception 'WORKSPACE_MEMBER_NOT_FOUND' using errcode='22023'; end if;
    select * into prior_cap from public.workspace_capabilities where workspace_id=p_workspace and user_id=v_user;
    if prior.role is distinct from v_role and (
      exists(select 1 from public.client_case_assignments where workspace_id=p_workspace and user_id=v_user)
      or exists(select 1 from public.audit_events a join public.renewal_cases r on r.id=a.case_id
        where r.workspace_id=p_workspace and a.actor_id=v_user)) then
      raise exception 'MEMBERSHIP_HAS_CASE_HISTORY' using errcode='22023';
    end if;
  end loop;
  with proposed as (
    select m.user_id,
      coalesce((select x.value->>'role' from jsonb_array_elements(p_changes) x where lower(x.value->>'userId')=m.user_id::text),m.role) as role,
      coalesce((select (x.value->>'superadmin')::boolean from jsonb_array_elements(p_changes) x where lower(x.value->>'userId')=m.user_id::text),coalesce(c.is_superadmin,false)) as superadmin
    from public.memberships m left join public.workspace_capabilities c
      on c.workspace_id=m.workspace_id and c.user_id=m.user_id
    where m.workspace_id=p_workspace
  ) select count(*) into v_admin_count from proposed where role='broker' and superadmin;
  if v_admin_count=0 then raise exception 'LAST_WORKSPACE_SUPERADMIN' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_changes) loop
    v_user:=(item->>'userId')::uuid; v_role:=item->>'role';
    v_superadmin:=(item->>'superadmin')::boolean; v_terms:=(item->>'canManageStandardTerms')::boolean;
    select * into prior from public.memberships where workspace_id=p_workspace and user_id=v_user;
    select * into prior_cap from public.workspace_capabilities where workspace_id=p_workspace and user_id=v_user;
    before_value:=jsonb_build_object('role',prior.role,'superadmin',coalesce(prior_cap.is_superadmin,false),
      'canManageStandardTerms',coalesce(prior_cap.can_manage_standard_terms,false));
    after_value:=jsonb_build_object('role',v_role,'superadmin',v_superadmin,'canManageStandardTerms',v_terms);
    if before_value is distinct from after_value then
      update public.memberships set role=v_role where workspace_id=p_workspace and user_id=v_user;
      if v_role='broker' and (v_superadmin or v_terms) then
        insert into public.workspace_capabilities(workspace_id,user_id,is_superadmin,can_manage_standard_terms,updated_by)
          values(p_workspace,v_user,v_superadmin,v_terms,p_actor)
          on conflict(workspace_id,user_id) do update set is_superadmin=excluded.is_superadmin,
            can_manage_standard_terms=excluded.can_manage_standard_terms,updated_by=excluded.updated_by,
            provisioned_by_owner=false,updated_at=now();
      else
        delete from public.workspace_capabilities where workspace_id=p_workspace and user_id=v_user;
      end if;
      insert into public.workspace_admin_events(workspace_id,actor_id,subject_id,before_state,after_state)
        values(p_workspace,p_actor,v_user,before_value,after_value);
    end if;
  end loop;
  return jsonb_build_object('updated',jsonb_array_length(p_changes));
end $$;

create function public.owner_provision_workspace_superadmin(p_workspace uuid,p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.memberships; c public.workspace_capabilities; before_value jsonb;
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not found then raise exception 'WORKSPACE_NOT_FOUND' using errcode='P0002'; end if;
  select * into m from public.memberships where workspace_id=p_workspace and user_id=p_user for update;
  if not found or m.role<>'broker' then raise exception 'WORKSPACE_MEMBER_NOT_FOUND' using errcode='22023'; end if;
  select * into c from public.workspace_capabilities where workspace_id=p_workspace and user_id=p_user;
  before_value:=jsonb_build_object('role',m.role,'superadmin',coalesce(c.is_superadmin,false),
    'canManageStandardTerms',coalesce(c.can_manage_standard_terms,false));
  if coalesce(c.is_superadmin,false) and coalesce(c.can_manage_standard_terms,false) then
    return jsonb_build_object('changed',false);
  end if;
  insert into public.workspace_capabilities(workspace_id,user_id,is_superadmin,can_manage_standard_terms,updated_by,provisioned_by_owner)
    values(p_workspace,p_user,true,true,null,true)
    on conflict(workspace_id,user_id) do update set is_superadmin=true,can_manage_standard_terms=true,
      updated_by=null,provisioned_by_owner=true,updated_at=now();
  insert into public.workspace_admin_events(workspace_id,actor_id,subject_id,before_state,after_state,provisioned_by_owner)
    values(p_workspace,null,p_user,before_value,
      jsonb_build_object('role','broker','superadmin',true,'canManageStandardTerms',true),true);
  return jsonb_build_object('changed',true);
end $$;

revoke all on function public.broker_workspace_settings(uuid),
  public.reserve_workspace_standard_terms(uuid,uuid,uuid,text,text,bigint),
  public.finalize_workspace_standard_terms(uuid,uuid,uuid,text),public.set_workspace_memberships(uuid,uuid,jsonb),
  public.owner_provision_workspace_superadmin(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.broker_workspace_settings(uuid),
  public.reserve_workspace_standard_terms(uuid,uuid,uuid,text,text,bigint),
  public.finalize_workspace_standard_terms(uuid,uuid,uuid,text),public.set_workspace_memberships(uuid,uuid,jsonb),
  public.owner_provision_workspace_superadmin(uuid,uuid)
  to service_role;
