import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createMockClient } from "@/lib/mock";

// ─── Modo de dados ──────────────────────────────────────────────────────────
// PROTÓTIPO (padrão): banco simulado em memória com dados FICTÍCIOS — nada é
// lido nem gravado no Supabase real. Para apontar para um banco de verdade é
// preciso pedir explicitamente: VITE_DATA_MODE=real (+ as chaves abaixo).
export const DATA_MODE: "mock" | "real" = import.meta.env.VITE_DATA_MODE === "real" ? "real" : "mock";
export const isMock = DATA_MODE === "mock";

// Lidas do .env.local (prefixo VITE_ é obrigatório para o Vite expor ao browser).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const hasSupabaseEnv = isMock || Boolean(supabaseUrl && supabaseAnonKey);

if (!isMock && !hasSupabaseEnv && import.meta.env.DEV) {
  console.warn(
    "[supabase] VITE_DATA_MODE=real sem VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. " +
      "Preencha o arquivo .env.local e reinicie o `npm run dev`."
  );
}

// O cliente simulado implementa o mesmo subconjunto da API usado pelo app
// (ver src/lib/mock/client.ts); o cast mantém a tipagem do supabase-js nas queries.
export const supabase: SupabaseClient = isMock
  ? (createMockClient() as unknown as SupabaseClient)
  : createClient(
      supabaseUrl ?? "http://localhost:54321",
      supabaseAnonKey ?? "public-anon-key",
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }
    );
