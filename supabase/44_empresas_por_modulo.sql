-- ============================================================
--  ZAYTAN HUB — Empresas por módulo (Financeiro, RH ou os dois)
--               e acesso ao RH em várias empresas
--
--  Requer 42_rh_modulo.sql. Não apaga dados:
--   1) empresas.modulos: as empresas que já existem ficam nos DOIS módulos
--      (Laportec, Avora e Zaytan já são usadas no Financeiro e no RH);
--      empresas novas nascem só no Financeiro, salvo escolha.
--   2) criar_empresa(p_nome, p_modulos): a estrutura do Financeiro (configuração
--      e conta principal) só é criada quando a empresa tem o Financeiro.
--   3) fn_definir_modulos_empresa: liga/desliga módulos (não tira um módulo
--      que já tem dados).
--   4) fn_empresas_rh: empresas do RH que a pessoa enxerga.
--   5) rh_acessos.empresa (uma) → rh_acessos.empresas (lista; null = todas),
--      com os valores atuais copiados antes.
-- ============================================================

-- ─── 1) Módulos de cada empresa ─────────────────────────────
alter table public.empresas add column if not exists modulos text[];
update public.empresas set modulos = array['financeiro', 'rh'] where modulos is null;
alter table public.empresas alter column modulos set default array['financeiro'];
alter table public.empresas alter column modulos set not null;
alter table public.empresas drop constraint if exists empresas_modulos_validos;
alter table public.empresas add constraint empresas_modulos_validos
  check (cardinality(modulos) >= 1 and modulos <@ array['financeiro', 'rh']);

-- Normaliza a lista pedida (sem repetição, em ordem) e valida.
create or replace function public.fn_normalizar_modulos(p_modulos text[])
returns text[]
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v text[];
begin
  select array_agg(distinct lower(btrim(m)) order by lower(btrim(m)))
    into v
    from unnest(coalesce(p_modulos, '{}'::text[])) as m
   where coalesce(btrim(m), '') <> '';
  if v is null or not (v <@ array['financeiro', 'rh']) then
    raise exception 'Escolha Financeiro, RH ou os dois';
  end if;
  return v;
end $$;

-- Estrutura mínima do Financeiro para uma empresa (idempotente).
create or replace function public.fn_preparar_financeiro(p_empresa uuid)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.configuracoes (empresa_id) values (p_empresa)
    on conflict (empresa_id) do nothing;
  insert into public.contas_bancarias (empresa_id, nome, banco, ordem)
    select p_empresa, 'Conta principal', 'Conta PJ', 0
     where not exists (select 1 from public.contas_bancarias c where c.empresa_id = p_empresa);
$$;
revoke execute on function public.fn_preparar_financeiro(uuid) from public, anon, authenticated;

-- ─── 2) Criar empresa escolhendo os módulos ─────────────────
-- A versão antiga (só p_nome) é substituída; chamadas antigas continuam
-- funcionando pelo valor padrão de p_modulos.
drop function if exists public.criar_empresa(text);
create or replace function public.criar_empresa(p_nome text, p_modulos text[] default array['financeiro'])
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_empresa uuid;
  v_nome    text := btrim(coalesce(p_nome, ''));
  v_modulos text[] := public.fn_normalizar_modulos(p_modulos);
begin
  if not public.is_master() then
    raise exception 'Apenas o master pode criar empresas';
  end if;
  if v_nome = '' then
    raise exception 'Informe o nome da empresa';
  end if;
  -- O RH guarda o nome da empresa em cada registro: nome repetido misturaria dados.
  if exists (select 1 from public.empresas e where lower(btrim(e.nome)) = lower(v_nome)) then
    raise exception 'Já existe uma empresa com o nome %', v_nome;
  end if;

  insert into public.empresas (nome, modulos) values (v_nome, v_modulos) returning id into v_empresa;
  insert into public.empresa_membros (empresa_id, user_id) values (v_empresa, auth.uid())
    on conflict do nothing;
  if 'financeiro' = any(v_modulos) then
    perform public.fn_preparar_financeiro(v_empresa);
  end if;
  return v_empresa;
end $$;

revoke execute on function public.criar_empresa(text, text[]) from public, anon;
grant execute on function public.criar_empresa(text, text[]) to authenticated;

