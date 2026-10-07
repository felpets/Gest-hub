-- ============================================================
--  ZAYTAN HUB — Aplicar regras sem estourar o tempo do banco
--  Rode no SQL Editor DEPOIS do 59 (precisa do 16 e do 17). Idempotente.
--
--  O problema: "Aplicar regras" (e a sugestão automática da importação)
--  falhava com 57014 — canceling statement due to statement timeout.
--
--  A fn_categorizar_pendentes da migração 17 é um UPDATE correlacionado: para
--  CADA pendência, varre TODAS as regras, e em cada par chama
--  fn_normaliza_descricao (unaccent + três regex) umas seis vezes — no WHERE,
--  no ORDER BY e de novo no EXISTS. A função tem `set search_path`, então o
--  Postgres não a embute nem reaproveita o resultado: 500 pendências × 300
--  regras viram perto de um milhão de normalizações. Com o histórico crescendo,
--  passou do limite de tempo do Supabase.
--
--  A correção mantém a MESMA regra de escolha, só faz cada conta uma vez:
--    1. normaliza a descrição de cada pendência uma vez só;
--    2. prepara as regras da empresa (e as globais) uma vez só, com o padrão
--       do ILIKE já escapado;
--    3. por pendência, calcula "contém" e a similaridade de cada regra uma vez
--       e escolhe pela mesma ordem de antes: regra da empresa vence global,
--       contém-exato vence fuzzy, mais acertos, maior similaridade, mais
--       recente;
--    4. grava só onde achou regra (nunca grava NULL), só em pendente sem
--       sugestão — idempotente como antes.
--
--  O UPDATE lê de CTEs feitas sobre movimentacoes, sem referenciar a tabela
--  alvo dentro de lateral — é isso que dava o 42P10 citado na migração 17.
-- ============================================================

create or replace function public.fn_categorizar_pendentes(p_empresa uuid, p_lote uuid default null)
returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_count integer;
  v_lim   real := public.fn_trgm_threshold();
begin
  with regras as materialized (
    select rc.categoria_id,
           rc.padrao,
           rc.acertos,
           rc.atualizado_em,
           (rc.empresa_id is not null)                                                        as da_empresa,
           '%' || replace(replace(replace(rc.padrao, '\', '\\'), '%', '\%'), '_', '\_') || '%' as padrao_like
      from public.regras_categorizacao rc
     where rc.ativo
       and rc.tipo_match = 'contem'
       and (rc.empresa_id = p_empresa or rc.empresa_id is null)
  ),
  pend as materialized (
    select m.id, public.fn_normaliza_descricao(m.descricao) as norm
      from public.movimentacoes m
     where m.empresa_id = p_empresa
       and m.categoria_status = 'pendente'
       and m.categoria_sugerida_id is null
       and (p_lote is null or m.lote_id = p_lote)
  ),
  melhor as (
    select p.id,
           (select c.categoria_id
              from (select r.categoria_id, r.da_empresa, r.acertos, r.atualizado_em,
                           p.norm ilike r.padrao_like          as contem,
                           word_similarity(r.padrao, p.norm)   as sim
                      from regras r) c
             where c.contem or c.sim >= v_lim
             order by c.da_empresa desc,   -- empresa vence global
                      c.contem desc,       -- contém-exato vence fuzzy
                      c.acertos desc,      -- confiança
                      c.sim desc,          -- maior similaridade
                      c.atualizado_em desc -- mais recente
             limit 1) as categoria_id
      from pend p
     where p.norm <> ''
  )
  update public.movimentacoes m
     set categoria_sugerida_id = b.categoria_id
    from melhor b
   where m.id = b.id
     and b.categoria_id is not null
     and m.categoria_sugerida_id is null;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function public.fn_categorizar_pendentes(uuid, uuid) to authenticated;

-- ─── Conferência ────────────────────────────────────────────
--   explain analyze select public.fn_categorizar_pendentes('<empresa-uuid>', null);
--   -- quantas pendências ainda estão sem sugestão:
--   select count(*) from public.movimentacoes
--    where empresa_id = '<empresa-uuid>' and categoria_status = 'pendente' and categoria_sugerida_id is null;
