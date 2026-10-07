-- ============================================================
--  ZAYTAN HUB — Categorias que se compensam (aporte × investimento)
--  Rode no SQL Editor DEPOIS do 55. Aditiva e idempotente.
--
--  O caso real da Zaytan: o dinheiro entra como "Receitas / Aportes" e sai
--  como "Investimento em Meta Ads / Aportes". Contar os dois cheios infla os
--  dois lados — o que interessa é a DIFERENÇA: sobrou aporte (entrou mais do
--  que foi para o anúncio) ou o anúncio passou do que entrou.
--
--  Marcando as categorias envolvidas, o Dashboard da Gestão soma tudo o que
--  elas movimentaram no período e mostra só o líquido: em "receita recebida"
--  quando sobra, em "já saiu" quando falta. Os lançamentos continuam inteiros
--  no detalhamento e no extrato — nada é apagado nem escondido do caixa.
--
--  É por empresa (o plano de contas é de cada uma), então vale só onde for
--  marcado.
-- ============================================================

alter table public.plano_contas
  add column if not exists compensar boolean not null default false;

comment on column public.plano_contas.compensar is
  'Entradas e saídas desta categoria entram compensadas (só o líquido) no Dashboard da Gestão.';
