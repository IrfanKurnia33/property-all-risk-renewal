-- Historical schedules identify their actual prior period; do not infer it from renewal dates.
create or replace function public.create_renewal_case(p_actor uuid,p_request jsonb,p_state jsonb) returns jsonb
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
    or p_state#>>'{priorTerms,periodStart}' is distinct from p_request->>'priorPeriodStart'
    or p_state#>>'{priorTerms,periodEnd}' is distinct from p_request->>'priorPeriodEnd'
    or p_request->>'priorPeriodStart' is null or p_request->>'priorPeriodEnd' is null
    or p_request->>'priorPeriodStart'>p_request->>'priorPeriodEnd'
    or p_request->>'priorPeriodEnd'>=p_request->>'periodStart'
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

