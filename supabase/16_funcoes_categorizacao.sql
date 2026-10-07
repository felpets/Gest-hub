-- ============================================================
--  ZAYTAN HUB — Auto-categorização (3/3): funções/RPCs
--  Rode no SQL Editor DEPOIS do 15. Idempotente (create or replace).
--
--  Fluxo:
--   1) import insere o lote como 'pendente' (sem categoria confirmada);
--   2) fn_categorizar_pendentes() preenche apenas categoria_sugerida_id;
--   3) usuário revisa e aprova (1 a 1 ou em lote);
--   4) fn_aprovar_lote() grava a categoria CONFIRMADA e APRENDE a regra.
--
--  SECURITY INVOKER: rodam com a permissão do usuário e respeitam a RLS
--  (cada empresa só mexe nos próprios dados; regras globais são legíveis).
-- ============================================================

-- No Supabase as extensões ficam no schema `extensions` (não em public);
-- por isso o normalizador inclui `extensions` no search_path p/ achar unaccent().
create extension if not exists unaccent;  -- remoção de acentos no normalizador

-- ─── Normalização da descrição ──────────────────────────────
-- UBER *TRIP HELP.UBER.COM  -> "UBER TRIP HELP UBER COM"
-- PAG*Uber 072025           -> "UBER"
-- Passos: maiúsculas + sem acento; remove ruídos (PIX, PAG, TED, COMPRA...);
-- remove dígitos/datas/pontuação; colapsa espaços.
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
          -- ruídos comuns de extrato (palavras inteiras)
          '\y(PAG|PAGTO|PAGAMENTO|PIX|TED|DOC|COMPRA|DEBITO|CREDITO|TRANSF|TRANSFERENCIA|SAQUE|TARIFA|CARTAO|CARD|BOLETO|RECEBIMENTO|RECEBIDO|ENVIADO)\y',
          ' ', 'g'
        ),
        -- dígitos, datas e pontuação/símbolos viram espaço
        '[0-9*#/.,:;@_\-\\()\[\]]+',
        ' ', 'g'
      ),
      '\s+', ' ', 'g'  -- colapsa espaços
    )
  );
$$;

