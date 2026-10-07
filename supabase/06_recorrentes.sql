-- ============================================================
--  ZAYTAN HUB — Pagamentos recorrentes
--  Rode no SQL Editor DEPOIS do schema.sql.
--  Uma recorrência (regra mensal) gera vários `previstos` (um por mês).
--  Excluir a recorrência remove os previstos gerados (ON DELETE CASCADE).
-- ============================================================

create table if not exists public.recorrentes (
  id         uuid primary key default gen_random_uuid(),
  descricao  text not null,
  categoria  text,
  valor      numeric(12,2) not null,
  tipo       text not null check (tipo in ('in','out')),
  dia        integer not null default 1 check (dia between 1 and 28),
  inicio     date not null,
  fim        date,  -- nulo = sem prazo (recorrência contínua, estendida automaticamente)
  criado_em  timestamptz not null default now()
);

-- Liga cada previsto gerado à sua recorrência (nulo = previsto avulso).
alter table public.previstos
  add column if not exists recorrente_id uuid references public.recorrentes(id) on delete cascade;

create index if not exists previstos_recorrente_idx on public.previstos(recorrente_id);

-- ─── RLS (só autenticado) ───────────────────────────────────
alter table public.recorrentes enable row level security;

drop policy if exists "acesso total autenticados" on public.recorrentes;
create policy "acesso total autenticados" on public.recorrentes
  for all to authenticated using (true) with check (true);
