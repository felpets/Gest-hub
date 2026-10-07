// Client Supabase server-side (service role — bypassa RLS) + autenticação/
// autorização do usuário chamador. SÓ roda nas funções Vercel (pasta api/);
// nunca importar deste arquivo no código do browser.
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  // Diz QUAL falta e em qual ambiente — sem isso, "faltam as duas" manda
  // procurar de novo o que já estava certo. Os três motivos de cair aqui são
  // salvar no ambiente errado, errar o nome e esquecer o redeploy, e cada um
  // deixa uma pista diferente nesta mensagem.
  const faltando = [
    !url ? "SUPABASE_URL" : null,
    !key ? "SUPABASE_SERVICE_ROLE_KEY" : null,
  ].filter(Boolean);

  if (faltando.length) {
    const ambiente = process.env.VERCEL_ENV ?? "desconhecido";
    const parecidas = Object.keys(process.env)
      .filter((k) => /SUPABASE/i.test(k))
      .sort()
      .join(", ") || "nenhuma";
    throw new Error(
      `Faltando na Vercel: ${faltando.join(" e ")}. ` +
      `A função está rodando no ambiente "${ambiente}" — confira se a variável foi salva NESSE ambiente e se houve deploy novo depois de salvar. ` +
      `Variáveis com "SUPABASE" no nome que chegaram aqui: ${parecidas}.`
    );
  }

  return createClient(url as string, key as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Valida o Bearer token (JWT do usuário logado no app) e devolve o usuário.
export async function getUserFromBearer(admin: SupabaseClient, authHeader?: string): Promise<User | null> {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}

// Autorização: master OU membro da empresa com capacidade 'mov_gerir'
// (mesma exigida pela RLS p/ gravar movimentações). Checado direto nas
// tabelas porque os helpers RLS usam auth.uid(), inexistente sob service role.
export async function userPodeSincronizar(
  admin: SupabaseClient,
  userId: string,
  empresaId: string
): Promise<boolean> {
  const { data: perfil } = await admin
    .from("perfis")
    .select("is_master")
    .eq("user_id", userId)
    .maybeSingle();
  if (perfil?.is_master) return true;

  const { data: vinculo } = await admin
    .from("empresa_membros")
    .select("papel")
    .eq("empresa_id", empresaId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!vinculo?.papel) return false;

  const { data: cap } = await admin
    .from("cargo_capacidades")
    .select("capacidade")
    .eq("cargo_chave", vinculo.papel)
    .eq("capacidade", "mov_gerir")
    .maybeSingle();
  return !!cap;
}
