-- ============================================================
--  ZAYTAN HUB — Ajuste para DIA ÚTIL (antecipar vencimentos)
--  Rode no SQL Editor DEPOIS do 25. Aditivo e idempotente.
--  Quando um vencimento cai em sábado/domingo/feriado, o sistema
--  antecipa para o DIA ÚTIL ANTERIOR — sem nunca mudar o mês
--  (convenção "Modified Preceding": se andar para trás cruzaria o
--  mês, anda para frente até o próximo dia útil).
--
--  Fonte única dos feriados (o banco):
--   - Nacionais: calculados aqui (fixos + móveis via Páscoa).
--   - Da empresa: tabela nova `feriados` (municipais/estaduais).
--   - fn_feriados_efetivos expõe o conjunto p/ o frontend buscar de uma vez.
--
--  Vale para os dois mecanismos de recorrência:
--   - previstos (recorrentes)  -> ajustado no frontend (usa fn_feriados_efetivos)
--   - cobrancas (mensalidades)  -> ajustado aqui em fn_gerar_cobrancas
--  E reajusta os registros futuros já gravados (backfill no fim).
-- ============================================================

-- ─── Feriados cadastrados pela empresa ──────────────────────
create table if not exists public.feriados (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data       date not null,
  nome       text,
  criado_em  timestamptz not null default now(),
  unique (empresa_id, data)
);
create index if not exists feriados_empresa_idx on public.feriados(empresa_id);

alter table public.feriados enable row level security;
drop policy if exists feriados_tenant on public.feriados;
create policy feriados_tenant on public.feriados
  for all to authenticated
  using ( public.tem_acesso_empresa(empresa_id) )
  with check ( public.tem_acesso_empresa(empresa_id) );

-- ─── Domingo de Páscoa (algoritmo de Meeus/Butcher, Gregoriano) ─
create or replace function public.fn_pascoa(ano int)
returns date
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  a int; b int; c int; d int; e int; f int; g int; h int;
  i int; k int; l int; m int; mes int; dia int;
begin
  a := ano % 19;
  b := ano / 100;
  c := ano % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  mes := (h + l - 7 * m + 114) / 31;
  dia := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(ano, mes, dia);
end $$;

-- ─── Feriados nacionais (calendário bancário) de um ano ─────
-- Fixos + móveis baseados na Páscoa (Carnaval seg/ter, Sexta-feira
-- Santa, Corpus Christi). Ajuste a lista aqui se precisar.
create or replace function public.fn_feriados_nacionais(ano int)
returns setof date
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  pascoa date := public.fn_pascoa(ano);
begin
  return query
  select d from (values
    (make_date(ano, 1, 1)),    -- Confraternização Universal (Ano-Novo)
    (make_date(ano, 4, 21)),   -- Tiradentes
    (make_date(ano, 5, 1)),    -- Dia do Trabalho
    (make_date(ano, 9, 7)),    -- Independência
    (make_date(ano, 10, 12)),  -- N. Sra. Aparecida
    (make_date(ano, 11, 2)),   -- Finados
    (make_date(ano, 11, 15)),  -- Proclamação da República
    (make_date(ano, 11, 20)),  -- Consciência Negra (nacional desde 2024)
    (make_date(ano, 12, 25)),  -- Natal
    (pascoa - 48),             -- Carnaval (segunda)
    (pascoa - 47),             -- Carnaval (terça)
    (pascoa - 2),              -- Sexta-feira Santa
    (pascoa + 60)              -- Corpus Christi
  ) as t(d);
end $$;

-- ─── É dia útil? (não é fim de semana, nem feriado) ─────────
create or replace function public.fn_dia_util(p_empresa uuid, d date)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  -- extract(dow): 0 = domingo, 6 = sábado
  if extract(dow from d) in (0, 6) then
    return false;
  end if;
  if d in (select public.fn_feriados_nacionais(extract(year from d)::int)) then
    return false;
  end if;
  if exists (select 1 from public.feriados f where f.empresa_id = p_empresa and f.data = d) then
    return false;
  end if;
  return true;
end $$;

-- ─── Dia útil anterior (Modified Preceding: não muda o mês) ─
create or replace function public.fn_dia_util_anterior(p_empresa uuid, d date)
returns date
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  cand date := d;
begin
  -- Para trás, dia a dia, sem sair do mês de `d`.
  while not public.fn_dia_util(p_empresa, cand) loop
    cand := cand - 1;
    if extract(month from cand) <> extract(month from d) then
      -- Cruzaria o mês anterior: desiste e anda para frente a partir de `d`.
      cand := d;
      while not public.fn_dia_util(p_empresa, cand) loop
        cand := cand + 1;
      end loop;
      return cand;
    end if;
  end loop;
  return cand;
