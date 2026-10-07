-- ============================================================
--  ZAYTAN HUB — Integração Banco Inter (saldo + extrato via API)
--  Rode no SQL Editor DEPOIS do 29. Aditivo e idempotente.
--
--  Opcional POR CONTA BANCÁRIA: a empresa que conectar a conta do
--  Inter busca extrato/saldo direto da API (as transações caem na
--  Revisão como um lote, igual ao upload). Quem não conectar segue
--  no fluxo de importação por arquivo, intocado.
--
--  SEGURANÇA: client_secret/certificado/chave privada ficam nesta
--  tabela e o navegador NUNCA consegue lê-los —
--    - RLS habilitada SEM nenhuma policy p/ authenticated (deny-all)
--    - revoke de todos os privilégios de anon/authenticated
--    - gravação só via RPCs SECURITY DEFINER (só master)
--    - leitura de STATUS (sem segredos) via fn_inter_status
--  Quem lê os segredos é apenas a função server-side no Vercel,
--  usando a SERVICE_ROLE key (bypassa RLS).
-- ============================================================

-- ─── 1) Tabela (1 integração por conta bancária) ────────────
create table if not exists public.integracoes_inter (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id) on delete cascade,
  conta_id        uuid not null unique references public.contas_bancarias(id) on delete cascade,
  client_id       text not null,
  client_secret   text not null,
  cert_pem        text not null,   -- conteúdo PEM do .crt da aplicação Inter
  key_pem         text not null,   -- conteúdo PEM do .key (chave privada)
  conta_corrente  text,            -- header x-conta-corrente (só se a aplicação tiver 2+ contas)
  ativo           boolean not null default true,
  ultimo_saldo    numeric(14,2),   -- saldo "disponível" gravado na última sync
  ultimo_saldo_em timestamptz,
  ultima_sync     timestamptz,     -- só avança quando a sync termina OK
  ultimo_erro     text,            -- null = última sync OK
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index if not exists integracoes_inter_empresa_idx on public.integracoes_inter(empresa_id);

alter table public.integracoes_inter enable row level security;
-- Deny-all duplo: RLS sem policies + revoke (o browser não lê nem via bug de policy).
revoke all on public.integracoes_inter from anon, authenticated;

-- ─── 2) Gravar credenciais (SÓ MASTER) ──────────────────────
-- Upsert por conta. Normaliza \r de PEM colado no Windows e valida o formato.
create or replace function public.fn_inter_salvar(
  p_conta uuid,
  p_client_id text,
  p_client_secret text,
  p_cert_pem text,
  p_key_pem text,
  p_conta_corrente text default null
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_empresa uuid;
begin
  if not public.is_master() then
    raise exception 'Apenas o master pode configurar a integracao';
  end if;
  select empresa_id into v_empresa from public.contas_bancarias where id = p_conta;
  if v_empresa is null then
    raise exception 'Conta bancaria nao encontrada';
  end if;
  if coalesce(btrim(p_client_id), '') = '' or coalesce(btrim(p_client_secret), '') = '' then
    raise exception 'Informe client_id e client_secret da aplicacao Inter';
  end if;
  if position('-----BEGIN' in coalesce(p_cert_pem, '')) = 0 then
    raise exception 'Certificado invalido: cole o conteudo PEM do arquivo .crt (comeca com -----BEGIN)';
  end if;
  if position('-----BEGIN' in coalesce(p_key_pem, '')) = 0 then
    raise exception 'Chave invalida: cole o conteudo PEM do arquivo .key (comeca com -----BEGIN)';
  end if;

  insert into public.integracoes_inter
    (empresa_id, conta_id, client_id, client_secret, cert_pem, key_pem, conta_corrente)
  values (
    v_empresa,
    p_conta,
    btrim(p_client_id),
    btrim(p_client_secret),
    replace(p_cert_pem, chr(13), ''),
    replace(p_key_pem, chr(13), ''),
    nullif(btrim(coalesce(p_conta_corrente, '')), '')
  )
  on conflict (conta_id) do update set
    client_id      = excluded.client_id,
    client_secret  = excluded.client_secret,
    cert_pem       = excluded.cert_pem,
    key_pem        = excluded.key_pem,
    conta_corrente = excluded.conta_corrente,
    ativo          = true,
    ultimo_erro    = null,
    atualizado_em  = now();
end $$;

-- ─── 3) Ligar/desligar sem apagar credenciais (SÓ MASTER) ───
create or replace function public.fn_inter_toggle(p_conta uuid, p_ativo boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_master() then
    raise exception 'Apenas o master pode alterar a integracao';
  end if;
  update public.integracoes_inter
    set ativo = p_ativo, atualizado_em = now()
    where conta_id = p_conta;
end $$;

-- ─── 4) Remover a integração (apaga credenciais; SÓ MASTER) ─
create or replace function public.fn_inter_remover(p_conta uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_master() then
    raise exception 'Apenas o master pode remover a integracao';
  end if;
  delete from public.integracoes_inter where conta_id = p_conta;
end $$;

-- ─── 5) Status SEM segredos (qualquer membro da empresa) ────
-- Alimenta Dashboard/Ajustes/Importar. client_id sai mascarado e só p/ master.
create or replace function public.fn_inter_status(p_empresa uuid)
returns table (
  conta_id        uuid,
  ativo           boolean,
  ultimo_saldo    numeric,
  ultimo_saldo_em timestamptz,
  ultima_sync     timestamptz,
  ultimo_erro     text,
  client_id_mask  text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select i.conta_id, i.ativo, i.ultimo_saldo, i.ultimo_saldo_em, i.ultima_sync, i.ultimo_erro,
         case when public.is_master() then '••••' || right(i.client_id, 4) else null end
  from public.integracoes_inter i
  where i.empresa_id = p_empresa
    and public.tem_acesso_empresa(p_empresa);
$$;

grant execute on function public.fn_inter_salvar(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.fn_inter_toggle(uuid, boolean)                      to authenticated;
grant execute on function public.fn_inter_remover(uuid)                              to authenticated;
grant execute on function public.fn_inter_status(uuid)                               to authenticated;

-- ─── Conferência ────────────────────────────────────────────
--   select * from public.fn_inter_status('<empresa>');
--   -- Como usuário comum, isto deve falhar/retornar vazio:
--   select client_secret from public.integracoes_inter;  -- permission denied
