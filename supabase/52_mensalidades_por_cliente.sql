-- ============================================================
--  ZAYTAN HUB — Mais de uma mensalidade por cliente
--  Rode no SQL Editor DEPOIS do 51. Aditiva e idempotente.
--
--  Como estava: a mensalidade era uma coluna do cliente (clientes.mensalidade
--  + dia_vencimento) e o banco garantia UMA cobrança de mensalidade por
--  cliente e mês. Um cliente com dois serviços (ex.: "Gestão de tráfego" e
--  "Suporte") só cabia somando tudo num valor, sem saber qual dos dois está
--  atrasado.
--
--  O que muda:
--   1) cliente_mensalidades: cada mensalidade com descrição, valor, dia de
--      vencimento e a partir de quando é cobrada.
--   2) A mensalidade que já existe em cada cliente vira a PRIMEIRA linha
--      desta tabela — nada é apagado, e as cobranças antigas passam a
--      apontar para ela (cobrancas.mensalidade_id).
--   3) A trava "uma por mês" passa a valer por MENSALIDADE, não por cliente.
--   4) clientes.mensalidade continua existindo e passa a ser a SOMA das
--      mensalidades ativas (mantida por trigger), para quem ainda lê a coluna.
--   5) fn_gerar_cobrancas gera uma cobrança por mensalidade ativa.
-- ============================================================

begin;

-- ─── 1) A tabela ────────────────────────────────────────────
create table if not exists public.cliente_mensalidades (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  descricao      text not null default 'Mensalidade',
  valor          numeric(12,2) not null check (valor > 0),
  dia_vencimento integer not null default 5 check (dia_vencimento between 1 and 28),
  inicio         date not null default date_trunc('month', current_date)::date, -- 1º mês cobrado
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  criado_por     uuid default auth.uid()
);

create index if not exists cliente_mensalidades_cliente_idx on public.cliente_mensalidades (cliente_id, ativo);
create index if not exists cliente_mensalidades_empresa_idx on public.cliente_mensalidades (empresa_id);

comment on table public.cliente_mensalidades is
  'Mensalidades de cada cliente. clientes.mensalidade é a soma das ativas (trigger).';

-- ─── 2) A cobrança sabe de qual mensalidade veio ────────────
alter table public.cobrancas
  add column if not exists mensalidade_id uuid references public.cliente_mensalidades(id) on delete set null;

create index if not exists cobrancas_mensalidade_idx on public.cobrancas (mensalidade_id);

comment on column public.cobrancas.mensalidade_id is
  'Mensalidade que gerou a cobrança. null com venda_id null = mensalidade anterior à migração 52.';

-- ─── 3) A mensalidade atual de cada cliente vira a 1ª da lista ─
insert into public.cliente_mensalidades (empresa_id, cliente_id, descricao, valor, dia_vencimento, inicio, ativo, criado_em, criado_por)
select c.empresa_id, c.id, 'Mensalidade', c.mensalidade,
       least(greatest(coalesce(c.dia_vencimento, 5), 1), 28),
       date_trunc('month', coalesce(c.cliente_desde, c.criado_em::date, current_date))::date,
       true, coalesce(c.criado_em, now()), null
  from public.clientes c
 where c.mensalidade > 0
   and not exists (select 1 from public.cliente_mensalidades m where m.cliente_id = c.id);

-- As cobranças de mensalidade já geradas apontam para ela.
update public.cobrancas cb
   set mensalidade_id = m.id
  from public.cliente_mensalidades m
 where cb.mensalidade_id is null
   and cb.venda_id is null
   and m.cliente_id = cb.cliente_id
   and m.id = (select m2.id from public.cliente_mensalidades m2
                where m2.cliente_id = cb.cliente_id
                order by m2.criado_em, m2.id limit 1);

-- ─── 4) Unicidade por mensalidade ───────────────────────────
-- A nova trava nasce ANTES de a antiga sair, para nunca ficar sem nenhuma.
create unique index if not exists cobrancas_por_mensalidade_unica
  on public.cobrancas (mensalidade_id, competencia)
  where mensalidade_id is not null;

