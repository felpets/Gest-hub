-- ============================================================
--  ZAYTAN HUB — Números de boleto/PIX em previstos e recorrentes
--  Rode no SQL Editor DEPOIS do 19. Aditivo e idempotente.
--  Guarda uma LISTA de códigos por pagamento (um boleto grande pode ter
--  vários códigos). Cada item: { "tipo": "boleto"|"pix", "codigo": text }.
-- ============================================================

alter table public.previstos
  add column if not exists boletos jsonb not null default '[]'::jsonb;

alter table public.recorrentes
  add column if not exists boletos jsonb not null default '[]'::jsonb;
