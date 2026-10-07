-- ============================================================
--  ZAYTAN HUB — Multiempresa (3/6): backfill dos dados existentes
--  Rode DEPOIS do 09. Idempotente (pode rodar mais de uma vez).
--  - Cria a empresa "Zaytan" (se não existir)
--  - Marca felipeselectprev@gmail.com como MASTER + membro dela
--  - Atribui essa empresa a TODAS as linhas que ainda estão sem empresa
--  Pré-requisito: o login felipeselectprev@gmail.com já deve existir em
--  Authentication > Users. Se não existir, o script avisa — crie e rode de novo.
-- ============================================================

do $$
declare
  v_empresa uuid;
  v_master  uuid;
begin
  -- Empresa default
  select id into v_empresa from public.empresas where nome = 'Zaytan' limit 1;
  if v_empresa is null then
    insert into public.empresas (nome) values ('Zaytan') returning id into v_empresa;
  end if;

  -- Master (descobre o user_id pelo email no auth.users)
  select id into v_master from auth.users where lower(email) = lower('felipeselectprev@gmail.com') limit 1;
  if v_master is null then
    raise exception 'Usuario felipeselectprev@gmail.com nao encontrado em auth.users. Crie em Authentication > Users e rode este script de novo.';
  end if;

  insert into public.perfis (user_id, is_master) values (v_master, true)
    on conflict (user_id) do update set is_master = true;
  insert into public.empresa_membros (empresa_id, user_id) values (v_empresa, v_master)
    on conflict (empresa_id, user_id) do nothing;

  -- Backfill de todas as tabelas (só onde ainda está nulo)
  update public.clientes           set empresa_id = v_empresa where empresa_id is null;
  update public.movimentacoes      set empresa_id = v_empresa where empresa_id is null;
  update public.previstos          set empresa_id = v_empresa where empresa_id is null;
  update public.regras             set empresa_id = v_empresa where empresa_id is null;
  update public.plano_contas       set empresa_id = v_empresa where empresa_id is null;
  update public.recorrentes        set empresa_id = v_empresa where empresa_id is null;
  update public.planejamento_meses set empresa_id = v_empresa where empresa_id is null;
  update public.planejamento_itens set empresa_id = v_empresa where empresa_id is null;
  update public.configuracoes      set empresa_id = v_empresa where empresa_id is null;

  raise notice 'Backfill OK. empresa Zaytan=% master=%', v_empresa, v_master;
end $$;

-- Conferência (deve retornar 0 em todas as linhas):
-- select 'clientes' t, count(*) from public.clientes where empresa_id is null
-- union all select 'movimentacoes', count(*) from public.movimentacoes where empresa_id is null
-- union all select 'previstos', count(*) from public.previstos where empresa_id is null
-- union all select 'regras', count(*) from public.regras where empresa_id is null
-- union all select 'plano_contas', count(*) from public.plano_contas where empresa_id is null
-- union all select 'recorrentes', count(*) from public.recorrentes where empresa_id is null
-- union all select 'planejamento_meses', count(*) from public.planejamento_meses where empresa_id is null
-- union all select 'planejamento_itens', count(*) from public.planejamento_itens where empresa_id is null
-- union all select 'configuracoes', count(*) from public.configuracoes where empresa_id is null;
