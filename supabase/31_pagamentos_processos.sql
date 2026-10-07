-- ============================================================
--  ZAYTAN HUB — Pagamentos de processos
--  Rode no SQL Editor DEPOIS do 30. Aditivo e idempotente.
--
--  Cadastro simples de pagamentos de processos (nome, valor, dia de
--  pagamento, parcela e chave Pix), por empresa. Nos moldes de `clientes`,
--  mas sem geração de cobranças — é só um registro/agenda.
--
--  RLS: leitura p/ qualquer membro da empresa; escrita p/ quem tem a
--  capacidade 'contas_gerir' (mesmo padrão de Contas a Pagar — migração 29).
-- ============================================================

create table if not exists public.pagamentos_processos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  nome           text not null,
  valor          numeric(14,2) not null default 0,
  dia_pagamento  int not null default 5 check (dia_pagamento between 1 and 31),
  parcela_atual  int not null default 1 check (parcela_atual >= 1),
  parcelas_total int not null default 1 check (parcelas_total >= 1),
  chave_pix      text,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now()
);
create index if not exists pagamentos_processos_empresa_idx on public.pagamentos_processos(empresa_id);

alter table public.pagamentos_processos enable row level security;

-- Leitura: qualquer membro da empresa.
drop policy if exists pagamentos_processos_select on public.pagamentos_processos;
create policy pagamentos_processos_select on public.pagamentos_processos
  for select to authenticated
  using ( public.tem_acesso_empresa(empresa_id) );

-- Escrita: quem tem 'contas_gerir' (admin/operador; master sempre).
drop policy if exists pagamentos_processos_write on public.pagamentos_processos;
create policy pagamentos_processos_write on public.pagamentos_processos
  for all to authenticated
  using ( public.cargo_tem(empresa_id, 'contas_gerir') )
  with check ( public.cargo_tem(empresa_id, 'contas_gerir') );

-- ─── Conferência ────────────────────────────────────────────
--   select * from public.pagamentos_processos where empresa_id = '<empresa>';
