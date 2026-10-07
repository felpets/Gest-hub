-- ============================================================
--  ZAYTAN HUB — Extrato do cartão de crédito
--  Rode no SQL Editor DEPOIS do 52. Aditiva e idempotente.
--
--  Como estava: o cartão era só um cadastro (migração 51) para dizer em que
--  cartão cada recorrência cai. As compras da fatura não entravam no sistema.
--
--  O que muda: na tela Extratos › Importar, o cartão aparece ao lado das
--  contas bancárias. O extrato (OFX/CSV/Excel) do cartão grava AQUI, e não em
--  movimentacoes — a fatura paga continua sendo a única saída de caixa (vem
--  pelo extrato do banco). Assim o demonstrativo do cartão mostra "o que foi
--  gasto em quê" sem contar o mesmo dinheiro duas vezes no saldo e nos
--  relatórios.
-- ============================================================

begin;

create table if not exists public.cartao_lancamentos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  cartao_id   uuid not null references public.cartoes(id) on delete cascade,
  data        date not null,                 -- data da compra
  descricao   text not null,
  valor       numeric(12,2) not null check (valor > 0),
  tipo        text not null check (tipo in ('in', 'out')),  -- out = compra; in = estorno/pagamento
  categoria   text,                          -- caminho "Pai / Filho" do plano de contas
  fitid       text,                          -- id da transação no OFX (dedup)
  lote_id     uuid,                          -- importação que trouxe a linha
  criado_em   timestamptz not null default now(),
  criado_por  uuid default auth.uid()
);

create index if not exists cartao_lancamentos_cartao_idx on public.cartao_lancamentos (cartao_id, data);
create index if not exists cartao_lancamentos_empresa_idx on public.cartao_lancamentos (empresa_id);

-- O mesmo OFX importado de novo não duplica (igual a movimentacoes, por conta).
create unique index if not exists cartao_lancamentos_fitid_unico
  on public.cartao_lancamentos (cartao_id, fitid)
  where fitid is not null;

comment on table public.cartao_lancamentos is
  'Compras do extrato do cartão. Não entram no saldo: a fatura paga é a saída de caixa (movimentacoes).';

-- ─── RLS ────────────────────────────────────────────────────
-- Lê quem acessa a empresa; grava quem importa extrato ou cuida das contas.
alter table public.cartao_lancamentos enable row level security;
revoke all on public.cartao_lancamentos from anon;
grant select, insert, update, delete on public.cartao_lancamentos to authenticated;

drop policy if exists cartao_lancamentos_select on public.cartao_lancamentos;
create policy cartao_lancamentos_select on public.cartao_lancamentos
  for select to authenticated
  using ( public.tem_acesso_empresa(empresa_id) );

drop policy if exists cartao_lancamentos_write on public.cartao_lancamentos;
create policy cartao_lancamentos_write on public.cartao_lancamentos
  for all to authenticated
  using ( public.cargo_tem(empresa_id, 'mov_gerir') or public.cargo_tem(empresa_id, 'contas_gerir') )
  with check ( public.cargo_tem(empresa_id, 'mov_gerir') or public.cargo_tem(empresa_id, 'contas_gerir') );

commit;

-- ─── Conferência ────────────────────────────────────────────
--   select c.nome, date_trunc('month', l.data) mes, sum(l.valor) filter (where l.tipo = 'out') gasto
--     from public.cartao_lancamentos l join public.cartoes c on c.id = l.cartao_id
--    group by 1, 2 order by 1, 2;
