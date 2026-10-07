-- ============================================================
--  ZAYTAN HUB — Recorrências sem prazo
--  Rode no SQL Editor (só é necessário se você já rodou o 06_recorrentes.sql
--  na versão antiga, em que `fim` era obrigatório).
-- ============================================================

-- Permite recorrência contínua (sem data de fim). O app mantém uma janela
-- de pagamentos previstos à frente e a estende automaticamente.
alter table public.recorrentes alter column fim drop not null;
