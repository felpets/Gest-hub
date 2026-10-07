-- ============================================================
--  ZAYTAN HUB — Plano de Contas (categorias hierárquicas)
--  Rode no SQL Editor DEPOIS do schema.sql.
-- ============================================================

create table if not exists public.plano_contas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  tipo       text not null check (tipo in ('receita','despesa')),
  codigo     text,
  parent_id  uuid references public.plano_contas(id) on delete restrict,
  criado_em  timestamptz not null default now()
);

create index if not exists plano_contas_parent_idx on public.plano_contas(parent_id);

-- ─── RLS (só autenticado) ───────────────────────────────────
alter table public.plano_contas enable row level security;

drop policy if exists "acesso total autenticados" on public.plano_contas;
create policy "acesso total autenticados" on public.plano_contas
  for all to authenticated using (true) with check (true);

-- ============================================================
--  SEED — insere raízes e depois os filhos ligando pelo código.
-- ============================================================
-- truncate public.plano_contas cascade;

with dados(nome, tipo, codigo, parent_codigo) as (
  values
    ('Receita Operacional','receita','1.0', null),
    ('Mensalidades',       'receita','1.1', '1.0'),
    ('Projetos extras',    'receita','1.2', '1.0'),
    ('Tecnologia',         'despesa','2.0', null),
    ('SaaS',               'despesa','2.1', '2.0'),
    ('Infra',              'despesa','2.2', '2.0'),
    ('IA',                 'despesa','2.3', '2.0'),
    ('Marketing',          'despesa','3.0', null),
    ('Meta Ads',           'despesa','3.1', '3.0'),
    ('Criativos',          'despesa','3.2', '3.0'),
    ('Pessoal',            'despesa','4.0', null),
    ('Pró-labore',         'despesa','4.1', '4.0'),
    ('Freelancers',        'despesa','4.2', '4.0'),
    ('Operacional',        'despesa','5.0', null),
    ('Tributos',           'despesa','6.0', null),
    ('DAS Simples Nacional','despesa','6.1','6.0')
),
raizes as (
  insert into public.plano_contas (nome, tipo, codigo)
  select nome, tipo, codigo from dados where parent_codigo is null
  returning id, codigo
)
insert into public.plano_contas (nome, tipo, codigo, parent_id)
select d.nome, d.tipo, d.codigo, r.id
from dados d
join raizes r on r.codigo = d.parent_codigo
where d.parent_codigo is not null;
