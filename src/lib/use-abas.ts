import { useEmpresa } from "@/lib/empresa";
import { temAlguma } from "@/lib/permissoes";
import type { AbaDef } from "@/lib/navegacao";

// Abas que o cargo ativo pode abrir (mesma regra do guarda de rota).
export function useAbasPermitidas<T extends AbaDef>(defs: readonly T[], extra?: (a: T) => boolean): T[] {
  const { caps } = useEmpresa();
  return defs.filter((a) => temAlguma(caps, a.caps) && (extra ? extra(a) : true));
}

// Aba pedida na URL, se permitida; senão a primeira permitida.
export function abaAtiva<T extends { id: string }>(permitidas: readonly T[], pedida?: string): T | undefined {
  return permitidas.find((a) => a.id === pedida) ?? permitidas[0];
}

export const lerAba = (s: Record<string, unknown>) => (typeof s.aba === "string" && s.aba ? s.aba : undefined);
