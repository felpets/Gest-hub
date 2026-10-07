-- ============================================================
--  ZAYTAN HUB — Pix do dia aceita o Pix copia e cola (QR code)
--  Rode no SQL Editor DEPOIS do 54. Aditiva e idempotente.
--
--  QR estático: a tela extrai a chave de dentro do código e grava como chave
--  comum — nada muda no banco. QR dinâmico (cobrança de banco/maquininha) não
--  tem chave, só um endereço que o banco do pagador consulta: aí o código
--  inteiro é gravado em chave_pix com o tipo novo 'copia_cola'.
-- ============================================================

alter table public.pagamentos_diarios drop constraint if exists pagamentos_diarios_tipo_chave_check;
alter table public.pagamentos_diarios add constraint pagamentos_diarios_tipo_chave_check
  check (tipo_chave in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria', 'outro', 'copia_cola'));
