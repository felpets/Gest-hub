-- ============================================================
--  ZAYTAN HUB — Administração (Empresas e cargos) por pessoa
--
--  Gestão › Usuários › Acessos liga ou desliga a administração de alguém.
--  Administração = master: quem cria empresas, cargos e acessos consegue dar
--  a si mesmo qualquer acesso, então não existe "administração parcial".
--
--  Travas: só o master mexe; ninguém tira a própria administração; o sistema
--  nunca fica sem administrador. Aditiva e idempotente.
-- ============================================================

create or replace function public.fn_definir_master(p_user uuid, p_master boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_master() then
    raise exception 'Apenas o administrador pode dar ou tirar a administração';
  end if;
  if p_user = auth.uid() and not coalesce(p_master, false) then
    raise exception 'Você não pode tirar a sua própria administração';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'Usuário não encontrado';
  end if;

  insert into public.perfis (user_id, is_master)
  values (p_user, coalesce(p_master, false))
  on conflict (user_id) do update set is_master = excluded.is_master;

  if not exists (select 1 from public.perfis p where p.is_master) then
    raise exception 'O sistema precisa de pelo menos um administrador';
  end if;
end $$;

revoke execute on function public.fn_definir_master(uuid, boolean) from public, anon;
grant execute on function public.fn_definir_master(uuid, boolean) to authenticated;

-- ─── Conferência ────────────────────────────────────────────
--   select user_id, is_master from public.perfis where is_master;
