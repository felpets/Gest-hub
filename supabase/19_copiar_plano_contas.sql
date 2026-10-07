-- ============================================================
--  ZAYTAN HUB — Copiar plano de contas entre empresas (SÓ MASTER)
--  Rode no SQL Editor DEPOIS do 18. Idempotente (create or replace).
--  Copia TODAS as categorias (qualquer profundidade) de uma empresa de ORIGEM
--  para a de DESTINO, remapeando o parent_id por um mapa origem->destino
--  mantido em memória (jsonb) — SEM tabela temporária, porque o PostgREST
--  reutiliza conexões/prepared statements e `CREATE TEMP TABLE` quebrava ali.
--  ADITIVO e re-rodável: pula categorias que já existam no destino (mesmo nome
--  sob o mesmo pai). SECURITY DEFINER + is_master(): só o master executa.
-- ============================================================

create or replace function public.copiar_plano_contas(p_origem uuid, p_destino uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count       integer := 0;
  r             record;
  v_map         jsonb := '{}'::jsonb;   -- origem.id (text) -> destino.id (text)
  v_dest_parent uuid;
  v_existing    uuid;
  v_new         uuid;
begin
  if not public.is_master() then
    raise exception 'Apenas o master pode copiar o plano de contas';
  end if;
  if p_origem is null or p_destino is null then
    raise exception 'Informe a empresa de origem e a de destino';
  end if;
  if p_origem = p_destino then
    raise exception 'Origem e destino são a mesma empresa';
  end if;

  -- Percorre a árvore da origem em ordem de profundidade (pai antes do filho).
  for r in
    with recursive t as (
      select id, nome, tipo, codigo, parent_id, 0 as nivel
      from public.plano_contas
      where empresa_id = p_origem and parent_id is null
      union all
      select c.id, c.nome, c.tipo, c.codigo, c.parent_id, t.nivel + 1
      from public.plano_contas c
      join t on c.parent_id = t.id
      where c.empresa_id = p_origem
    )
    select id, nome, tipo, codigo, parent_id, nivel
    from t
    order by nivel, codigo nulls last, nome
  loop
    -- Pai correspondente no destino (null se raiz; null se não mapeado).
    if r.parent_id is null then
      v_dest_parent := null;
    else
      v_dest_parent := (v_map ->> r.parent_id::text)::uuid;
      if v_dest_parent is null then
        continue;  -- pai não mapeado (árvore inconsistente): pula com segurança
      end if;
    end if;

    -- Já existe no destino (mesmo nome sob o mesmo pai)? então só mapeia.
    select id into v_existing
    from public.plano_contas
    where empresa_id = p_destino
      and nome = r.nome
      and parent_id is not distinct from v_dest_parent
    limit 1;

    if v_existing is not null then
      v_map := v_map || jsonb_build_object(r.id::text, v_existing::text);
    else
      insert into public.plano_contas (empresa_id, nome, tipo, codigo, parent_id)
      values (p_destino, r.nome, r.tipo, r.codigo, v_dest_parent)
      returning id into v_new;
      v_map := v_map || jsonb_build_object(r.id::text, v_new::text);
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;  -- nº de categorias efetivamente criadas no destino
end $$;

grant execute on function public.copiar_plano_contas(uuid, uuid) to authenticated;

-- Conferência (no app é só master; aqui no editor roda como owner):
--   select public.copiar_plano_contas('<empresa-origem>', '<empresa-destino>');
