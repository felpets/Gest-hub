-- ============================================================
--  ZAYTAN HUB — Auto-categorização (1/3): tabela de regras
--  Rode no SQL Editor DEPOIS do 13. Idempotente.
--  "Aprende" o estabelecimento -> categoria a partir das aprovações
--  do usuário e pré-sugere em importações futuras (sempre como SUGESTÃO,
--  nunca como categoria confirmada — a confirmação é no fluxo de revisão).
-- ============================================================

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ─── Regras de categorização (aprendidas/manuais) ───────────
-- Observação de tenancy: neste projeto a coluna de empresa chama-se
-- `empresa_id` (o enunciado fala "escritorio_id"; aqui é empresa_id).
-- empresa_id NULL = regra GLOBAL (curada pelo master); preenchido = regra
-- específica daquela empresa. O aprendizado automático grava SEMPRE
-- específico-da-empresa, porque `categoria_id` referencia o plano de contas,
-- que é por empresa.
create table if not exists public.regras_categorizacao (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid references public.empresas(id) on delete cascade,      -- NULL = global
  padrao        text not null,                                              -- token normalizado do estabelecimento (ex.: "UBER")
  tipo_match    text not null default 'contem'
                check (tipo_match in ('contem','exato','regex')),           -- começa em "contem"; espaço p/ exato/regex
  categoria_id  uuid not null references public.plano_contas(id) on delete cascade,
  origem        text not null default 'manual'
                check (origem in ('manual','aprendida')),
  acertos       integer not null default 0,                                 -- confiança: nº de confirmações
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Unicidade da regra = idempotência do aprendizado (não duplica regra).
-- NULLS NOT DISTINCT (Postgres 15+) trata empresa_id NULL como um único valor,
-- evitando regras globais duplicadas com mesmo padrão.
create unique index if not exists regras_categorizacao_uq
  on public.regras_categorizacao (empresa_id, padrao, tipo_match) nulls not distinct;

create index if not exists regras_categorizacao_empresa_idx  on public.regras_categorizacao(empresa_id);
create index if not exists regras_categorizacao_categoria_idx on public.regras_categorizacao(categoria_id);

-- ─── atualizado_em automático ───────────────────────────────
create or replace function public.tg_set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists set_atualizado_em on public.regras_categorizacao;
create trigger set_atualizado_em
  before update on public.regras_categorizacao
  for each row execute function public.tg_set_atualizado_em();

-- ─── Coerência de tenant: categoria_id tem que ser da mesma empresa ─────
-- O FK só garante EXISTÊNCIA (checagem de FK ignora RLS). Sem isto, um cliente
-- chamando o PostgREST direto poderia gravar uma regra da própria empresa
-- apontando p/ uma categoria de OUTRA empresa. SECURITY DEFINER pra conseguir
-- ler o plano_contas alvo (a RLS esconderia a linha da outra empresa).
create or replace function public.tg_regra_categoria_mesma_empresa()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_cat_empresa uuid;
begin
  select pc.empresa_id into v_cat_empresa
  from public.plano_contas pc where pc.id = new.categoria_id;
  if v_cat_empresa is null then
    raise exception 'categoria_id % inexistente', new.categoria_id;
  end if;
  -- regra de empresa: categoria tem que ser da MESMA empresa.
  -- regra global (empresa_id null): só master cria (RLS já garante).
  if new.empresa_id is not null and v_cat_empresa <> new.empresa_id then
    raise exception 'categoria_id pertence a outra empresa (cross-tenant)';
  end if;
  return new;
end $$;

drop trigger if exists regra_categoria_mesma_empresa on public.regras_categorizacao;
create trigger regra_categoria_mesma_empresa
  before insert or update on public.regras_categorizacao
  for each row execute function public.tg_regra_categoria_mesma_empresa();

-- ============================================================
--  RLS — globais visíveis a todos; gravação só na própria empresa;
--  master gerencia tudo (inclusive globais).
-- ============================================================
alter table public.regras_categorizacao enable row level security;

-- Leitura: regras globais (empresa_id null) + as da empresa do usuário.
drop policy if exists regras_categorizacao_select on public.regras_categorizacao;
create policy regras_categorizacao_select on public.regras_categorizacao
  for select to authenticated
  using ( empresa_id is null or public.tem_acesso_empresa(empresa_id) );

-- Gravação pelo usuário: SÓ regras da própria empresa (não cria/edita globais).
drop policy if exists regras_categorizacao_write on public.regras_categorizacao;
create policy regras_categorizacao_write on public.regras_categorizacao
  for all to authenticated
  using ( empresa_id is not null and public.tem_acesso_empresa(empresa_id) )
  with check ( empresa_id is not null and public.tem_acesso_empresa(empresa_id) );

-- Master gerencia tudo, inclusive globais (empresa_id null).
drop policy if exists regras_categorizacao_master on public.regras_categorizacao;
create policy regras_categorizacao_master on public.regras_categorizacao
  for all to authenticated
  using ( public.is_master() ) with check ( public.is_master() );
