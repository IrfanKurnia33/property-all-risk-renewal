-- Brokers manage cases only within their existing workspace. Auth user administration stays outside this API.
create function public.broker_case_setup(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.memberships where user_id=p_actor and role='broker') then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  select jsonb_build_object('workspaces',coalesce(jsonb_agg(jsonb_build_object(
    'workspaceId',w.id,'name',w.name,'clients',(
      select coalesce(jsonb_agg(jsonb_build_object('userId',c.user_id,'email',u.email) order by u.email,c.user_id),'[]'::jsonb)
      from public.memberships c join auth.users u on u.id=c.user_id where c.workspace_id=w.id and c.role='client'
    )) order by w.name,w.id),'[]'::jsonb))
  into result from public.memberships b join public.workspaces w on w.id=b.workspace_id where b.user_id=p_actor and b.role='broker';
  return result;
end;
$$;

create function public.broker_case_assignments(p_case_id text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.renewal_cases;
begin
  select * into c from public.renewal_cases where id=p_case_id;
  if not found then raise exception 'CASE_NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.memberships where workspace_id=c.workspace_id and user_id=p_actor and role='broker';
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  return jsonb_build_object('workspaceId',c.workspace_id,'lockVersion',c.lock_version,'clientUserIds',(
    select coalesce(jsonb_agg(user_id order by user_id),'[]'::jsonb) from public.client_case_assignments where case_id=p_case_id),
    'clients',(select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'email',u.email) order by u.email,m.user_id),'[]'::jsonb)
      from public.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=c.workspace_id and m.role='client'));
end $$;

