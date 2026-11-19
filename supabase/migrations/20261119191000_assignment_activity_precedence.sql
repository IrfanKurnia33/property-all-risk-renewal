-- Parenthesize JSON extraction before subtracting the final audit event.
create or replace function public.set_case_assignments(p_case_id text,p_actor uuid,p_expected_version bigint,p_idempotency_key uuid,
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
    or ((p_next_state->'activity') - -1) is distinct from c.state->'activity'
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

