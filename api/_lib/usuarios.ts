// Autorização da aba Usuários. Roda sob service role, onde auth.uid() não
// existe — então os helpers de RLS do banco não servem e a regra é checada
// aqui, direto nas tabelas (mesma abordagem de userPodeSincronizar).
//
// A regra é a mesma da migração 40, repetida de propósito: a listagem da tela
// e a gravação são caminhos independentes, e cada um se defende sozinho.
import type { SupabaseClient } from "@supabase/supabase-js";

// Empresas onde o usuário é 'admin'. `null` = master (todas, sem restrição).
// Array vazio = não administra nada, não pode gerir usuário nenhum.
export async function escopoAdmin(
  admin: SupabaseClient,
  userId: string
): Promise<string[] | null> {
  const { data: perfil } = await admin
    .from("perfis")
    .select("is_master")
    .eq("user_id", userId)
    .maybeSingle();
  if (perfil?.is_master) return null;

  const { data: vinculos } = await admin
    .from("empresa_membros")
    .select("empresa_id")
    .eq("user_id", userId)
    .eq("papel", "admin");
  return (vinculos ?? []).map((v) => v.empresa_id as string);
}

// Pode mexer no cadastro de `alvoId`? Master pode em qualquer um. Admin só em
// quem divide com ele uma empresa que ele administra — e nunca num master,
// que senão um admin de uma empresa qualquer tomaria a conta do dono.
export async function podeGerenciar(
  admin: SupabaseClient,
  escopo: string[] | null,
  alvoId: string
): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (escopo === null) return { ok: true };
  if (escopo.length === 0) return { ok: false, erro: "Sem permissão para gerenciar usuários." };

  const { data: perfilAlvo } = await admin
    .from("perfis")
    .select("is_master")
    .eq("user_id", alvoId)
    .maybeSingle();
  if (perfilAlvo?.is_master) {
    return { ok: false, erro: "Só o master pode alterar o cadastro de outro master." };
  }

  const { data: vinculo } = await admin
    .from("empresa_membros")
    .select("empresa_id")
    .eq("user_id", alvoId)
    .in("empresa_id", escopo)
    .limit(1)
    .maybeSingle();
  if (!vinculo) {
    return { ok: false, erro: "Este usuário não pertence a nenhuma empresa que você administra." };
  }
  return { ok: true };
}

// Pode vincular alguém a esta empresa? (criar usuário / escolher a empresa)
export function podeNaEmpresa(escopo: string[] | null, empresaId: string): boolean {
  return escopo === null || escopo.includes(empresaId);
}

// O cargo existe no catálogo? Impede inventar papel na chamada da API — a FK
// de empresa_membros.papel já barraria, mas o erro sairia como jargão do banco.
export async function cargoExiste(admin: SupabaseClient, papel: string): Promise<boolean> {
  const { data } = await admin.from("cargos").select("chave").eq("chave", papel).maybeSingle();
  return !!data;
}

// Validações de formato, iguais às que o Supabase Auth aplica — checadas aqui
// para a tela receber uma frase em português em vez do erro cru da Admin API.
export function erroEmail(email: string): string | null {
  const e = email.trim();
  if (!e) return "Informe o e-mail.";
  if (e.length > 255) return "E-mail muito longo.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "E-mail inválido.";
  return null;
}

export function erroSenha(senha: string): string | null {
  if (senha.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  if (senha.length > 72) return "A senha pode ter no máximo 72 caracteres.";
  return null;
}
