  -- ============================================================
  --  ZAYTAN HUB — Controle de vendas
  --  Rode no SQL Editor DEPOIS do 37. Aditivo e idempotente.
  --
  --  Registro de vendas por empresa: data, cliente, vendedor, forma de
  --  pagamento, valor bruto e valor líquido. É um controle À PARTE — NÃO
  --  gera movimentação nem mexe no saldo das contas bancárias (o dinheiro
  --  entra no caixa pelo extrato, como sempre).
  --
  --  Capacidade nova: 'vendas_gerir' (aparece na tela de Cargos). Admin e
  --  operador já ganham; dá para criar um cargo "Vendedor" só com ela.
  -- ============================================================

  -- ─── 1) Tabela ──────────────────────────────────────────────
  create table if not exists public.vendas (
    id              uuid primary key default gen_random_uuid(),
    empresa_id      uuid not null references public.empresas(id) on delete cascade,
    data            date not null default current_date,
    cliente         text not null,
    vendedor        text not null default '',
    forma_pagamento text not null default 'pix',
    valor_bruto     numeric(14,2) not null default 0 check (valor_bruto >= 0),
    valor_liquido   numeric(14,2) not null default 0 check (valor_liquido >= 0),
    observacao      text,
    criado_em       timestamptz not null default now()
  );
  create index if not exists vendas_empresa_data_idx on public.vendas(empresa_id, data desc);

  -- ─── 2) Capacidade 'vendas_gerir' nos cargos padrão ─────────
  insert into public.cargo_capacidades (cargo_chave, capacidade)
  values ('admin', 'vendas_gerir'), ('operador', 'vendas_gerir')
  on conflict do nothing;

  -- ─── 3) RLS ─────────────────────────────────────────────────
  alter table public.vendas enable row level security;

  -- Leitura: qualquer membro da empresa.
  drop policy if exists vendas_select on public.vendas;
  create policy vendas_select on public.vendas
    for select to authenticated
    using ( public.tem_acesso_empresa(empresa_id) );

  -- Escrita: quem tem 'vendas_gerir' (master sempre).
  drop policy if exists vendas_write on public.vendas;
  create policy vendas_write on public.vendas
    for all to authenticated
    using ( public.cargo_tem(empresa_id, 'vendas_gerir') )
    with check ( public.cargo_tem(empresa_id, 'vendas_gerir') );

  -- ─── 4) Exclusão de empresa (migração 36) leva as vendas junto ─
  -- A FK já é ON DELETE CASCADE; nada a fazer na fn_excluir_empresa.

  -- ─── Conferência ────────────────────────────────────────────
  --   select * from public.vendas where empresa_id = '<empresa>' order by data desc;
  --   select * from public.cargo_capacidades where capacidade = 'vendas_gerir';
