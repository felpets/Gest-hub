// /api/usuarios — cadastro de logins (aba Usuários do app).
// Auth: Bearer <access_token do usuário logado no Supabase>.
// Autorização: master (qualquer usuário) OU admin (só quem é membro de uma
// empresa que ele administra, e nunca um master). Ver api/_lib/usuarios.ts.
//
//   POST   { email, senha, nome?, empresaId?, papel? } → cria o login e vincula
//          (sem empresa só o master: login só do RH, ou com acessos definidos depois)
//   PATCH  { userId, email?, nome?, senha? }          → altera o cadastro
//   DELETE { userId, motivo? }                        → exclui o login (só o master)
//
// Tudo fica no registro de alterações (usuarios_historico, migração 46). A
// exclusão é "suave" no Supabase Auth: o login deixa de existir para entrar,
// mas o registro técnico continua, então nada que aponta para a pessoa quebra.
//
// Trocar e-mail/senha só é possível daqui: são campos de auth.users, e quem
// mexe neles com segurança (hash, identidade, confirmação) é a Admin API do
// Supabase, que exige a service role — indisponível no navegador, de propósito.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { corsDoApp } from "./_lib/cors.js";
import { adminClient, getUserFromBearer } from "./_lib/supabase.js";
import {
  escopoAdmin, podeGerenciar, podeNaEmpresa, cargoExiste, erroEmail, erroSenha,
} from "./_lib/usuarios.js";

export const config = { maxDuration: 30 };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // O APK chama de outra origem: preflight e cabeçalhos antes de qualquer
  // checagem de método (OPTIONS cairia no 405 logo abaixo).
  if (corsDoApp(req, res)) return;

  if (req.method !== "POST" && req.method !== "PATCH" && req.method !== "DELETE") {
    res.status(405).json({ ok: false, error: "Use POST (criar), PATCH (alterar) ou DELETE (excluir)" });
    return;
  }

  try {
    const admin = adminClient();

    const user = await getUserFromBearer(admin, req.headers.authorization);
    if (!user) {
      res.status(401).json({ ok: false, error: "Não autenticado" });
      return;
    }

    const escopo = await escopoAdmin(admin, user.id);
    if (escopo !== null && escopo.length === 0) {
      res.status(403).json({ ok: false, error: "Apenas o master e administradores gerenciam usuários." });
      return;
    }

    if (req.method === "POST") {
      await criar(req, res, admin, escopo, user.id);
    } else if (req.method === "PATCH") {
      await atualizar(req, res, admin, escopo, user.id);
    } else {
      await excluir(req, res, admin, escopo, user.id);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
}

type Admin = ReturnType<typeof adminClient>;

// Registro de alterações. Na criação e na alteração é "melhor esforço" (sem a
// migração 46 a operação segue); na exclusão é obrigatório (ver excluir).
async function registrar(
  admin: Admin, userId: string, acao: string, detalhes: Record<string, unknown>, autorId: string
): Promise<string | null> {
  const { error } = await admin.rpc("fn_log_usuario", {
    p_user: userId, p_acao: acao, p_detalhes: detalhes, p_autor: autorId,
  });
  if (error) console.error(`usuarios_historico (${acao}): ${error.message}`);
  return error ? error.message : null;
}

// ─── POST: cria o login e já vincula à empresa com um cargo ──
async function criar(req: VercelRequest, res: VercelResponse, admin: Admin, escopo: string[] | null, callerId: string) {
  const email = str(req.body?.email);
  const senha = typeof req.body?.senha === "string" ? req.body.senha : "";
  const nome = str(req.body?.nome);
  const empresaId = str(req.body?.empresaId);
  const papel = str(req.body?.papel);

  if (!email) { res.status(400).json({ ok: false, error: "Informe o e-mail." }); return; }
  const eEmail = erroEmail(email);
  if (eEmail) { res.status(400).json({ ok: false, error: eEmail }); return; }
  const eSenha = erroSenha(senha);
  if (eSenha) { res.status(400).json({ ok: false, error: eSenha }); return; }
  // O administrador de empresa sempre cria dentro da empresa dele. O master pode
  // criar sem empresa (quem só usa o RH, ou terá os acessos definidos depois).
  if (!empresaId && escopo !== null) {
    res.status(400).json({ ok: false, error: "Escolha a empresa do usuário." });
    return;
  }
  if (empresaId) {
    if (!papel) { res.status(400).json({ ok: false, error: "Escolha o cargo do usuário." }); return; }
    if (!podeNaEmpresa(escopo, empresaId)) {
      res.status(403).json({ ok: false, error: "Você não administra esta empresa." });
      return;
    }
    if (!(await cargoExiste(admin, papel))) {
      res.status(400).json({ ok: false, error: `Cargo desconhecido: ${papel}` });
      return;
    }
  }

  // email_confirm: o login é criado por um administrador, não há e-mail de
  // confirmação para o usuário clicar — ele já entra com a senha combinada.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: nome ? { nome } : undefined,
  });
  if (error || !data.user) {
    const msg = error?.message ?? "Não foi possível criar o login.";
    const jaExiste = /already|registered|exists/i.test(msg);
    res.status(jaExiste ? 409 : 400).json({
      ok: false,
      error: jaExiste ? `Já existe um login com o e-mail ${email}.` : msg,
    });
    return;
  }

  const userId = data.user.id;

  // Perfil e vínculo. Se algum falhar, o login já existe no Auth — devolve o
  // motivo em vez de fingir sucesso; refazer pelo mesmo formulário cai no 409
  // acima, então a mensagem diz o que sobrou por fazer.
  const { error: ePerfil } = await admin
    .from("perfis")
    .upsert({ user_id: userId, nome }, { onConflict: "user_id" });
  if (ePerfil) {
    res.status(500).json({ ok: false, error: `Login criado, mas o perfil falhou: ${ePerfil.message}` });
    return;
  }

  if (!empresaId) {
    await registrar(admin, userId, "criado", { financeiro: null }, callerId);
    res.status(200).json({ ok: true, userId });
    return;
  }

  const { error: eVinculo } = await admin
    .from("empresa_membros")
    .upsert({ empresa_id: empresaId, user_id: userId, papel }, { onConflict: "empresa_id,user_id" });
  if (eVinculo) {
    res.status(500).json({
      ok: false,
      error: `Login criado, mas o vínculo com a empresa falhou: ${eVinculo.message}. Vincule por Empresas › Membros.`,
    });
    return;
  }

  const [{ data: empresa }, { data: cargo }] = await Promise.all([
    admin.from("empresas").select("nome").eq("id", empresaId).maybeSingle(),
    admin.from("cargos").select("nome").eq("chave", papel).maybeSingle(),
  ]);
  await registrar(admin, userId, "criado", {
    financeiro: { empresa: empresa?.nome ?? null, empresaId, cargo: cargo?.nome ?? papel },
  }, callerId);

  res.status(200).json({ ok: true, userId });
}

