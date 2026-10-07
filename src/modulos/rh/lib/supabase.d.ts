import type { SupabaseClient } from "@supabase/supabase-js";

// Cliente de dados do RH: simulado no protótipo; no modo real, o cliente do
// Financeiro com as tabelas rh_* (ver cliente-rh.ts). Só from/storage/auth.
export declare const supabase: Pick<SupabaseClient, "from" | "storage" | "auth">;
