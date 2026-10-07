-- ============================================================
--  ZAYTAN HUB — Pix do dia enxerga os pagamentos diários do RH
--
--  Mão única: quem tem "Pagamentos diários (Pix)" na empresa vê, só para
--  leitura, o que o RH lançou em Pagamento diário para essa empresa. O RH não
--  enxerga a lista de Pix do Financeiro (as tabelas rh_* não a referenciam e a
--  RLS de pagamentos_diarios continua exigindo pag_diario_gerir).
--
--  Requer 42_rh_modulo.sql. Aditiva e idempotente.
-- ============================================================

-- A empresa do RH é um texto ("Laportec"); a do Financeiro é uma linha de
-- `empresas`. Casa pelo nome, sem diferenciar maiúsculas, e aceita o nome do
-- Financeiro começar pelo do RH ("Laportec Assessoria" ↔ "Laportec").
create or replace function public.rh_empresa_corresponde(p_nome_financeiro text, p_empresa_rh text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(btrim(p_empresa_rh), '') <> ''
     and (lower(btrim(p_nome_financeiro)) = lower(btrim(p_empresa_rh))
          or starts_with(lower(btrim(p_nome_financeiro)), lower(btrim(p_empresa_rh)) || ' '));
$$;

create or replace function public.fn_rh_pagamentos_para_pix(p_empresa uuid, p_de date, p_ate date)
returns table (
  id text, data date, pessoa text, chave_pix text, forma text,
  valor numeric, descricao text, pago boolean, empresa_rh text
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_nome text;
begin
  if not public.cargo_tem(p_empresa, 'pag_diario_gerir') then
    raise exception 'Sem permissão para ver os pagamentos diários desta empresa'
      using errcode = '42501';
  end if;

  select e.nome into v_nome from public.empresas e where e.id = p_empresa;
  if v_nome is null then
    return;
  end if;

  return query
    select r.id,
           r.data_pagamento,
           coalesce(nullif(r.pessoa, ''), r.data->>'pessoa', ''),
           coalesce(r.data->>'pix', ''),
           coalesce(nullif(r.data->>'formaPagamento', ''), 'Pix'),
           coalesce(r.valor, 0),
           coalesce(r.data->>'descricao', ''),
           lower(coalesce(r.data->>'pago', '')) in ('true', 't', '1', 'sim'),
           r.empresa
    from public.rh_pagamentos_diarios r
    where r.data_pagamento between p_de and p_ate
      and public.rh_empresa_corresponde(v_nome, r.empresa)
    order by r.data_pagamento desc, r.id;
end $$;

revoke execute on function public.fn_rh_pagamentos_para_pix(uuid, date, date) from public, anon;
grant execute on function public.fn_rh_pagamentos_para_pix(uuid, date, date) to authenticated;

-- ─── Conferência ────────────────────────────────────────────
--   select * from public.fn_rh_pagamentos_para_pix('<empresa_id>', current_date - 30, current_date);