-- ─── Chave do estabelecimento (token estável p/ casar) ──────
-- Primeira palavra "significativa" (>= 3 chars) do texto normalizado.
-- Ex.: "UBER TRIP HELP UBER COM" -> "UBER"; "VIVO FIBRA" -> "VIVO".
-- (Heurística simples; como nada é confirmado sem aprovação, um match
--  largo demais só vira uma SUGESTÃO que o usuário pode rejeitar.)
create or replace function public.fn_chave_estabelecimento(p_texto text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  with norm as (select public.fn_normaliza_descricao(p_texto) as t)
  select coalesce(
    (
      select u.tok
      from norm, unnest(string_to_array(norm.t, ' ')) with ordinality as u(tok, ord)
      where char_length(u.tok) >= 3
      order by u.ord
      limit 1
    ),
    nullif(btrim((select t from norm)), '')
  );
$$;

-- ─── Caminho textual da categoria ("Pai / Filho") ───────────
-- Reconstrói o mesmo formato usado em movimentacoes.categoria a partir de
-- um id do plano de contas (sobe pelos parent_id e junta com " / ").
create or replace function public.fn_caminho_categoria(p_id uuid)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  with recursive cadeia as (
    select c.id, c.nome, c.parent_id, 0 as nivel
    from public.plano_contas c
    where c.id = p_id
    union all
    select pai.id, pai.nome, pai.parent_id, f.nivel + 1
    from public.plano_contas pai
    join cadeia f on pai.id = f.parent_id
  )
  select string_agg(nome, ' / ' order by nivel desc)
  from cadeia;
$$;

-- ─── Categorização: preenche SUGESTÃO nas pendentes ─────────
-- Casa por "contém" (ILIKE) contra as regras visíveis (empresa + globais).
-- Prioridade: regra da empresa vence a global; empate -> maior `acertos`.
-- Idempotente: só toca em linhas 'pendente' SEM sugestão; nunca mexe em
-- categoria confirmada. Gancho p/ fuzzy (pg_trgm) fica documentado abaixo.
create or replace function public.fn_categorizar_pendentes(p_empresa uuid, p_lote uuid default null)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
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
          and public.fn_normaliza_descricao(m.descricao)
              ilike '%' || replace(replace(replace(rc.padrao, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        order by (rc.empresa_id is not null) desc, rc.acertos desc, rc.atualizado_em desc
        limit 1
      )
  where m.empresa_id = p_empresa
    and m.categoria_status = 'pendente'
    and m.categoria_sugerida_id is null
    and (p_lote is null or m.lote_id = p_lote)
    -- só atualiza quem TEM match (evita gravar null e contar errado)
    and exists (
      select 1
      from public.regras_categorizacao rc
      where rc.ativo
        and rc.tipo_match = 'contem'
        and (rc.empresa_id = m.empresa_id or rc.empresa_id is null)
        and public.fn_normaliza_descricao(m.descricao)
            ilike '%' || replace(replace(replace(rc.padrao, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    );

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ─── Aprovação + aprendizado (transacional) ─────────────────
-- p_aprovacoes = jsonb: [{ "id": <mov uuid>, "categoria_id": <plano_contas uuid> }, ...]
-- Para cada linha PENDENTE (RLS garante que é da empresa do usuário):
--   (a) grava categoria CONFIRMADA (caminho "Pai / Filho") e status 'confirmada';
--   (b) APRENDE: upsert da regra (chave do estabelecimento -> categoria),
--       origem 'aprendida', incrementando `acertos`.
-- Idempotente: linha já confirmada é ignorada (não reaprende).
create or replace function public.fn_aprovar_lote(p_aprovacoes jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item      jsonb;
  v_mov_id    uuid;
  v_cat_id    uuid;
  v_empresa   uuid;
  v_descricao text;
  v_caminho   text;
  v_chave     text;
  v_count     integer := 0;
begin
  if jsonb_typeof(coalesce(p_aprovacoes, '[]'::jsonb)) <> 'array' then
    return 0;
  end if;

  for v_item in select * from jsonb_array_elements(p_aprovacoes)
  loop
    v_mov_id := nullif(v_item->>'id', '')::uuid;
    v_cat_id := nullif(v_item->>'categoria_id', '')::uuid;
    if v_mov_id is null or v_cat_id is null then
      continue;  -- item incompleto (sem categoria escolhida) é ignorado
    end if;

    -- Lê a movimentação PENDENTE (RLS restringe à empresa do usuário).
    select m.empresa_id, m.descricao
      into v_empresa, v_descricao
    from public.movimentacoes m
    where m.id = v_mov_id and m.categoria_status = 'pendente';

    if not found then
      continue;  -- já confirmada (idempotente) ou inacessível
    end if;

    -- A categoria escolhida TEM que ser do plano de contas DA PRÓPRIA empresa.
    -- Barra payload forjado e sugestão vinda de regra global apontando p/ outra
    -- empresa: sem isso, fn_caminho_categoria resolveria NULL (RLS) e gravaria
    -- 'confirmada' SEM categoria + aprenderia uma regra envenenada.
    if not exists (
      select 1 from public.plano_contas pc
      where pc.id = v_cat_id and pc.empresa_id = v_empresa
    ) then
      continue;
    end if;

    v_caminho := public.fn_caminho_categoria(v_cat_id);
    if v_caminho is null then
      continue;  -- cinto e suspensório: nunca confirma sem caminho de categoria
    end if;

    -- (a) sugerida/corrigida -> CONFIRMADA. Idempotente sob concorrência:
    --     só efetiva se a linha ainda estiver 'pendente' (fecha a janela
    --     TOCTOU de duas aprovações simultâneas do mesmo id).
    update public.movimentacoes
    set categoria = v_caminho,
        categoria_sugerida_id = v_cat_id,
        categoria_status = 'confirmada'
    where id = v_mov_id and categoria_status = 'pendente';
    if not found then
      continue;  -- corrida/replay: outra aprovação já confirmou; não reaprende
    end if;

    -- (b) aprende a regra (token -> categoria) na empresa da transação
    v_chave := public.fn_chave_estabelecimento(v_descricao);
    if v_chave is not null and char_length(v_chave) >= 3 then
      insert into public.regras_categorizacao
        (empresa_id, padrao, tipo_match, categoria_id, origem, acertos)
      values
        (v_empresa, v_chave, 'contem', v_cat_id, 'aprendida', 1)
      on conflict (empresa_id, padrao, tipo_match) do update
        set categoria_id  = excluded.categoria_id,
            -- mudou de categoria? recomeça a confiança (não herda os acertos da
            -- categoria antiga). Mesma categoria => incrementa.
            acertos       = case
                              when public.regras_categorizacao.categoria_id = excluded.categoria_id
                              then public.regras_categorizacao.acertos + 1
                              else 1
                            end,
            ativo         = true;
            -- mantém origem existente (não rebaixa uma regra 'manual')
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

grant execute on function public.fn_normaliza_descricao(text)         to authenticated;
grant execute on function public.fn_chave_estabelecimento(text)       to authenticated;
grant execute on function public.fn_caminho_categoria(uuid)           to authenticated;
grant execute on function public.fn_categorizar_pendentes(uuid, uuid) to authenticated;
grant execute on function public.fn_aprovar_lote(jsonb)               to authenticated;

-- ============================================================
--  FUTURO — fuzzy match (pg_trgm), quando "contém" não bastar:
--    create extension if not exists pg_trgm;
--    create index on public.regras_categorizacao using gin (padrao gin_trgm_ops);
--  e em fn_categorizar_pendentes trocar/complementar o ILIKE por similarity()
--  (ex.: similarity(fn_normaliza_descricao(m.descricao), rc.padrao) > 0.4),
--  mantendo a mesma prioridade (empresa > global, depois acertos).
-- ============================================================
