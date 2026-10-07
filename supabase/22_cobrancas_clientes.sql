-- ============================================================
--  ZAYTAN HUB — Cobranças por cliente + conciliação pelo OFX
--  Rode no SQL Editor DEPOIS do 21. Aditivo e idempotente.
--  - clientes ganha: dia_vencimento, cliente_desde, chave_ofx, ativo.
--  - cobrancas: 1 por cliente por mês (mensalidade no vencimento).
--  - fn_gerar_cobrancas: materializa as cobranças mensais (estilo recorrentes).
--  - fn_conciliar_cobrancas: casa entradas do extrato (nome + valor) e marca pago.
-- ============================================================

-- ─── Campos novos no cliente ────────────────────────────────
alter table public.clientes add column if not exists dia_vencimento integer not null default 5
  check (dia_vencimento between 1 and 28);
alter table public.clientes add column if not exists cliente_desde date;      -- início da cobrança (null = mês de criado_em)
alter table public.clientes add column if not exists chave_ofx text;          -- palavra-chave p/ casar no extrato (null = usa o nome)
alter table public.clientes add column if not exists ativo boolean not null default true;

-- ─── Cobranças mensais ──────────────────────────────────────
create table if not exists public.cobrancas (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id) on delete cascade,
  cliente_id      uuid not null references public.clientes(id) on delete cascade,
  competencia     date not null,                 -- 1º dia do mês (YYYY-MM-01)
  vencimento      date not null,
  valor           numeric(12,2) not null,
  status          text not null default 'aberto' check (status in ('aberto','pago','cancelado')),
  pago_em         date,
  pago_valor      numeric(12,2),
  movimentacao_id uuid references public.movimentacoes(id) on delete set null,  -- entrada do OFX conciliada
  criado_em       timestamptz not null default now(),
  unique (cliente_id, competencia)               -- 1 cobrança por cliente por mês
);
create index if not exists cobrancas_empresa_idx on public.cobrancas(empresa_id);
create index if not exists cobrancas_cliente_idx on public.cobrancas(cliente_id);
create index if not exists cobrancas_status_idx  on public.cobrancas(empresa_id, status);

alter table public.cobrancas enable row level security;
drop policy if exists cobrancas_tenant on public.cobrancas;
create policy cobrancas_tenant on public.cobrancas
  for all to authenticated
  using ( public.tem_acesso_empresa(empresa_id) )
  with check ( public.tem_acesso_empresa(empresa_id) );

-- ─── Gera as cobranças mensais dos clientes ativos ──────────
-- Do mês de início (cliente_desde ou criado_em) até o próximo mês (horizonte),
-- 1 por mês. Idempotente (unique cliente_id, competencia). SECURITY INVOKER.
create or replace function public.fn_gerar_cobrancas(p_empresa uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  with base as (
    select c.id cliente_id, c.mensalidade, c.dia_vencimento,
           date_trunc('month', coalesce(c.cliente_desde, c.criado_em::date, current_date))::date as ini
    from public.clientes c
    where c.empresa_id = p_empresa and c.ativo and c.mensalidade > 0
  ),
  meses as (
    select b.cliente_id, b.mensalidade, b.dia_vencimento, gs::date as competencia
    from base b
    cross join lateral generate_series(
      b.ini,
      (date_trunc('month', current_date) + interval '1 month')::date,
      interval '1 month'
    ) gs
  ),
  ins as (
    insert into public.cobrancas (empresa_id, cliente_id, competencia, vencimento, valor)
    select p_empresa, m.cliente_id, m.competencia,
           (m.competencia + (least(m.dia_vencimento, 28) - 1) * interval '1 day')::date,
           m.mensalidade
    from meses m
    on conflict (cliente_id, competencia) do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return coalesce(v_count, 0);
end $$;

grant execute on function public.fn_gerar_cobrancas(uuid) to authenticated;

-- ─── Concilia cobranças ABERTAS com entradas do extrato ─────
-- Casa por NOME (chave normalizada, "contém") + VALOR (dentro de ~2% ou R$2) +
-- DATA numa janela em torno da competência. Não reusa a mesma entrada em duas
-- cobranças. Marca 'pago' com a data/valor/entrada. SECURITY INVOKER.
create or replace function public.fn_conciliar_cobrancas(p_empresa uuid)
returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_count integer := 0;
  r       record;
  v_mov   record;
begin
  for r in
    select cb.id, cb.competencia, cb.vencimento, cb.valor,
           coalesce(nullif(btrim(cl.chave_ofx), ''), cl.nome) as chave
    from public.cobrancas cb
    join public.clientes cl on cl.id = cb.cliente_id
    where cb.empresa_id = p_empresa and cb.status = 'aberto'
    order by cb.vencimento
  loop
    if r.chave is null or char_length(btrim(r.chave)) < 3 then
      continue;  -- chave curta demais p/ casar com segurança
    end if;

    select m.id, m.data, m.valor
    into v_mov
    from public.movimentacoes m
    where m.empresa_id = p_empresa
      and m.tipo = 'in'
      and m.categoria_status = 'confirmada'
      and public.fn_normaliza_descricao(m.descricao)
            ilike '%' || public.fn_normaliza_descricao(r.chave) || '%'
      and abs(m.valor - r.valor) <= greatest(2, r.valor * 0.02)
      and m.data between (r.competencia - interval '10 days')::date
                     and (r.competencia + interval '2 months')::date
      and not exists (select 1 from public.cobrancas c2 where c2.movimentacao_id = m.id)
    order by abs(m.data - r.vencimento), abs(m.valor - r.valor)
    limit 1;

    if found then
      update public.cobrancas
      set status = 'pago', pago_em = v_mov.data, pago_valor = v_mov.valor, movimentacao_id = v_mov.id
      where id = r.id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

grant execute on function public.fn_conciliar_cobrancas(uuid) to authenticated;

-- Conferência:
--   select public.fn_gerar_cobrancas('<empresa>');
--   select public.fn_conciliar_cobrancas('<empresa>');
--   select cliente_id, competencia, status, valor, pago_em from public.cobrancas order by competencia;
