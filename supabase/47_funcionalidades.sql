-- ============================================================
--  ZAYTAN HUB — Funcionalidades opcionais por empresa
--  Rode no SQL Editor DEPOIS do 46. Aditiva e idempotente.
--
--  Partes do sistema que nem toda empresa usa (hoje: Dívidas e acordos)
--  passam a ser ligadas/desligadas em Configurações › Funcionalidades.
--  Desligada, a área some do menu, do dashboard e dos relatórios — os
--  registros continuam no banco e voltam a aparecer quando religar.
--
--  Onde mora: `configuracoes` já é 1 linha por empresa (migração 11), então
--  a chave/valor entra aqui em vez de virar tabela nova. Sem valor gravado,
--  vale o padrão do catálogo do app (src/lib/funcionalidades.ts).
-- ============================================================

alter table public.configuracoes
  add column if not exists funcionalidades jsonb not null default '{}'::jsonb;

comment on column public.configuracoes.funcionalidades is
  'Funcionalidades opcionais: {"dividas_acordos": true|false}. Sem a chave = padrão do app.';

-- RLS: nada a mudar. `configuracoes` está no grupo CONFIGURAÇÃO da migração 28
-- (leitura para membros da empresa, gravação só para quem administra).

-- ─── Conferência ────────────────────────────────────────────
--   select empresa_id, funcionalidades from public.configuracoes;
