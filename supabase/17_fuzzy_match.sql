-- ============================================================
--  ZAYTAN HUB — Auto-categorização (4/5): normalização melhor + match fuzzy
--  Rode no SQL Editor DEPOIS do 16. Idempotente (create or replace).
--  - Tira mais ruído genérico da descrição (PAGO/PAGAMENTOS/SISPAG...),
--    revelando o estabelecimento real (ex.: "BOLETO PAGO AMIL" -> chave AMIL).
--  - Casa por "contém" OU por SIMILARIDADE (pg_trgm), priorizando recall.
--  Continua approval-gated: só preenche categoria_sugerida_id.
-- ============================================================

-- pg_trgm: NÃO forçamos schema (neste projeto as extensões ficam em `public`,
-- como o unaccent). word_similarity/gin_trgm_ops resolvem pelo search_path.
create extension if not exists pg_trgm;

-- Índice trigram (nice-to-have; o filtro forte vem do WHERE em movimentacoes).
create index if not exists regras_categorizacao_padrao_trgm
  on public.regras_categorizacao using gin (padrao gin_trgm_ops);

-- ─── Normalização (agora removendo mais ruído transacional) ──
-- Acrescenta PAGO/PAGOS/PAGAMENTOS/SISPAG/ENVIADA/RECEBIDA aos ruídos.
-- Ex.: "BOLETO PAGO AMIL ASSISTENCIA" -> "AMIL ASSISTENCIA" (chave AMIL);
--      "SISPAG SALARIOS" -> "SALARIOS".
create or replace function public.fn_normaliza_descricao(p_texto text)
returns text
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          upper(unaccent(coalesce(p_texto, ''))),
          '\y(PAG|PAGTO|PAGAMENTO|PAGAMENTOS|PAGO|PAGOS|PIX|TED|DOC|SISPAG|COMPRA|DEBITO|CREDITO|TRANSF|TRANSFERENCIA|SAQUE|TARIFA|CARTAO|CARD|BOLETO|RECEBIMENTO|RECEBIDO|RECEBIDA|ENVIADO|ENVIADA)\y',
          ' ', 'g'
        ),
        '[0-9*#/.,:;@_\-\\()\[\]]+',
        ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

-- ─── Limiar de similaridade, tunável num lugar só ───────────
-- Função (NÃO o GUC de sessão pg_trgm.word_similarity_threshold, que é
-- instável atrás do pooler; set_limit() está deprecado). 0.5 = recall alto.
-- Suba p/ 0.6 se vier ruído; desça p/ 0.45 se quiser ainda mais sugestões.
create or replace function public.fn_trgm_threshold()
returns real
language sql
immutable
parallel safe
as $$ select 0.5::real $$;

grant execute on function public.fn_trgm_threshold() to authenticated;

-- ─── Pré-categorização: contém-exato OU similaridade trigram ──
-- word_similarity(padrao, norm) = "quanto do token aparece dentro da
-- descrição" (função certa p/ token curto em string maior), comparada
-- explicitamente com fn_trgm_threshold() (não depende de estado de sessão).
-- Forma correlacionada (subselect no SET + EXISTS guard com o MESMO predicado):
-- o UPDATE...FROM LATERAL não consegue referenciar a tabela-alvo `m` de dentro
-- de laterais aninhadas (erro 42P10), então usamos esta forma — a mesma que já
-- funcionava na 16. fn_normaliza_descricao é STABLE (avaliada 1x por linha).
-- Idempotente: só toca pendente sem sugestão; nunca grava NULL (EXISTS guard).
create or replace function public.fn_categorizar_pendentes(p_empresa uuid, p_lote uuid default null)
returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare v_count integer;
begin
  update public.movimentacoes m
  set categoria_sugerida_id = (
    select rc.categoria_id
    from public.regras_categorizacao rc
    where rc.ativo
      and rc.tipo_match = 'contem'
      and (rc.empresa_id = m.empresa_id or rc.empresa_id is null)
      and ( public.fn_normaliza_descricao(m.descricao)
              ilike '%' || replace(replace(replace(rc.padrao,'\','\\'),'%','\%'),'_','\_') || '%'
            or word_similarity(rc.padrao, public.fn_normaliza_descricao(m.descricao)) >= public.fn_trgm_threshold() )
    order by
      (rc.empresa_id is not null) desc,   -- empresa vence global
      ( public.fn_normaliza_descricao(m.descricao)
          ilike '%' || replace(replace(replace(rc.padrao,'\','\\'),'%','\%'),'_','\_') || '%' ) desc,  -- contém-exato vence fuzzy
      rc.acertos desc,                     -- confiança
      word_similarity(rc.padrao, public.fn_normaliza_descricao(m.descricao)) desc,  -- maior similaridade
      rc.atualizado_em desc                -- mais recente
    limit 1
  )
  where m.empresa_id = p_empresa
    and m.categoria_status = 'pendente'
    and m.categoria_sugerida_id is null
    and (p_lote is null or m.lote_id = p_lote)
    and exists (
      select 1
      from public.regras_categorizacao rc
      where rc.ativo
        and rc.tipo_match = 'contem'
        and (rc.empresa_id = m.empresa_id or rc.empresa_id is null)
        and ( public.fn_normaliza_descricao(m.descricao)
                ilike '%' || replace(replace(replace(rc.padrao,'\','\\'),'%','\%'),'_','\_') || '%'
              or word_similarity(rc.padrao, public.fn_normaliza_descricao(m.descricao)) >= public.fn_trgm_threshold() )
    );

  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function public.fn_categorizar_pendentes(uuid, uuid) to authenticated;

-- Conferência:
--   select public.fn_normaliza_descricao('BOLETO PAGO AMIL ASSISTE 29.309.127/0001-79');
--   select word_similarity('BARTE', public.fn_normaliza_descricao('PIX RECEBIDO BARTE B16/06 BARTE BRASIL LTDA'));
--   select public.fn_categorizar_pendentes('<empresa-uuid>', null);
