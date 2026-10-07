-- ============================================================
--  ZAYTAN HUB — Multiempresa (6/6): RPCs de administração (só master)
--  Rode DEPOIS do 12. Permitem ao master criar empresas e vincular logins
--  por email SEM expor a tabela auth.users ao cliente. Idempotente.
-- ============================================================

-- Cria uma empresa, já adiciona o master como membro e cria a config dela.
create or replace function public.criar_empresa(p_nome text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_empresa uuid;
begin
  if not public.is_master() then
    raise exception 'Apenas o master pode criar empresas';
  end if;
  insert into public.empresas (nome) values (p_nome) returning id into v_empresa;
  insert into public.empresa_membros (empresa_id, user_id) values (v_empresa, auth.uid())
    on conflict do nothing;
  insert into public.configuracoes (empresa_id) values (v_empresa)
    on conflict (empresa_id) do nothing;  -- seed da config da empresa
  return v_empresa;
end $$;

-- Vincula um login existente (por email) a uma empresa.
create or replace function public.vincular_membro_por_email(p_empresa uuid, p_email text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid;
begin
  if not public.is_master() then
    raise exception 'Apenas o master pode vincular membros';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(p_email) limit 1;
  if v_uid is null then
    raise exception 'Usuario % nao existe. Crie em Authentication > Users primeiro.', p_email;
  end if;
  insert into public.perfis (user_id) values (v_uid) on conflict (user_id) do nothing;
  insert into public.empresa_membros (empresa_id, user_id) values (p_empresa, v_uid)
    on conflict do nothing;
  return v_uid;
end $$;

-- Lista os membros de uma empresa com o email (lê auth.users via definer).
create or replace function public.listar_membros(p_empresa uuid)
returns table (user_id uuid, email text, is_master boolean)
language sql security definer
set search_path = public, pg_temp
as $$
  select m.user_id, u.email::text, coalesce(p.is_master, false)
  from public.empresa_membros m
  join auth.users u on u.id = m.user_id
  left join public.perfis p on p.user_id = m.user_id
  where m.empresa_id = p_empresa
    and public.is_master()      -- só master enxerga a lista
  order by u.email;
$$;

grant execute on function public.criar_empresa(text) to authenticated;
grant execute on function public.vincular_membro_por_email(uuid, text) to authenticated;
grant execute on function public.listar_membros(uuid) to authenticated;
