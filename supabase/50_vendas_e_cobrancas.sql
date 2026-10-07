-- ============================================================
--  ZAYTAN HUB — Cliente → Venda → Cobrança → Financeiro
--  Rode no SQL Editor DEPOIS do 49. Aditiva e idempotente.
--
--  O que existia: `clientes` com a mensalidade, `cobrancas` geradas todo mês a
--  partir dela (uma por cliente/competência) e `vendas` como um registro solto,
--  com o nome do cliente digitado à mão e sem parcelas.
--
--  O que falta para amarrar a corrente: a venda apontar para o cliente do
--  cadastro, e a cobrança saber de que venda e de que parcela ela veio. Com
--  isso, uma venda avulsa gera as próprias cobranças, que já entram como
--  entrada PROJETADA (as telas leem `cobrancas`), e viram realizada quando
--  alguém registra o recebimento. Nada é digitado duas vezes.
--
--  A trava que precisou mudar: `cobrancas` tinha UNIQUE (cliente_id,
--  competencia) — um cliente, uma cobrança por mês. Isso existe para a
--  MENSALIDADE não duplicar quando fn_gerar_cobrancas roda de novo, mas
--  impediria as parcelas de uma venda de conviver com a mensalidade do mesmo
--  mês. Virou índice único PARCIAL, valendo só onde venda_id is null.
-- ============================================================

-- ─── 1) A venda aponta para o cliente do cadastro ───────────
alter table public.vendas
  add column if not exists cliente_id uuid references public.clientes(id) on delete restrict,
  add column if not exists descricao  text,
  add column if not exists criado_por uuid default auth.uid();

comment on column public.vendas.cliente_id is
  'Cliente do cadastro. As vendas antigas ficam só com o texto em `cliente`.';
comment on column public.vendas.descricao is
  'O que foi vendido ("Desenvolvimento de site"). A mensalidade continua vindo de clientes.mensalidade.';

create index if not exists vendas_cliente_idx on public.vendas (cliente_id);

-- ─── 2) A cobrança sabe de onde veio ────────────────────────
alter table public.cobrancas
  add column if not exists venda_id        uuid references public.vendas(id) on delete cascade,
  add column if not exists parcela         integer,
  add column if not exists parcelas_total  integer,
  add column if not exists forma_pagamento text,
  add column if not exists descricao       text,
  add column if not exists criado_por      uuid default auth.uid();

alter table public.cobrancas drop constraint if exists cobrancas_parcela_chk;
alter table public.cobrancas
  add constraint cobrancas_parcela_chk
  check (parcela is null or (parcela >= 1 and parcelas_total >= parcela));

comment on column public.cobrancas.venda_id is
  'null = mensalidade do cliente (gerada por fn_gerar_cobrancas). Preenchido = parcela de uma venda.';
comment on column public.cobrancas.forma_pagamento is
  'pix | boleto | transferencia | dinheiro | credito | debito | outro. Como a pessoa combina de pagar.';

create index if not exists cobrancas_venda_idx on public.cobrancas (venda_id);

-- ─── 3) A unicidade mensal passa a valer só para a mensalidade ─
-- Sem isto, a 2ª parcela de uma venda no mesmo mês da mensalidade seria
-- recusada pelo banco.
alter table public.cobrancas drop constraint if exists cobrancas_cliente_id_competencia_key;
drop index if exists public.cobrancas_mensalidade_unica;
create unique index cobrancas_mensalidade_unica
  on public.cobrancas (cliente_id, competencia)
  where venda_id is null;

-- ─── 4) fn_gerar_cobrancas: mesmo predicado do índice parcial ─
-- Só a MENSALIDADE é gerada automaticamente; as parcelas de venda nascem na
-- tela e não são tocadas aqui.
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
    insert into public.cobrancas (empresa_id, cliente_id, competencia, vencimento, valor, descricao)
    select p_empresa, m.cliente_id, m.competencia,
           public.fn_dia_util_anterior(
             p_empresa,
             (m.competencia + (least(m.dia_vencimento, 28) - 1) * interval '1 day')::date
           ),
           m.mensalidade,
           'Mensalidade'
    from meses m
    on conflict (cliente_id, competencia) where venda_id is null do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return coalesce(v_count, 0);
end $$;

