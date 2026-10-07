-- 57 — Recorrências: vencimento em qualquer dia do mês (1–31)
--
-- Até aqui `dia` e `dia2` paravam no 28 (migração 27), para que a data
-- existisse em fevereiro. Na prática isso empurrava boleto do dia 30 para o 28
-- em silêncio. Agora o limite é 31 e quem resolve o mês curto é o código
-- (isoDiaDoMes, em src/lib/datas.ts): o dia que não existe naquele mês cai no
-- ÚLTIMO dia dele — 31 em fevereiro = 28/29, em abril = 30. É também assim que
-- a opção "Último dia do mês" do formulário é gravada: modo fixo, dia 31.
--
-- Aditiva e idempotente: só troca o CHECK, não mexe em dado nenhum (todo
-- registro existente está em 1..28 e continua válido).

alter table public.recorrentes drop constraint if exists recorrentes_dia_check;
alter table public.recorrentes
  add constraint recorrentes_dia_check check (dia between 1 and 31);

alter table public.recorrentes drop constraint if exists recorrentes_dia2_check;
alter table public.recorrentes
  add constraint recorrentes_dia2_check check (dia2 is null or dia2 between 1 and 31);

-- Conferir:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.recorrentes'::regclass and conname like '%dia%';
