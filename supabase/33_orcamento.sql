-- ============================================================
--  ZAYTAN HUB — Orçamento / Metas por categoria
--  Rode no SQL Editor DEPOIS do 32. Aditivo e idempotente.
--
--  Meta mensal por categoria do plano de contas:
--    competencia NULL        -> meta mensal PADRÃO (recorrente, vale todo mês)
--    competencia 'YYYY-MM-01' -> OVERRIDE de um mês específico
--  Resolução na leitura (no cliente): override do mês  ??  padrão recorrente.
--
--  RLS: leitura p/ qualquer membro; escrita p/ quem tem 'plano_gerir'
--  (a meta é acoplada às categorias do plano de contas). Padrão da migração 29.
-- ============================================================

create table if not exists public.orcamentos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id)     on delete cascade,
  plano_conta_id uuid not null references public.plano_contas(id) on delete cascade,
  competencia    date,                                    -- NULL = padrão; senão dia-1 do mês
  valor_meta     numeric(14,2) not null check (valor_meta >= 0),
  criado_em      timestamptz not null default now(),
  constraint orcamentos_competencia_dia1_chk
    check (competencia is null or competencia = date_trunc('month', competencia)::date)
);

-- No máx. 1 meta PADRÃO por categoria (competencia null) …
create unique index if not exists orcamentos_padrao_uidx
  on public.orcamentos (empresa_id, plano_conta_id)
  where competencia is null;

-- … e no máx. 1 OVERRIDE por categoria + mês.
create unique index if not exists orcamentos_mes_uidx
  on public.orcamentos (empresa_id, plano_conta_id, competencia)
  where competencia is not null;

create index if not exists orcamentos_empresa_idx on public.orcamentos(empresa_id);
create index if not exists orcamentos_conta_idx   on public.orcamentos(plano_conta_id);

alter table public.orcamentos enable row level security;

-- Leitura: qualquer membro da empresa.
drop policy if exists orcamentos_select on public.orcamentos;
create policy orcamentos_select on public.orcamentos
  for select to authenticated
  using ( public.tem_acesso_empresa(empresa_id) );

-- Escrita: quem tem 'plano_gerir' (admin; master sempre).
drop policy if exists orcamentos_write on public.orcamentos;
create policy orcamentos_write on public.orcamentos
  for all to authenticated
  using ( public.cargo_tem(empresa_id, 'plano_gerir') )
  with check ( public.cargo_tem(empresa_id, 'plano_gerir') );

-- ─── Conferência ────────────────────────────────────────────
--   select * from public.orcamentos where empresa_id = '<empresa>';
--   select public.cargo_tem('<empresa>', 'plano_gerir');
