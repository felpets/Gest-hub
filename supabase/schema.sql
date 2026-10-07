-- ============================================================
--  ZAYTAN HUB FINANCEIRO — schema inicial do Supabase
--  Como usar: Supabase Dashboard → SQL Editor → New query →
--  cole TUDO e clique em "Run". Roda do zero ou em base já criada.
-- ============================================================

-- ─── Extensões ──────────────────────────────────────────────
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ============================================================
--  TABELAS
-- ============================================================

-- ─── Clientes ───────────────────────────────────────────────
create table if not exists public.clientes (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  status      text not null default 'Pago'
              check (status in ('Pago','Pendente','Inadimplente','Inativo')),
  mensalidade numeric(12,2) not null default 0,
  ticket      numeric(12,2) not null default 0,
  atraso      integer not null default 0,
  criado_em   timestamptz not null default now()
);

-- ─── Movimentações (extrato bancário consolidado) ───────────
create table if not exists public.movimentacoes (
  id            uuid primary key default gen_random_uuid(),
  data          date not null,
  descricao     text not null,                 -- bruto vindo do banco
  descricao_ia  text,                          -- descrição enriquecida pela IA
  categoria     text,
  confianca     numeric(4,3) not null default 1, -- 0..1
  valor         numeric(12,2) not null,        -- sempre positivo; o sinal vem de `tipo`
  tipo          text not null check (tipo in ('in','out')),
  status        text not null default 'Realizado',
  criado_em     timestamptz not null default now()
);

-- ─── Previstos (entradas/saídas a vencer) ───────────────────
create table if not exists public.previstos (
  id         uuid primary key default gen_random_uuid(),
  data       date not null,
  descricao  text not null,
  categoria  text,
  valor      numeric(12,2) not null,
  tipo       text not null check (tipo in ('in','out')),
  criado_em  timestamptz not null default now()
);

