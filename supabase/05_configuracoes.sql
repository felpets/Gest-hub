-- ============================================================
--  ZAYTAN HUB — Configurações financeiras (saldo inicial)
--  Rode no SQL Editor DEPOIS do schema.sql.
-- ============================================================

-- Tabela de uma única linha (id boolean fixo em true garante isso).
create table if not exists public.configuracoes (
  id                  boolean primary key default true check (id),
  saldo_inicial       numeric(14,2) not null default 0,
  saldo_inicial_data  date not null default current_date,
  atualizado_em       timestamptz not null default now()
);

-- ─── RLS (só autenticado) ───────────────────────────────────
alter table public.configuracoes enable row level security;

drop policy if exists "acesso total autenticados" on public.configuracoes;
create policy "acesso total autenticados" on public.configuracoes
  for all to authenticated using (true) with check (true);

-- Garante a linha única.
insert into public.configuracoes (id) values (true) on conflict (id) do nothing;
