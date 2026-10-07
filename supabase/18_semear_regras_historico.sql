-- ============================================================
--  ZAYTAN HUB — Auto-categorização (5/5): aprender do histórico
--  Rode no SQL Editor DEPOIS do 17. Idempotente / re-rodável.
--  Semeia regras a partir das transações JÁ confirmadas, com FILTRO DE
--  QUALIDADE (validado no banco real: evita chaves tóxicas tipo PAGO,
--  que apareceu em 19 transações de 15 categorias diferentes).
-- ============================================================

-- ─── Inverso de fn_caminho_categoria: "Pai / Filho" -> plano_contas.id ──
-- Resolve dentro da empresa. Folha (filho, senão root). NULL se não casar
-- (categoria renomeada/apagada => a transação simplesmente não vira regra).
create or replace function public.fn_categoria_por_caminho(p_empresa uuid, p_caminho text)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with partes as (
    select string_to_array(btrim(p_caminho), ' / ') as arr
  ),
  root as (
    select pc.id
    from public.plano_contas pc, partes p
    where pc.empresa_id = p_empresa
      and pc.parent_id is null
      and pc.nome = (p.arr)[1]
    limit 1
  ),
  filho as (
    select pc.id
    from public.plano_contas pc, partes p, root r
    where pc.empresa_id = p_empresa
      and pc.parent_id = r.id
      and array_length(p.arr, 1) >= 2
      and pc.nome = (p.arr)[2]
    limit 1
  )
  select coalesce((select id from filho), (select id from root));
$$;

grant execute on function public.fn_categoria_por_caminho(uuid, text) to authenticated;

-- ─── Semeia regras a partir das movimentacoes CONFIRMADAS ──────────
-- Para cada chave (estabelecimento), escolhe a categoria DOMINANTE e usa a
-- contagem como acertos. FILTRO DE QUALIDADE (evita ruído/colisão):
--   - char_length(chave) >= 4   (descarta tokens curtos genéricos: INT, ANA)
--   - total >= 2                (precisa repetir pelo menos 2x)
--   - dominante/total >= 0.7    (a chave aponta "limpa" p/ uma categoria)
-- Upsert SÓ PROMOVE (nunca rebaixa manual nem reduz acertos). Re-rodável.
-- Retorna nº de regras inseridas/atualizadas.
create or replace function public.fn_semear_regras_do_historico(p_empresa uuid)
returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare v_count integer;
begin
  with base as (
    select
      public.fn_chave_estabelecimento(m.descricao)               as chave,
      public.fn_categoria_por_caminho(m.empresa_id, m.categoria) as cat_id
    from public.movimentacoes m
    where m.empresa_id = p_empresa
      and m.categoria_status = 'confirmada'
      and m.categoria is not null
  ),
  validas as (
    select chave, cat_id, count(*) as n
    from base
    where chave is not null
      and char_length(chave) >= 4
      and cat_id is not null
    group by chave, cat_id
  ),
  por_chave as (
    select
      chave,
      sum(n)                                          as total,
      max(n)                                          as dom_n,
      (array_agg(cat_id order by n desc, cat_id))[1]  as dom_cat
    from validas
    group by chave
  ),
  bons as (
    select chave, dom_cat, dom_n
    from por_chave
    where total >= 2
      and dom_n::numeric / total >= 0.7
  ),
  ins as (
    insert into public.regras_categorizacao
      (empresa_id, padrao, tipo_match, categoria_id, origem, acertos)
    select p_empresa, b.chave, 'contem', b.dom_cat, 'aprendida', b.dom_n
    from bons b
    on conflict (empresa_id, padrao, tipo_match) do update
      set categoria_id = case
            when public.regras_categorizacao.origem <> 'manual'
             and excluded.acertos >= public.regras_categorizacao.acertos
            then excluded.categoria_id
            else public.regras_categorizacao.categoria_id
          end,
          acertos = greatest(public.regras_categorizacao.acertos, excluded.acertos),
          ativo = true
      where public.regras_categorizacao.origem <> 'manual'  -- não toca regra manual
    returning 1
  )
  select count(*) into v_count from ins;

  return coalesce(v_count, 0);
end $$;

grant execute on function public.fn_semear_regras_do_historico(uuid) to authenticated;

-- ─── Bloco one-time: roda p/ TODAS as empresas (estilo 10_backfill.sql) ──
-- No SQL Editor roda como owner => RLS não barra a iteração.
do $$
declare
  r record;
  v_n integer;
begin
  for r in select id, nome from public.empresas order by nome loop
    select public.fn_semear_regras_do_historico(r.id) into v_n;
    raise notice 'seed historico: empresa % (%) -> % regras', r.nome, r.id, v_n;
  end loop;
end $$;

-- Conferência:
--   select fn_categoria_por_caminho('<empresa>', 'Folha De Pagamento / Vale Transporte');
--   select padrao, acertos, fn_caminho_categoria(categoria_id) cat, origem
--     from regras_categorizacao order by acertos desc;
--   -- re-rodar fn_semear_regras_do_historico('<empresa>') deve ser estável.
