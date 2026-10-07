-- ============================================================
--  ZAYTAN HUB — Flags de categoria p/ relatórios
--  Rode no SQL Editor DEPOIS do 33. Aditivo e idempotente.
--
--  Duas marcações por categoria do plano de contas:
--    oculto_relatorios       -> lançamentos dela NÃO entram em relatórios
--                               (transferências, aportes… não são despesa de fato).
--    competencia_mes_anterior -> contam no MÊS ANTERIOR à data do pagamento.
--
--  Ambas afetam SÓ as visões de relatório (Relatórios, Dashboard, Orçamento e
--  os KPIs do Fluxo de Caixa). NÃO mexem no SALDO, no extrato nem na projeção —
--  o dinheiro é real e a data de caixa é a data real.
--
--  Sem RLS nova: herda as políticas de plano_contas (edição já exige 'plano_gerir').
-- ============================================================

alter table public.plano_contas
  add column if not exists oculto_relatorios boolean not null default false;

alter table public.plano_contas
  add column if not exists competencia_mes_anterior boolean not null default false;

-- ─── Conferência ────────────────────────────────────────────
--   select nome, oculto_relatorios, competencia_mes_anterior
--   from public.plano_contas where empresa_id = '<empresa>' order by codigo;