-- A antiga (cliente, mês) impediria a 2ª mensalidade no mesmo mês. Ela
-- continua valendo só para as linhas antigas que ficaram sem mensalidade.
drop index if exists public.cobrancas_mensalidade_unica;
create unique index if not exists cobrancas_mensalidade_legado_unica
  on public.cobrancas (cliente_id, competencia)
  where venda_id is null and mensalidade_id is null;

-- ─── 5) clientes.mensalidade = soma das ativas ──────────────
create or replace function public.fn_sincronizar_mensalidade_cliente()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_cliente uuid := coalesce(new.cliente_id, old.cliente_id);
begin
  update public.clientes c
     set mensalidade = coalesce((select sum(m.valor) from public.cliente_mensalidades m
                                  where m.cliente_id = v_cliente and m.ativo), 0),
         dia_vencimento = coalesce((select m.dia_vencimento from public.cliente_mensalidades m
                                     where m.cliente_id = v_cliente and m.ativo
                                     order by m.criado_em, m.id limit 1), c.dia_vencimento)
   where c.id = v_cliente;
  return null;
end $$;

drop trigger if exists trg_mensalidade_cliente on public.cliente_mensalidades;
create trigger trg_mensalidade_cliente
  after insert or update or delete on public.cliente_mensalidades
  for each row execute function public.fn_sincronizar_mensalidade_cliente();

-- ─── 6) fn_gerar_cobrancas: uma por mensalidade ativa ───────
create or replace function public.fn_gerar_cobrancas(p_empresa uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  with base as (
    select m.id mensalidade_id, m.cliente_id, m.valor, m.dia_vencimento, m.descricao,
           greatest(
             date_trunc('month', m.inicio)::date,
             date_trunc('month', coalesce(c.cliente_desde, c.criado_em::date, current_date))::date
           ) as ini
      from public.cliente_mensalidades m
      join public.clientes c on c.id = m.cliente_id
     where m.empresa_id = p_empresa and m.ativo and c.ativo
  ),
  meses as (
    select b.*, gs::date as competencia
      from base b
     cross join lateral generate_series(
       b.ini,
       (date_trunc('month', current_date) + interval '1 month')::date,
       interval '1 month'
     ) gs
  ),
  ins as (
    insert into public.cobrancas (empresa_id, cliente_id, mensalidade_id, competencia, vencimento, valor, descricao)
    select p_empresa, m.cliente_id, m.mensalidade_id, m.competencia,
           public.fn_dia_util_anterior(
             p_empresa,
             (m.competencia + (least(m.dia_vencimento, 28) - 1) * interval '1 day')::date
           ),
           m.valor,
           m.descricao
      from meses m
    on conflict (mensalidade_id, competencia) where mensalidade_id is not null do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return coalesce(v_count, 0);
end $$;

-- ─── 7) RLS: igual ao cadastro de clientes ──────────────────
alter table public.cliente_mensalidades enable row level security;
revoke all on public.cliente_mensalidades from anon;
grant select, insert, update, delete on public.cliente_mensalidades to authenticated;

drop policy if exists cliente_mensalidades_select on public.cliente_mensalidades;
create policy cliente_mensalidades_select on public.cliente_mensalidades
  for select to authenticated
  using ( public.tem_acesso_empresa(empresa_id) );

drop policy if exists cliente_mensalidades_write on public.cliente_mensalidades;
create policy cliente_mensalidades_write on public.cliente_mensalidades
  for all to authenticated
  using ( public.cargo_tem(empresa_id, 'clientes_gerir') )
  with check ( public.cargo_tem(empresa_id, 'clientes_gerir') );

commit;

-- ─── Conferência ────────────────────────────────────────────
--   -- todo cliente com mensalidade tem a sua linha, e a soma bate:
--   select c.nome, c.mensalidade, sum(m.valor) filter (where m.ativo) soma
--     from public.clientes c left join public.cliente_mensalidades m on m.cliente_id = c.id
--    group by c.id having c.mensalidade <> coalesce(sum(m.valor) filter (where m.ativo), 0);   -- 0 linhas
--   -- nenhuma cobrança de mensalidade ficou sem dono:
--   select count(*) from public.cobrancas where venda_id is null and mensalidade_id is null;  -- 0
