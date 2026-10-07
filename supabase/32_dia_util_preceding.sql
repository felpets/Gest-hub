-- ============================================================
--  ZAYTAN HUB — Unifica a regra de DIA ÚTIL (convenção Preceding)
--  Rode no SQL Editor DEPOIS do 26. Aditivo e idempotente.
--
--  MUDANÇA vs. 26: a fn_dia_util_anterior deixa de ser "Modified
--  Preceding" (não mudava o mês; se recuar cruzasse o mês, andava
--  PARA FRENTE) e passa a ser "Preceding" puro — SEMPRE o dia útil
--  imediatamente anterior, mesmo caindo no mês anterior
--  (ex.: 01/08 sáb -> 31/07 sex). Nunca paga/cobra DEPOIS do
--  vencimento. Isso alinha o banco ao cliente (src/lib/datas.ts
--  diaUtilAnterior), que já usa Preceding, eliminando a divergência
--  entre Contas a Pagar (cliente) e Cobranças de clientes (SQL).
--
--  Como só a função base muda, todos os chamadores no banco
--  (fn_gerar_cobrancas, fn_ajustar_dia_util) passam a antecipar
--  igual automaticamente. Ao final, recomputa as cobranças
--  FUTURAS EM ABERTO a partir da data nominal (competência +
--  dia_vencimento) — não do vencimento já ajustado, que poderia
--  ter sido empurrado para frente pela convenção antiga.
--
--  Previstos (recorrentes) NÃO recebem backfill aqui: são
--  reconciliados no cliente (estenderRecorrentesSemPrazo).
-- ============================================================

-- ─── Dia útil anterior (Preceding: recua sempre, cruza o mês) ─
create or replace function public.fn_dia_util_anterior(p_empresa uuid, d date)
returns date
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  cand date := d;
  guard int := 0;
begin
  -- Recua um dia por vez até achar dia útil, mesmo saindo do mês.
  -- `guard` é só uma trava de segurança (todo mês tem dia útil).
  while not public.fn_dia_util(p_empresa, cand) loop
    cand := cand - 1;
    guard := guard + 1;
    exit when guard > 40;
  end loop;
  return cand;
end $$;

grant execute on function public.fn_dia_util_anterior(uuid, date) to authenticated;

-- ─── Backfill: cobranças futuras em aberto (todas as empresas) ─
-- Recalcula a partir da data NOMINAL (competência + dia_vencimento),
-- não do vencimento gravado — assim corrige também as que a regra
-- antiga tinha empurrado para o dia útil seguinte. Owner bypassa RLS;
-- cada linha usa seu próprio empresa_id. Só toca no que muda.
update public.cobrancas c
set vencimento = public.fn_dia_util_anterior(
      c.empresa_id,
      (c.competencia + (least(cl.dia_vencimento, 28) - 1) * interval '1 day')::date
    )
from public.clientes cl
where cl.id = c.cliente_id
  and cl.dia_vencimento is not null
  and c.status = 'aberto'
  and c.vencimento >= current_date
  and c.vencimento <> public.fn_dia_util_anterior(
        c.empresa_id,
        (c.competencia + (least(cl.dia_vencimento, 28) - 1) * interval '1 day')::date
      );

-- Conferência:
--   select public.fn_dia_util_anterior('<empresa>', '2026-08-01'); -- sáb -> 2026-07-31 (CRUZA o mês)
--   select public.fn_dia_util_anterior('<empresa>', '2026-02-21'); -- sáb -> 2026-02-20
--   select public.fn_dia_util_anterior('<empresa>', '2026-01-01'); -- Ano-Novo -> 2025-12-31
--   -- Cobranças de dia-1 que estavam no dia útil seguinte agora recuam:
--   select competencia, vencimento from public.cobrancas
--     where status='aberto' and vencimento >= current_date order by vencimento limit 20;
