-- ============================================================
--  ZAYTAN HUB — Apaga pagamentos previstos vencidos (job diário)
--  Rode no SQL Editor DEPOIS do 20. Idempotente.
--  Regra: 1 dia após a data do previsto ele é removido, ou seja, todo dia
--  apaga os previstos com data ANTERIOR a hoje (data < current_date).
--  Roda 03:00 UTC (= 00:00 no horário de Brasília) via pg_cron.
--  Observação: o job roda como owner (sem RLS), então limpa TODAS as empresas.
-- ============================================================

create extension if not exists pg_cron;

-- cron.schedule com o mesmo nome substitui o agendamento (idempotente).
select cron.schedule(
  'apagar-previstos-vencidos',
  '0 3 * * *',
  $$ delete from public.previstos where data < current_date $$
);

-- Conferência:
--   select jobid, jobname, schedule, command, active from cron.job
--     where jobname = 'apagar-previstos-vencidos';
--   -- histórico de execuções:
--   select * from cron.job_run_details order by start_time desc limit 5;