-- ─── 5) Gerar as cobranças de uma venda, em uma transação ───
-- Recebe as parcelas prontas (valor + vencimento de cada uma), confere a soma
-- contra o valor da venda e grava tudo junto: ou nasce a venda inteira com as
-- parcelas, ou não nasce nada.
create or replace function public.fn_cobrancas_da_venda(p_venda uuid, p_parcelas jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_empresa uuid;
  v_cliente uuid;
  v_total   numeric;
  v_soma    numeric;
  v_forma   text;
  v_desc    text;
  v_n       int;
begin
  select v.empresa_id, v.cliente_id, v.valor_bruto, v.forma_pagamento,
         coalesce(nullif(btrim(v.descricao), ''), 'Venda')
    into v_empresa, v_cliente, v_total, v_forma, v_desc
    from public.vendas v where v.id = p_venda;

  if v_empresa is null then raise exception 'Venda não encontrada.'; end if;
  if v_cliente is null then raise exception 'A venda precisa de um cliente do cadastro para gerar cobranças.'; end if;
  if not public.cargo_tem(v_empresa, 'clientes_gerir') then
    raise exception 'Sem permissão para gerar cobranças nesta empresa' using errcode = '42501';
  end if;

  select count(*), coalesce(sum((x->>'valor')::numeric), 0)
    into v_n, v_soma
    from jsonb_array_elements(coalesce(p_parcelas, '[]'::jsonb)) x;

  if v_n = 0 then raise exception 'Informe ao menos uma parcela.'; end if;
  -- Tolerância de um centavo por parcela: rateio de 10.000/3 fecha em 9.999,99.
  if abs(v_soma - v_total) > (v_n * 0.01) then
    raise exception 'A soma das parcelas (%) não bate com o valor da venda (%).',
      to_char(v_soma, 'FM999G999G990D00'), to_char(v_total, 'FM999G999G990D00');
  end if;

  -- Regerar: apaga as parcelas ainda EM ABERTO e mantém as já pagas.
  delete from public.cobrancas where venda_id = p_venda and status = 'aberto';

  insert into public.cobrancas (
    empresa_id, cliente_id, venda_id, competencia, vencimento, valor,
    parcela, parcelas_total, forma_pagamento, descricao
  )
  select v_empresa, v_cliente, p_venda,
         date_trunc('month', (x->>'vencimento')::date)::date,
         (x->>'vencimento')::date,
         (x->>'valor')::numeric,
         (ord)::int, v_n, v_forma,
         v_desc || ' · parcela ' || ord || '/' || v_n
    from jsonb_array_elements(p_parcelas) with ordinality as t(x, ord);

  return v_n;
end $$;

revoke execute on function public.fn_cobrancas_da_venda(uuid, jsonb) from public, anon;
grant  execute on function public.fn_cobrancas_da_venda(uuid, jsonb) to authenticated;

-- ─── 6) Categoria marcada como investimento em anúncios ─────
-- Cada empresa chama de um jeito (a Zaytan tem "Investimento em Meta Ads", a
-- Laportec usa "Leads"), então a marca fica na categoria — como já acontece
-- com "fora dos relatórios" — em vez de depender do nome.
alter table public.plano_contas
  add column if not exists investimento_anuncios boolean not null default false;

comment on column public.plano_contas.investimento_anuncios is
  'Marca a categoria como investimento em anúncios (Meta Ads e afins) para o Dashboard somar à parte.';

-- ─── Conferência ────────────────────────────────────────────
--   select id, cliente_id, venda_id, parcela, parcelas_total, valor, vencimento, status
--     from public.cobrancas where venda_id is not null order by vencimento;
--   select nome, investimento_anuncios from public.plano_contas where investimento_anuncios;

-- ─── 7) Quem cadastrou: e-mail dos membros da própria empresa ─
-- `listar_membros` é só do master. Para a tela mostrar "cadastrado por" em
-- cobranças e vendas, basta saber o e-mail de quem já é colega de empresa.
create or replace function public.fn_membros_da_empresa(p_empresa uuid)
returns table (user_id uuid, email text, nome text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.user_id, u.email::text, p.nome
    from public.empresa_membros m
    join auth.users u on u.id = m.user_id
    left join public.perfis p on p.user_id = m.user_id
   where m.empresa_id = p_empresa
     and public.tem_acesso_empresa(p_empresa)
     and u.deleted_at is null
   order by u.email;
$$;

revoke execute on function public.fn_membros_da_empresa(uuid) from public, anon;
grant  execute on function public.fn_membros_da_empresa(uuid) to authenticated;