create function public.create_renewal_case(p_actor uuid,p_request jsonb,p_state jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_case_id text:=p_request->>'caseId'; v_workspace uuid:=(p_request->>'workspaceId')::uuid;
  v_key uuid:=(p_request->>'idempotencyKey')::uuid; v_client uuid; v_clients uuid[]; receipt public.command_receipts; result jsonb;
begin
  -- Serialize equal case IDs even before the row exists, so creation retries are safe under concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended(v_case_id,0));
  perform 1 from public.memberships where workspace_id=v_workspace and user_id=p_actor and role='broker' for share;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into receipt from public.command_receipts where case_id=v_case_id and actor_id=p_actor and idempotency_key=v_key;
  if found then
    if receipt.request is distinct from p_request||jsonb_build_object('type','createCase') then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='P0001';
    end if;
    return receipt.result;
  end if;
  if exists(select 1 from public.renewal_cases where id=v_case_id) then raise exception 'CASE_EXISTS' using errcode='P0001'; end if;
  if v_case_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$' or v_key is null or v_workspace is null
    or jsonb_typeof(p_request->'clientUserIds') is distinct from 'array'
    or jsonb_array_length(p_request->'clientUserIds')>20
    or jsonb_typeof(p_request->'historicalLocations') is distinct from 'array'
    or jsonb_array_length(p_request->'historicalLocations') not between 1 and 100
    or jsonb_array_length(p_state->'locations') is distinct from jsonb_array_length(p_request->'historicalLocations')
    or exists(select 1 from jsonb_array_elements(p_state->'locations') with ordinality as l(item,n)
      where item->'prior' is distinct from p_request->'historicalLocations'->(n::int-1)
        or item->'proposed' is distinct from 'null'::jsonb or item->'confirmation' is distinct from 'null'::jsonb
        or item->>'review' is distinct from 'unreviewed')
    or p_state->>'id' is distinct from v_case_id or p_state->>'clientName' is distinct from p_request->>'clientName'
    or p_state#>>'{terms,periodStart}' is distinct from p_request->>'periodStart'
    or p_state#>>'{terms,periodEnd}' is distinct from p_request->>'periodEnd'
    or p_state->>'fictional' is distinct from 'true' or p_state->>'schemaVersion' is distinct from '2'
    or p_state->>'revision' is distinct from '1' or p_state->>'lockVersion' is distinct from '0'
    or p_state->'documents' is distinct from '[]'::jsonb
    or p_state->'originalClauses' is distinct from '[]'::jsonb
    or exists(select 1 from unnest(array['insurerResponses','quoteSnapshots','proposals','submissions','agreements',
      'instructions','dfsSnapshots','bindingRequests','bindingAcknowledgments']) k where p_state->k is distinct from '[]'::jsonb)
    or exists(select 1 from jsonb_array_elements(p_state->'wordingRevisions') w where w->'items' is distinct from '[]'::jsonb)
    or p_state->'activeProposalId' is distinct from 'null'::jsonb
    or p_state->'checks' is distinct from '{"identity":false,"period":false,"rate":false,"deductible":false,"clauses":false}'::jsonb
    or jsonb_array_length(p_state->'activity') is distinct from 1
    or p_state#>>'{activity,0,actor,id}' is distinct from p_actor::text
    or p_state#>>'{activity,0,actor,role}' is distinct from 'broker' then
    raise exception 'INVALID_CASE' using errcode='22023';
  end if;
  select coalesce(array_agg(value::uuid order by value::uuid),array[]::uuid[]) into v_clients
    from jsonb_array_elements_text(p_request->'clientUserIds');
  if cardinality(v_clients)<>(select count(distinct x) from unnest(v_clients) x) then raise exception 'INVALID_CLIENTS' using errcode='22023'; end if;
  foreach v_client in array v_clients loop
    perform 1 from public.memberships where workspace_id=v_workspace and user_id=v_client and role='client' for share;
    if not found then raise exception 'INVALID_CLIENT_ASSIGNMENT' using errcode='42501'; end if;
  end loop;
  insert into public.renewal_cases(id,workspace_id,state,lock_version) values(v_case_id,v_workspace,p_state,0);
  insert into public.client_case_assignments(case_id,workspace_id,user_id) select v_case_id,v_workspace,x from unnest(v_clients) x;
  insert into public.audit_events(case_id,actor_id,role,command_type,lock_version) values(v_case_id,p_actor,'broker','createCase',0);
  result:=jsonb_build_object('state',p_state,'clientUserIds',to_jsonb(v_clients));
  insert into public.command_receipts(case_id,actor_id,idempotency_key,request,result)
    values(v_case_id,p_actor,v_key,p_request||jsonb_build_object('type','createCase'),result);
  return result;
end $$;