-- ─── 3) Ligar/desligar módulos ──────────────────────────────
create or replace function public.fn_definir_modulos_empresa(p_empresa uuid, p_modulos text[])
returns text[]
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_modulos text[] := public.fn_normalizar_modulos(p_modulos);
  v_atual   public.empresas%rowtype;
begin
  if not public.is_master() then
    raise exception 'Apenas o master pode alterar os módulos de uma empresa';
  end if;
  select * into v_atual from public.empresas where id = p_empresa;
  if not found then
    raise exception 'Empresa não encontrada';
  end if;

  if 'financeiro' = any(v_atual.modulos) and not ('financeiro' = any(v_modulos)) and (
       exists (select 1 from public.movimentacoes where empresa_id = p_empresa)
    or exists (select 1 from public.previstos where empresa_id = p_empresa)
    or exists (select 1 from public.pagamentos_diarios where empresa_id = p_empresa)
    or exists (select 1 from public.clientes where empresa_id = p_empresa)
  ) then
    raise exception 'A empresa % já tem lançamentos no Financeiro; o módulo não pode ser desligado', v_atual.nome;
  end if;

  if 'rh' = any(v_atual.modulos) and not ('rh' = any(v_modulos)) and (
       exists (select 1 from public.rh_funcionarios where lower(btrim(empresa)) = lower(btrim(v_atual.nome)))
    or exists (select 1 from public.rh_candidatos where lower(btrim(empresa)) = lower(btrim(v_atual.nome)))
    or exists (select 1 from public.rh_pagamentos_diarios where lower(btrim(empresa)) = lower(btrim(v_atual.nome)))
  ) then
    raise exception 'A empresa % já tem cadastros no RH; o módulo não pode ser desligado', v_atual.nome;
  end if;

  update public.empresas set modulos = v_modulos where id = p_empresa;
  if 'financeiro' = any(v_modulos) then
    perform public.fn_preparar_financeiro(p_empresa);
  end if;
  return v_modulos;
end $$;

revoke execute on function public.fn_definir_modulos_empresa(uuid, text[]) from public, anon;
grant execute on function public.fn_definir_modulos_empresa(uuid, text[]) to authenticated;

-- ─── 5) Acesso ao RH em várias empresas ─────────────────────
alter table public.rh_acessos add column if not exists empresas text[];
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'rh_acessos' and column_name = 'empresa') then
    execute 'update public.rh_acessos set empresas = array[empresa] where empresa is not null and empresas is null';
  end if;
end $$;
alter table public.rh_acessos drop constraint if exists rh_acessos_empresas_validas;
alter table public.rh_acessos add constraint rh_acessos_empresas_validas
  check (empresas is null or cardinality(empresas) >= 1);

-- Mesma regra de antes, agora com a lista de empresas (null = todas).
create or replace function public.rh_pode(p_tabela text, p_empresa text default null)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_master()
      or exists (
        select 1
        from public.rh_acessos a
        where a.user_id = auth.uid()
          and (a.empresas is null or p_empresa is null
               or exists (select 1 from unnest(a.empresas) x
                          where lower(btrim(x)) = lower(btrim(p_empresa))))
          and (a.perfil is distinct from 'recrutamento'
               or p_tabela in ('candidatos', 'perguntas', 'config'))
      );
$$;

alter table public.rh_acessos drop column if exists empresa;

-- ─── 4) Empresas do RH que a pessoa enxerga ─────────────────
create or replace function public.fn_empresas_rh()
returns table (id uuid, nome text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select e.id, e.nome
    from public.empresas e
   where 'rh' = any(e.modulos)
     and (public.is_master() or exists (
           select 1 from public.rh_acessos a
            where a.user_id = auth.uid()
              and (a.empresas is null
                   or exists (select 1 from unnest(a.empresas) x
                               where lower(btrim(x)) = lower(btrim(e.nome))))))
   order by e.nome;
$$;

revoke execute on function public.fn_empresas_rh() from public, anon;
grant execute on function public.fn_empresas_rh() to authenticated;

-- ─── Conferência ────────────────────────────────────────────
--   select nome, modulos from public.empresas order by nome;
--   select user_id, perfil, empresas from public.rh_acessos;
