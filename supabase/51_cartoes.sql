-- ============================================================
--  ZAYTAN HUB — Cartões e o que é pago por eles
--  Rode no SQL Editor DEPOIS do 50. Aditiva e idempotente.
--
--  Como estava: a fatura do cartão chega pelo extrato como uma movimentação só
--  (a Zaytan tem a categoria "Cartão › Fatura"), e cada ferramenta é uma
--  recorrência com a sua categoria ("Sistemas › Claude", "Sistemas e
--  Assinaturas › Digisac"…). Dava para ver o total da fatura OU a lista de
--  assinaturas, nunca "o que dentro da fatura é o quê".
--
--  O que falta é uma só informação: em QUE cartão a despesa cai. Por isso aqui
--  não nasce um módulo de cartão com fatura própria — nasce um cadastro enxuto
--  e um campo nas tabelas que já existem. A recorrência passa o cartão para os
--  pagamentos que ela gera, e a tela consegue responder "quanto o cartão X
--  compromete nos próximos meses, item a item".
-- ============================================================

create table if not exists public.cartoes (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  nome          text not null,
  final         text,                       -- 4 últimos dígitos, só para reconhecer
  dia_fechamento  integer check (dia_fechamento is null or (dia_fechamento between 1 and 31)),
  dia_vencimento  integer check (dia_vencimento is null or (dia_vencimento between 1 and 31)),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  criado_por    uuid default auth.uid()
);

create index if not exists cartoes_empresa_idx on public.cartoes (empresa_id, ativo);

-- Em que cartão a despesa cai. null = não passa por cartão (o normal).
alter table public.recorrentes add column if not exists cartao_id uuid references public.cartoes(id) on delete set null;
alter table public.previstos   add column if not exists cartao_id uuid references public.cartoes(id) on delete set null;

create index if not exists previstos_cartao_idx on public.previstos (cartao_id) where cartao_id is not null;

comment on table public.cartoes is
  'Cadastro enxuto de cartões. A fatura continua chegando pelo extrato; isto só diz em que cartão cada despesa cai.';

-- ─── RLS ────────────────────────────────────────────────────
-- Leitura para quem tem acesso à empresa (como o resto do cadastro);
-- gravação para quem gerencia contas a pagar.
alter table public.cartoes enable row level security;
revoke all on public.cartoes from anon;

drop policy if exists cartoes_select on public.cartoes;
create policy cartoes_select on public.cartoes
  for select to authenticated
  using ( public.tem_acesso_empresa(empresa_id) );

drop policy if exists cartoes_write on public.cartoes;
create policy cartoes_write on public.cartoes
  for all to authenticated
  using ( public.cargo_tem(empresa_id, 'contas_gerir') )
  with check ( public.cargo_tem(empresa_id, 'contas_gerir') );

-- ─── Conferência ────────────────────────────────────────────
--   select c.nome, count(p.*) itens, sum(p.valor) total
--     from public.cartoes c
--     left join public.previstos p on p.cartao_id = c.id and not p.pago
--    group by c.nome;