-- ─── Regras de categorização ────────────────────────────────
create table if not exists public.regras (
  id        uuid primary key default gen_random_uuid(),
  quando    text not null,   -- ex.: "descrição contém META"
  entao     text not null,   -- ex.: "Marketing / Meta Ads"
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ============================================================
--  ROW LEVEL SECURITY
--  Ferramenta interna: qualquer usuário AUTENTICADO tem acesso
--  total. Visitantes anônimos não enxergam nada.
-- ============================================================
alter table public.clientes      enable row level security;
alter table public.movimentacoes enable row level security;
alter table public.previstos     enable row level security;
alter table public.regras        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['clientes','movimentacoes','previstos','regras'] loop
    execute format(
      'drop policy if exists "acesso total autenticados" on public.%I;', t);
    execute format($f$
      create policy "acesso total autenticados" on public.%I
        for all to authenticated
        using (true) with check (true);
    $f$, t);
  end loop;
end $$;

-- ============================================================
--  SEED — dados atuais do app (src/lib/mock.ts) convertidos.
--  Rode só uma vez; descomente o TRUNCATE para recarregar.
-- ============================================================
-- truncate public.clientes, public.movimentacoes, public.previstos, public.regras;

insert into public.clientes (nome, status, mensalidade, ticket, atraso) values
  ('LaPortec','Pago',1500,1500,0),
  ('Star5','Pago',2200,2350,0),
  ('ELOS','Pago',1800,1800,0),
  ('TITÃS','Pendente',1200,1200,4),
  ('Dakal','Pago',980,1100,0),
  ('Allure','Pendente',1450,1450,2),
  ('OTTO','Pago',950,1020,0),
  ('Eros','Inativo',0,1300,0),
  ('Absoluta','Pago',3400,3400,0),
  ('B&S','Inadimplente',1750,1750,18);

insert into public.movimentacoes (data, descricao, descricao_ia, categoria, confianca, valor, tipo) values
  ('2025-05-29','META PLATFORMS ANUNCIOS','Meta Ads — campanha conversão Maio','Marketing / Meta Ads',0.98,2200,'out'),
  ('2025-05-29','OPENAI *CHATGPT','ChatGPT Plus mensal','Tecnologia / IA',0.96,110,'out'),
  ('2025-05-28','PIX RECEBIDO LAPORTEC LTDA','LaPortec — mensalidade Maio','Receita / Mensalidade',0.97,1500,'in'),
  ('2025-05-28','SUPABASE INC','Supabase Pro — infra DB','Tecnologia / Infra',0.94,130,'out'),
  ('2025-05-27','TED CREDITO STAR5 SERV','Star5 — mensalidade Maio','Receita / Mensalidade',0.95,2200,'in'),
  ('2025-05-27','VIVO FIBRA','Internet escritório','Operacional',0.91,220,'out'),
  ('2025-05-26','PIX RECEBIDO ELOS COMUN','ELOS — mensalidade Maio','Receita / Mensalidade',0.94,1800,'in'),
  ('2025-05-26','REGUS BR','Endereço fiscal mensal','Operacional',0.88,480,'out'),
  ('2025-05-25','PIX Marina Ferreira','Designer freelancer — entregas Maio','Pessoal / Freelancer',0.72,1800,'out'),
  ('2025-05-24','PIX Vinícius Andrade','Dev — sprint 22','Pessoal / Pró-labore',0.69,3200,'out'),
  ('2025-05-23','TRANSF Hub Criativos','Produção criativos Maio','Marketing / Criativos',0.84,950,'out'),
  ('2025-05-22','PIX RECEBIDO OTTO MKT','OTTO — mensalidade Maio','Receita / Mensalidade',0.86,950,'in'),
  ('2025-05-20','META PLATFORMS ANUNCIOS','Meta Ads — boost campanha','Marketing / Meta Ads',0.98,1000,'out'),
  ('2025-05-18','PIX RECEBIDO DAKAL ME','Dakal — mensalidade Maio','Receita / Mensalidade',0.93,980,'in'),
  ('2025-05-15','PIX RECEBIDO ALLURE','Allure — mensalidade Maio','Receita / Mensalidade',0.92,1450,'in'),
  ('2025-05-12','PIX RECEBIDO TITAS','TITÃS — mensalidade Maio','Receita / Mensalidade',0.94,1200,'in'),
  ('2025-05-10','DAS SIMPLES NACIONAL','DAS — Simples Nacional','Tributos / DAS',0.99,720,'out'),
  ('2025-05-05','LOVABLE *PRO','Lovable Pro','Tecnologia / SaaS',0.97,100,'out'),
  ('2025-05-03','HETZNER ONLINE','VPS N8N — Hetzner','Tecnologia / Infra',0.95,80,'out'),
  ('2025-05-02','ANTHROPIC CLAUDE','Claude Code mensal','Tecnologia / IA',0.96,92,'out');

insert into public.previstos (data, descricao, categoria, valor, tipo) values
  ('2025-06-02','Lovable Pro','Tecnologia / SaaS',100,'out'),
  ('2025-06-03','VPS N8N Hetzner','Tecnologia / Infra',80,'out'),
  ('2025-06-05','Claude Code','Tecnologia / IA',92,'out'),
  ('2025-06-06','Mensalidade LaPortec','Receita / Mensalidade',1500,'in'),
  ('2025-06-07','Mensalidade TITÃS','Receita / Mensalidade',1200,'in'),
  ('2025-06-10','Mensalidade Dakal','Receita / Mensalidade',980,'in'),
  ('2025-06-12','Mensalidade Allure','Receita / Mensalidade',1450,'in'),
  ('2025-06-15','Meta Ads — Junho','Marketing / Meta Ads',2000,'out'),
  ('2025-06-20','DAS Simples Nacional','Tributos / DAS',750,'out');

insert into public.regras (quando, entao, ativo) values
  ('descrição contém META','Marketing / Meta Ads',true),
  ('descrição contém UBER','Transporte',true),
  ('PIX Vinícius','Pessoal / Pró-labore',true),
  ('descrição contém SUPABASE','Tecnologia / Infra',true),
  ('descrição contém OPENAI ou CHATGPT','Tecnologia / IA',false);