// ─── PATCH: altera nome, e-mail e/ou senha ──────────────────
async function atualizar(
  req: VercelRequest, res: VercelResponse, admin: Admin, escopo: string[] | null, callerId: string
) {
  const userId = str(req.body?.userId);
  const email = str(req.body?.email);
  const nomeRaw = req.body?.nome;
  const nome = typeof nomeRaw === "string" ? nomeRaw.trim() : null;
  const senha = typeof req.body?.senha === "string" && req.body.senha ? req.body.senha : null;

  if (!userId) { res.status(400).json({ ok: false, error: "Informe o usuário." }); return; }
  if (!email && nome === null && !senha) {
    res.status(400).json({ ok: false, error: "Nada para alterar." });
    return;
  }

  const permissao = await podeGerenciar(admin, escopo, userId);
  if (!permissao.ok) { res.status(403).json({ ok: false, error: permissao.erro }); return; }

  if (email) {
    const e = erroEmail(email);
    if (e) { res.status(400).json({ ok: false, error: e }); return; }
  }
  if (senha) {
    const e = erroSenha(senha);
    if (e) { res.status(400).json({ ok: false, error: e }); return; }
  }

  // Como estava antes, para o registro de alterações.
  const [{ data: antesAuth }, { data: antesPerfil }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("perfis").select("nome").eq("user_id", userId).maybeSingle(),
  ]);
  const emailAntes = antesAuth?.user?.email ?? null;
  const nomeAntes = (antesPerfil?.nome as string | null | undefined) ?? null;

  // E-mail e senha: só a Admin API. email_confirm mantém o login válido na
  // hora — sem ele o Supabase deixaria o e-mail pendente de confirmação e a
  // pessoa continuaria entrando pelo antigo.
  if (email || senha) {
    const patch: { email?: string; password?: string; email_confirm?: boolean } = {};
    if (email) { patch.email = email; patch.email_confirm = true; }
    if (senha) patch.password = senha;

    const { error } = await admin.auth.admin.updateUserById(userId, patch);
    if (error) {
      const msg = error.message ?? "Não foi possível alterar o cadastro.";
      const emUso = /already|registered|exists/i.test(msg);
      res.status(emUso ? 409 : 400).json({
        ok: false,
        error: emUso ? `Já existe outro login com o e-mail ${email}.` : msg,
      });
      return;
    }
  }

  if (nome !== null) {
    const { error } = await admin
      .from("perfis")
      .upsert({ user_id: userId, nome: nome || null }, { onConflict: "user_id" });
    if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
  }

  const mudancas: Record<string, unknown> = {};
  if (email && email.toLowerCase() !== (emailAntes ?? "").toLowerCase()) mudancas.email = { antes: emailAntes, depois: email };
  if (nome !== null && (nome || null) !== nomeAntes) mudancas.nome = { antes: nomeAntes, depois: nome || null };
  if (senha) mudancas.senha = true; // só o fato — a senha nunca é gravada
  if (Object.keys(mudancas).length > 0) await registrar(admin, userId, "alterado", mudancas, callerId);

  // Trocar a própria senha/e-mail invalida a sessão atual no Supabase: a tela
  // avisa para entrar de novo em vez de deixar a pessoa clicando em erro.
  res.status(200).json({ ok: true, reautenticar: userId === callerId && !!(senha || email) });
}

