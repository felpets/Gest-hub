-- ============================================================
--  ZAYTAN HUB — Parcelas pagas de processos + comprovantes
--  Rode no SQL Editor DEPOIS do 36. Aditivo e idempotente.
--
--  "Registrar pagamento" no card do processo grava aqui a parcela paga
--  (número, data, valor) e, opcionalmente, o comprovante — arquivo no
--  bucket privado `comprovantes` do Storage, caminho gravado na linha.
--  Sem esta migração o botão ainda avança a parcela; só o histórico e os
--  comprovantes ficam indisponíveis (o app avisa).
--
--  RLS: mesmo padrão da 31 — leitura p/ membro da empresa; escrita p/ quem
--  tem 'contas_gerir'. No Storage, a 1ª pasta do caminho é o empresa_id.
-- ============================================================

-- ─── 1) Tabela de parcelas pagas ────────────────────────────
create table if not exists public.pagamentos_processos_parcelas (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  processo_id      uuid not null references public.pagamentos_processos(id) on delete cascade,
  numero           int not null check (numero >= 1),
  pago_em          date not null default current_date,
  valor            numeric(14,2) not null default 0,
  comprovante_path text,   -- caminho no bucket `comprovantes` (null = sem anexo)
  comprovante_nome text,   -- nome original do arquivo, para exibir
  criado_em        timestamptz not null default now()
);
create index if not exists pagamentos_processos_parcelas_processo_idx
  on public.pagamentos_processos_parcelas(processo_id, numero);

alter table public.pagamentos_processos_parcelas enable row level security;

drop policy if exists pp_parcelas_select on public.pagamentos_processos_parcelas;
create policy pp_parcelas_select on public.pagamentos_processos_parcelas
  for select to authenticated
  using ( public.tem_acesso_empresa(empresa_id) );

drop policy if exists pp_parcelas_write on public.pagamentos_processos_parcelas;
create policy pp_parcelas_write on public.pagamentos_processos_parcelas
  for all to authenticated
  using ( public.cargo_tem(empresa_id, 'contas_gerir') )
  with check ( public.cargo_tem(empresa_id, 'contas_gerir') );

-- ─── 2) Bucket privado de comprovantes ──────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprovantes', 'comprovantes', false,
  10485760,                                             -- 10 MB por arquivo
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do nothing;

-- Caminho: <empresa_id>/processos/<processo_id>/<arquivo>. A política olha a
-- 1ª pasta (empresa) — quem acessa a empresa lê; quem gere contas grava/apaga.
drop policy if exists comprovantes_select on storage.objects;
create policy comprovantes_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprovantes'
    and public.tem_acesso_empresa(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists comprovantes_insert on storage.objects;
create policy comprovantes_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprovantes'
    and public.cargo_tem(((storage.foldername(name))[1])::uuid, 'contas_gerir')
  );

drop policy if exists comprovantes_delete on storage.objects;
create policy comprovantes_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'comprovantes'
    and public.cargo_tem(((storage.foldername(name))[1])::uuid, 'contas_gerir')
  );

-- ─── Conferência ────────────────────────────────────────────
--   select * from storage.buckets where id = 'comprovantes';
--   select * from public.pagamentos_processos_parcelas order by criado_em desc limit 10;
-- Obs.: excluir uma empresa (migração 36) apaga as linhas por cascade, mas os
-- ARQUIVOS no Storage ficam — apague a pasta <empresa_id>/ no painel se quiser.