create function public.set_case_assignments(p_case_id text,p_actor uuid,p_expected_version bigint,p_idempotency_key uuid,
  p_client_user_ids uuid[],p_next_state jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.renewal_cases; v_client uuid; v_clients uuid[]; receipt public.command_receipts;
  request jsonb; result jsonb; binding_request jsonb; dfs jsonb;
begin
  select * into c from public.renewal_cases where id=p_case_id for update;
  if not found then raise exception 'CASE_NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.memberships where workspace_id=c.workspace_id and user_id=p_actor and role='broker' for share;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_client_user_ids is null or cardinality(p_client_user_ids)>20
    or array_position(p_client_user_ids,null) is not null
    or cardinality(p_client_user_ids)<>(select count(distinct x) from unnest(p_client_user_ids) x) then
    raise exception 'INVALID_CLIENTS' using errcode='22023';
  end if;
  select coalesce(array_agg(x order by x),array[]::uuid[]) into v_clients from unnest(p_client_user_ids) x;
  request:=jsonb_build_object('caseId',p_case_id,'expectedVersion',p_expected_version,'idempotencyKey',p_idempotency_key,
    'type','setCaseAssignments','payload',jsonb_build_object('clientUserIds',to_jsonb(v_clients)));
  select * into receipt from public.command_receipts where case_id=p_case_id and actor_id=p_actor and idempotency_key=p_idempotency_key;
  if found then
    if receipt.request is distinct from request then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
    return receipt.result;
  end if;
  if c.lock_version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='P0001'; end if;
  -- An access change may not silently detach current confirmations or consent from its contributing client.
  if exists(select 1 from public.client_case_assignments a where a.case_id=p_case_id and not(a.user_id=any(v_clients))
    and exists(select 1 from jsonb_array_elements((c.state->'submissions')||(c.state->'agreements')||(c.state->'instructions')) evidence
      where evidence->>'recordedBy'=a.user_id::text)) then
    raise exception 'CONTRIBUTING_CLIENT_LOCKED' using errcode='22023';
  end if;
  select item into binding_request from jsonb_array_elements(c.state->'bindingRequests') with ordinality as r(item,n)
    where (item->>'revision')::bigint=(c.state->>'revision')::bigint and item->>'proposalId'=c.state->>'activeProposalId'
      and item->>'optionId'=c.state->>'selectedOptionId' order by n desc limit 1;
  if binding_request is not null then
    select item into dfs from jsonb_array_elements(c.state->'dfsSnapshots') item where item->>'id'=binding_request->>'dfsId';
    if exists(select 1 from jsonb_array_elements(dfs#>'{proposal,responses}') member where member->>'position'='accepted')
      and not exists(select 1 from jsonb_array_elements(dfs#>'{proposal,responses}') member where member->>'position'='accepted'
        and not exists(select 1 from jsonb_array_elements(c.state->'bindingAcknowledgments') ack
          where ack->>'requestId'=binding_request->>'id' and ack->>'insurerId'=member->>'insurerId')) then
      raise exception 'BINDING_COMPLETE' using errcode='22023';
    end if;
  end if;
  if (p_next_state-'lockVersion'-'activity') is distinct from (c.state-'lockVersion'-'activity')
    or (p_next_state->>'lockVersion')::bigint is distinct from c.lock_version+1
    or (p_next_state->'activity' - -1) is distinct from c.state->'activity'
    or p_next_state#>>'{activity,-1,actor,id}' is distinct from p_actor::text
    or p_next_state#>>'{activity,-1,actor,role}' is distinct from 'broker'
    or (p_next_state#>>'{activity,-1,lockVersion}')::bigint is distinct from c.lock_version+1 then
    raise exception 'INVALID_TRANSITION' using errcode='22023';
  end if;
  foreach v_client in array v_clients loop
    perform 1 from public.memberships where workspace_id=c.workspace_id and user_id=v_client and role='client' for share;
    if not found then raise exception 'INVALID_CLIENT_ASSIGNMENT' using errcode='42501'; end if;
  end loop;
  delete from public.client_case_assignments where case_id=p_case_id and not(user_id=any(v_clients));
  insert into public.client_case_assignments(case_id,workspace_id,user_id)
    select p_case_id,c.workspace_id,x from unnest(v_clients) x on conflict(case_id,user_id) do nothing;
  update public.renewal_cases set state=p_next_state,lock_version=c.lock_version+1 where id=p_case_id;
  insert into public.audit_events(case_id,actor_id,role,command_type,lock_version)
    values(p_case_id,p_actor,'broker','setCaseAssignments',c.lock_version+1);
  result:=jsonb_build_object('state',p_next_state,'clientUserIds',to_jsonb(v_clients));
  insert into public.command_receipts(case_id,actor_id,idempotency_key,request,result) values(p_case_id,p_actor,p_idempotency_key,request,result);
  return result;
end $$;

revoke all on function public.broker_case_setup(uuid),public.broker_case_assignments(text,uuid),
  public.create_renewal_case(uuid,jsonb,jsonb),public.set_case_assignments(text,uuid,bigint,uuid,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.broker_case_setup(uuid),public.broker_case_assignments(text,uuid),
  public.create_renewal_case(uuid,jsonb,jsonb),public.set_case_assignments(text,uuid,bigint,uuid,uuid[],jsonb) to service_role;