// ─── DELETE: exclui o login, guardando o registro ───────────
// Só o master. Ordem: registra (com a foto do que a pessoa tinha) → tira os
// acessos → exclui o login no Auth ("suave": o registro técnico fica, o e-mail
// é embaralhado e pode ser usado de novo). Se o registro falhar, nada é excluído.
async function excluir(
  req: VercelRequest, res: VercelResponse, admin: Admin, escopo: string[] | null, callerId: string
) {
  const userId = str(req.body?.userId);
  const motivo = str(req.body?.motivo);

  if (escopo !== null) {
    res.status(403).json({ ok: false, error: "Só o administrador (master) exclui logins." });
    return;
  }
  if (!userId) { res.status(400).json({ ok: false, error: "Informe o usuário." }); return; }
  if (userId === callerId) {
    res.status(400).json({ ok: false, error: "Você não pode excluir o próprio login." });
    return;
  }

  const { data: alvo, error: eAlvo } = await admin.auth.admin.getUserById(userId);
  if (eAlvo || !alvo?.user) { res.status(404).json({ ok: false, error: "Login não encontrado." }); return; }

  const [{ data: perfil }, { data: vinculos }, { data: rh }, { data: empresas }, { data: cargos }, { data: gestao }] = await Promise.all([
    admin.from("perfis").select("nome, is_master").eq("user_id", userId).maybeSingle(),
    admin.from("empresa_membros").select("empresa_id, papel").eq("user_id", userId),
    admin.from("rh_acessos").select("*").eq("user_id", userId).maybeSingle(),
    admin.from("empresas").select("id, nome"),
    admin.from("cargos").select("chave, nome"),
    // Sem a migração 54 a tabela não existe: conta como não liberado.
    admin.from("gestao_acessos").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  const nomeEmpresa = (id: string) => (empresas ?? []).find((e) => e.id === id)?.nome ?? null;
  const nomeCargo = (chave: string) => (cargos ?? []).find((c) => c.chave === chave)?.nome ?? chave;
  const rhLinha = rh as { perfil?: string | null; empresas?: string[] | null; empresa?: string | null } | null;

  const foto = {
    motivo,
    email: alvo.user.email ?? null,
    nome: (perfil?.nome as string | null | undefined) ?? null,
    administracao: !!perfil?.is_master,
    gestao: !!gestao,
    financeiro: (vinculos ?? []).map((v) => ({
      empresaId: v.empresa_id, empresa: nomeEmpresa(v.empresa_id as string), cargo: nomeCargo(v.papel as string),
    })),
    rh: rhLinha
      ? { perfil: rhLinha.perfil ?? null, empresas: rhLinha.empresas ?? (rhLinha.empresa ? [rhLinha.empresa] : null) }
      : null,
  };

  const erroRegistro = await registrar(admin, userId, "excluido", foto, callerId);
  if (erroRegistro) {
    res.status(500).json({
      ok: false,
      error: `Nada foi excluído: não deu para gravar o registro de alterações (${erroRegistro}). Confira a migração 46.`,
    });
    return;
  }

  const passos = [
    await admin.from("empresa_membros").delete().eq("user_id", userId),
    await admin.from("rh_acessos").delete().eq("user_id", userId),
    await admin.from("perfis").update({ is_master: false }).eq("user_id", userId),
  ];
  // Liberação da Gestão (migração 54). Tabela ausente não impede a exclusão.
  const gestaoApagada = await admin.from("gestao_acessos").delete().eq("user_id", userId);
  if (gestaoApagada.error && !["42P01", "PGRST205"].includes(gestaoApagada.error.code ?? "")) passos.push(gestaoApagada);
  const falhaAcesso = passos.find((p) => p.error)?.error;
  if (falhaAcesso) {
    res.status(500).json({ ok: false, error: `Registro gravado, mas não deu para tirar os acessos: ${falhaAcesso.message}` });
    return;
  }

  const { error: eDel } = await admin.auth.admin.deleteUser(userId, true);
  if (eDel) {
    res.status(500).json({
      ok: false,
      error: `Os acessos foram retirados, mas o login não foi excluído: ${eDel.message}`,
    });
    return;
  }

  res.status(200).json({ ok: true, userId });
}
