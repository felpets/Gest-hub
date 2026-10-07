import type { SupabaseClient } from "@supabase/supabase-js";

// No banco real as tabelas do RH ficam no projeto do Financeiro com o prefixo
// rh_ e os arquivos nos buckets rh-* (supabase/42_rh_modulo.sql). O RHApp segue
// pedindo "funcionarios" e "documentos", como no CRM RH; a tradução é aqui.
export const PREFIXO_TABELA_RH = "rh_";
export const BUCKETS_RH: Record<string, string> = {
  documentos: "rh-documentos",
  extratos: "rh-extratos",
};

export function tabelaRH(nome: string): string {
  return nome.startsWith(PREFIXO_TABELA_RH) ? nome : PREFIXO_TABELA_RH + nome;
}

export function bucketRH(nome: string): string {
  return BUCKETS_RH[nome] ?? `rh-${nome}`;
}

// Mesmo login e mesma sessão do Financeiro: só o nome das tabelas e buckets muda.
export function clienteRH(base: SupabaseClient) {
  return {
    from: (tabela: string) => base.from(tabelaRH(tabela)),
    storage: { from: (bucket: string) => base.storage.from(bucketRH(bucket)) },
    auth: base.auth,
  };
}
