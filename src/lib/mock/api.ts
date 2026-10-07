// ─── Funções server-side (/api/*) simuladas no protótipo ───────────────────
// Em produção, /api/usuarios e /api/inter/sync rodam na Vercel com a service
// role. No protótipo não há servidor: estas versões aplicam as MESMAS regras
// de autorização (api/_lib/usuarios.ts) sobre o banco fictício.
import { tabela, uuid, marcarAlterado } from "./db";
import { isMaster, uid } from "./acl";
import { escopoAdmin } from "./rpc";
import { registrarHistoricoUsuario } from "./triggers";

type Resp = { ok: boolean; error?: string; userId?: string; reautenticar?: boolean };
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function erroSenha(s: string): string | null {
  if (s.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  if (s.length > 72) return "A senha pode ter no máximo 72 caracteres.";
  return null;
}

function podeGerenciar(escopo: string[] | null, alvo: string): boolean {
  if (escopo === null) return true;
  if (tabela("perfis").find((p) => p.user_id === alvo)?.is_master) return false;
  return tabela("empresa_membros").some((m) => m.user_id === alvo && escopo.includes(String(m.empresa_id)));
}

export async function mockApiUsuarios(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>): Promise<Resp> {
  await new Promise((r) => setTimeout(r, 250));
  if (!uid()) return { ok: false, error: "Não autenticado" };
  const escopo = escopoAdmin();
  if (escopo !== null && escopo.length === 0) {
    return { ok: false, error: "Apenas o master e administradores gerenciam usuários." };
  }
  const users = tabela("auth.users");

  if (method === "POST") {
    const email = str(body.email);
    const senha = typeof body.senha === "string" ? body.senha : "";
    const nome = str(body.nome);
    const empresaId = str(body.empresaId);
    const papel = str(body.papel);
    if (!email) return { ok: false, error: "Informe o e-mail." };
    if (!EMAIL_RE.test(email)) return { ok: false, error: "E-mail inválido." };
    const eS = erroSenha(senha);
    if (eS) return { ok: false, error: eS };
    if (!empresaId && escopo !== null) return { ok: false, error: "Escolha a empresa do usuário." };
    if (empresaId) {
      if (!papel) return { ok: false, error: "Escolha o cargo do usuário." };
      if (escopo !== null && !escopo.includes(empresaId)) return { ok: false, error: "Você não administra esta empresa." };
      if (!tabela("cargos").some((c) => c.chave === papel)) return { ok: false, error: `Cargo desconhecido: ${papel}` };
    }
    if (users.some((u) => !u.deleted_at && String(u.email).toLowerCase() === email.toLowerCase())) {
      return { ok: false, error: `Já existe um login com o e-mail ${email}.` };
    }
    const id = uuid();
    users.push({ id, email, senha, nome, user_metadata: nome ? { nome } : {}, created_at: new Date().toISOString(), last_sign_in_at: null });
    tabela("perfis").push({ user_id: id, is_master: false, criado_em: new Date().toISOString(), nome });
    if (empresaId) tabela("empresa_membros").push({ empresa_id: empresaId, user_id: id, papel, criado_em: new Date().toISOString() });
    registrarHistoricoUsuario(id, "criado", {
      financeiro: empresaId
        ? {
            empresaId,
            empresa: tabela("empresas").find((e) => e.id === empresaId)?.nome ?? null,
            cargo: tabela("cargos").find((c) => c.chave === papel)?.nome ?? papel,
          }
        : null,
    });
    marcarAlterado();
    return { ok: true, userId: id };
  }

  if (method === "DELETE") {
    const userId = str(body.userId);
    const motivo = str(body.motivo);
    if (escopo !== null) return { ok: false, error: "Só o administrador (master) exclui logins." };
    if (!userId) return { ok: false, error: "Informe o usuário." };
    if (userId === uid()) return { ok: false, error: "Você não pode excluir o próprio login." };
    const alvo = users.find((u) => u.id === userId && !u.deleted_at);
    if (!alvo) return { ok: false, error: "Login não encontrado." };
    const perfil = tabela("perfis").find((p) => p.user_id === userId);
    const rh = tabela("rh_acessos").find((a) => a.user_id === userId);
    registrarHistoricoUsuario(userId, "excluido", {
      motivo,
      email: alvo.email,
      nome: perfil?.nome ?? null,
      administracao: !!perfil?.is_master,
      gestao: tabela("gestao_acessos").some((g) => g.user_id === userId),
      financeiro: tabela("empresa_membros").filter((m) => m.user_id === userId).map((m) => ({
        empresaId: m.empresa_id,
        empresa: tabela("empresas").find((e) => e.id === m.empresa_id)?.nome ?? null,
        cargo: tabela("cargos").find((c) => c.chave === m.papel)?.nome ?? m.papel,
      })),
      rh: rh ? { perfil: rh.perfil ?? null, empresas: rh.empresas ?? null } : null,
    });
    // Mesmo efeito do servidor: sem acessos e login "excluído" (o registro técnico fica).
    const membros = tabela("empresa_membros");
    membros.splice(0, membros.length, ...membros.filter((m) => m.user_id !== userId));
    const acessos = tabela("rh_acessos");
    acessos.splice(0, acessos.length, ...acessos.filter((a) => a.user_id !== userId));
    const gestao = tabela("gestao_acessos");
    gestao.splice(0, gestao.length, ...gestao.filter((g) => g.user_id !== userId));
    if (perfil) perfil.is_master = false;
    alvo.deleted_at = new Date().toISOString();
    alvo.email = `excluido+${userId.slice(0, 8)}@removido.invalid`;
    alvo.senha = null;
    marcarAlterado();
    return { ok: true, userId };
  }

  const userId = str(body.userId);
  const email = str(body.email);
  const nome = typeof body.nome === "string" ? body.nome.trim() : null;
  const senha = typeof body.senha === "string" && body.senha ? body.senha : null;
  if (!userId) return { ok: false, error: "Informe o usuário." };
  if (!email && nome === null && !senha) return { ok: false, error: "Nada para alterar." };
  if (userId !== uid() && !podeGerenciar(escopo, userId)) return { ok: false, error: "Você não pode alterar este usuário." };
  const u = users.find((x) => x.id === userId);
  if (!u) return { ok: false, error: "Usuário não encontrado." };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "E-mail inválido." };
  if (senha) {
    const eS = erroSenha(senha);
    if (eS) return { ok: false, error: eS };
  }
  if (email && users.some((x) => x.id !== userId && String(x.email).toLowerCase() === email.toLowerCase())) {
    return { ok: false, error: `Já existe um login com o e-mail ${email}.` };
  }
  const mudancas: Record<string, unknown> = {};
  if (email && email.toLowerCase() !== String(u.email).toLowerCase()) mudancas.email = { antes: u.email, depois: email };
  const nomeAntes = tabela("perfis").find((x) => x.user_id === userId)?.nome ?? null;
  if (nome !== null && (nome || null) !== nomeAntes) mudancas.nome = { antes: nomeAntes, depois: nome || null };
  if (senha) mudancas.senha = true;
  if (Object.keys(mudancas).length > 0) registrarHistoricoUsuario(userId, "alterado", mudancas);
  if (email) u.email = email;
  if (senha) u.senha = senha;
  if (nome !== null) {
    u.nome = nome;
    const p = tabela("perfis").find((x) => x.user_id === userId);
    if (p) p.nome = nome || null;
  }
  marcarAlterado();
  return { ok: true, reautenticar: userId === uid() && (!!email || !!senha) };
}

// Sincronização Banco Inter: no protótipo não existe banco para consultar.
export async function mockApiInterSync(): Promise<{ ok: boolean; error?: string; inserted: number; skipped: number }> {
  await new Promise((r) => setTimeout(r, 400));
  return {
    ok: false,
    inserted: 0,
    skipped: 0,
    error: isMaster()
      ? "Protótipo: a integração com o Banco Inter não se conecta a banco real (dados fictícios)."
      : "Protótipo: integração bancária indisponível com dados fictícios.",
  };
}
