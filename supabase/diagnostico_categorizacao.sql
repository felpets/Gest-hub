-- ============================================================
--  ZAYTAN HUB — Diagnóstico: por que as sugestões de categoria não aparecem
--  Rode no SQL Editor. NÃO altera nada (o passo 5 só preenche sugestões).
--  Rode bloco a bloco e olhe o resultado de cada um.
-- ============================================================

-- 1) As extensões de que a pré-categorização depende existem?
--    Esperado: unaccent e pg_trgm listadas. Se faltar, rode o 16 e o 17.
select extname, extnamespace::regnamespace as schema
from pg_extension
where extname in ('unaccent', 'pg_trgm');

-- 2) As funções existem, e em qual versão?
--    Esperado: 3 linhas. Se fn_trgm_threshold faltar, o 17 não foi rodado.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('fn_categorizar_pendentes', 'fn_normaliza_descricao', 'fn_trgm_threshold')
order by p.proname;

-- 3) Existem regras cadastradas e ativas?
--    Se vier 0, não é erro: é que não há regra para casar (cadastre em Ajustes
--    ou use "Aprender do histórico" na tela de Revisão).
select empresa_id, count(*) as regras, count(*) filter (where ativo) as ativas
from public.regras_categorizacao
group by empresa_id;

-- 4) O que as regras enxergam de uma descrição pendente (normalização):
select m.descricao, public.fn_normaliza_descricao(m.descricao) as normalizada
from public.movimentacoes m
where m.categoria_status = 'pendente'
order by m.data desc
limit 10;

-- 5) Roda a pré-categorização de verdade, por empresa que tem pendentes.
--    É aqui que o erro real aparece, se houver. Devolve quantas ganharam
--    sugestão. É idempotente: só mexe em pendente que está SEM sugestão.
select e.empresa_id, public.fn_categorizar_pendentes(e.empresa_id, null) as sugeridas
from (
  select distinct empresa_id
  from public.movimentacoes
  where categoria_status = 'pendente'
) e;

-- 6) Sobrou algum pendente sem sugestão?
select count(*) filter (where categoria_sugerida_id is null) as sem_sugestao,
       count(*) as pendentes
from public.movimentacoes
where categoria_status = 'pendente';
