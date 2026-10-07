-- ============================================================
--  ZAYTAN HUB — Competência flexível por categoria
--  Rode no SQL Editor DEPOIS do 34 (idempotente; funciona mesmo que a 34
--  não tenha sido rodada — reassegura oculto_relatorios).
--
--  Generaliza o antigo booleano competencia_mes_anterior num MODO:
--    pagamento      -> mês da data do pagamento (padrão)
--    anterior       -> sempre o mês anterior
--    seguinte       -> sempre o mês seguinte
--    corte_seguinte -> a partir do dia de corte, joga para o mês SEGUINTE
--    corte_anterior -> até o dia de corte, joga para o mês ANTERIOR
--  `competencia_dia_corte` (1..28) só vale nos modos de corte.
--
--  Afeta SÓ as visões de relatório (Relatórios, Dashboard, Orçamento, KPIs do
--  Fluxo de Caixa). NÃO mexe no SALDO, no extrato nem na projeção.
-- ============================================================

-- Reassegura a coluna de ocultar (dona: migração 34) — idempotente.
alter table public.plano_contas
  add column if not exists oculto_relatorios boolean not null default false;

-- Modo de competência + dia de corte.
alter table public.plano_contas
  add column if not exists competencia_modo text not null default 'pagamento'
    check (competencia_modo in ('pagamento','anterior','seguinte','corte_seguinte','corte_anterior'));

alter table public.plano_contas
  add column if not exists competencia_dia_corte smallint
    check (competencia_dia_corte between 1 and 28);

-- Migra o booleano legado da 34, se existir, e remove.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'plano_contas'
      and column_name = 'competencia_mes_anterior'
  ) then
    update public.plano_contas
      set competencia_modo = 'anterior'
      where competencia_mes_anterior = true and competencia_modo = 'pagamento';
    alter table public.plano_contas drop column competencia_mes_anterior;
  end if;
end $$;

-- ─── Conferência ────────────────────────────────────────────
--   select nome, oculto_relatorios, competencia_modo, competencia_dia_corte
--   from public.plano_contas where empresa_id = '<empresa>' order by codigo;
