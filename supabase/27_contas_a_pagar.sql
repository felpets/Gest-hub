-- ============================================================
--  ZAYTAN HUB — Contas a Pagar (recorrentes com modo de vencimento + status)
--  Rode no SQL Editor DEPOIS do 26. Aditivo e idempotente.
--
--  "Contas a Pagar" é uma visão de `previstos` do tipo 'out' com status de
--  pagamento, alimentada pelo motor existente recorrentes -> previstos.
--
--  1) recorrentes ganha o MODO de vencimento:
--       'fixo'      -> usa `dia` (1..28), como sempre.
--       'dia_util'  -> usa `dia_util_n` (N-ésimo dia útil; ex.: 5 = salário).
--       'quinzenal' -> usa `dia` (1º venc.) + `dia2` (2º venc.), 2 por mês.
--     Linhas antigas viram 'fixo' automaticamente (default) — nada quebra.
--  2) previstos ganha status de pagamento (pago/pago_em/pago_valor).
--     O status "aberto/pago/atrasado" é DERIVADO (pago + data vs. hoje), não
--     armazenado — sem constraint nova.
--  3) A limpeza de previstos vencidos passa a PRESERVAR as saídas não pagas
--     (viram "atrasadas") e o mês corrente. Antes apagava tudo < hoje.
-- ============================================================

-- ─── 1) recorrentes: modo de vencimento ─────────────────────
alter table public.recorrentes
  add column if not exists modo_dia   text not null default 'fixo'
      check (modo_dia in ('fixo','dia_util','quinzenal')),
  add column if not exists dia_util_n integer
      check (dia_util_n is null or dia_util_n between 1 and 23),
  add column if not exists dia2       integer
      check (dia2 is null or dia2 between 1 and 28);

-- ─── 2) previstos: status de pagamento ──────────────────────
alter table public.previstos
  add column if not exists pago       boolean not null default false,
  add column if not exists pago_em    date,
  add column if not exists pago_valor numeric(12,2);

create index if not exists previstos_out_status_idx
  on public.previstos (empresa_id, tipo, pago, data);

-- ─── 3) Limpeza de vencidos que preserva contas a pagar ─────
-- Apaga: entradas vencidas (como antes) + saídas PAGAS de meses anteriores.
-- Mantém: saídas NÃO pagas (qualquer data -> "atrasada") e TODO o mês corrente
--         (paga ou não, p/ alimentar o KPI "pago no mês").
-- Predicado único, reusado pelo front (fn) e pelo cron global (inline).
create or replace function public.fn_limpar_previstos_vencidos(p_empresa uuid)
returns integer
language sql
security invoker
set search_path = public, pg_temp
as $$
  with del as (
    delete from public.previstos p
    where p.empresa_id = p_empresa
      and p.data < current_date
      and not ( p.tipo = 'out'
                and ( p.pago = false
                      or p.data >= date_trunc('month', current_date)::date ) )
    returning 1
  )
  select coalesce(count(*), 0)::int from del;
$$;

grant execute on function public.fn_limpar_previstos_vencidos(uuid) to authenticated;

-- Reescreve o job diário com o MESMO predicado (mesmo nome => substitui).
-- Roda como owner (sem RLS) -> limpa todas as empresas.
create extension if not exists pg_cron;
select cron.schedule(
  'apagar-previstos-vencidos',
  '0 3 * * *',
  $$
    delete from public.previstos p
    where p.data < current_date
      and not ( p.tipo = 'out'
                and ( p.pago = false
                      or p.data >= date_trunc('month', current_date)::date ) )
  $$
);

-- Conferência:
--   select column_name from information_schema.columns
--     where table_name='recorrentes' and column_name in ('modo_dia','dia_util_n','dia2');
--   select column_name from information_schema.columns
--     where table_name='previstos' and column_name in ('pago','pago_em','pago_valor');
--   select public.fn_limpar_previstos_vencidos('<empresa>');
--   select jobname, schedule, command from cron.job where jobname='apagar-previstos-vencidos';