end $$;

-- ─── Conjunto efetivo de feriados p/ o frontend (1 chamada) ─
-- Nacionais (de cada ano do intervalo) ∪ feriados da empresa.
-- Retorna date[] -> o supabase-js entrega como string[] "YYYY-MM-DD".
create or replace function public.fn_feriados_efetivos(p_empresa uuid, p_de date, p_ate date)
returns date[]
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct d order by d), '{}'::date[])
  from (
    select n as d
    from generate_series(extract(year from p_de)::int, extract(year from p_ate)::int) y
    cross join lateral public.fn_feriados_nacionais(y) n
    where n between p_de and p_ate
    union
    select f.data
    from public.feriados f
    where f.empresa_id = p_empresa and f.data between p_de and p_ate
  ) s;
$$;

-- ─── Cobranças (Mecanismo B): antecipa o vencimento p/ dia útil ─
-- Igual ao 22, mas o vencimento passa por fn_dia_util_anterior.
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
           public.fn_dia_util_anterior(
             p_empresa,
             (m.competencia + (least(m.dia_vencimento, 28) - 1) * interval '1 day')::date
           ),
           m.mensalidade
    from meses m
    on conflict (cliente_id, competencia) do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return coalesce(v_count, 0);
end $$;

-- ─── Reajuste sob demanda (após mudar a lista de feriados) ──
-- Reaplica o dia útil aos previstos/cobranças FUTUROS já gravados
-- da empresa. Idempotente (só toca no que muda). Retorna a contagem.
create or replace function public.fn_ajustar_dia_util(p_empresa uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_p integer := 0; v_c integer := 0;
begin
  with upd as (
    update public.previstos
    set data = public.fn_dia_util_anterior(empresa_id, data)
    where empresa_id = p_empresa
      and data >= current_date
      and data <> public.fn_dia_util_anterior(empresa_id, data)
    returning 1
  ) select count(*) into v_p from upd;

  with upd as (
    update public.cobrancas
    set vencimento = public.fn_dia_util_anterior(empresa_id, vencimento)
    where empresa_id = p_empresa
      and status = 'aberto'
      and vencimento >= current_date
      and vencimento <> public.fn_dia_util_anterior(empresa_id, vencimento)
    returning 1
  ) select count(*) into v_c from upd;

  return coalesce(v_p, 0) + coalesce(v_c, 0);
end $$;

-- ─── Grants ─────────────────────────────────────────────────
grant execute on function public.fn_pascoa(int)                        to authenticated;
grant execute on function public.fn_feriados_nacionais(int)            to authenticated;
grant execute on function public.fn_dia_util(uuid, date)               to authenticated;
grant execute on function public.fn_dia_util_anterior(uuid, date)      to authenticated;
grant execute on function public.fn_feriados_efetivos(uuid, date, date) to authenticated;
grant execute on function public.fn_ajustar_dia_util(uuid)             to authenticated;

-- ─── Backfill único: reajusta o que já existe (todas as empresas) ─
-- Owner bypassa RLS; cada linha usa seu próprio empresa_id.
update public.previstos p
set data = public.fn_dia_util_anterior(p.empresa_id, p.data)
where p.data >= current_date
  and p.data <> public.fn_dia_util_anterior(p.empresa_id, p.data);

update public.cobrancas c
set vencimento = public.fn_dia_util_anterior(c.empresa_id, c.vencimento)
where c.status = 'aberto'
  and c.vencimento >= current_date
  and c.vencimento <> public.fn_dia_util_anterior(c.empresa_id, c.vencimento);

-- Conferência:
--   select public.fn_pascoa(2026);                                  -- 2026-04-05
--   select public.fn_dia_util_anterior('<empresa>', '2026-08-01');  -- sáb -> seg 2026-08-03 (não cruza mês)
--   select public.fn_dia_util_anterior('<empresa>', '2026-01-01');  -- Ano-Novo (dia 1) -> 2026-01-02
--   select public.fn_feriados_efetivos('<empresa>', '2026-01-01', '2026-12-31');
--   select count(*) from public.previstos where data < current_date; -- limpeza roda pelo cron
