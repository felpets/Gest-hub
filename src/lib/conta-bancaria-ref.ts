// Referência de módulo da CONTA bancária ativa.
// Vive fora de queries.ts/empresa.tsx (mesma razão do empresa-ref):
// - empresa.tsx (EmpresaProvider) chama setQueryContaId ao trocar de conta/empresa.
// - queries.ts (fetchers de movimentações) chama getContaIdOrNull para filtrar.
// null = "Todas as contas" (consolidado) — é o padrão e um estado VÁLIDO,
// por isso não há variante que lança (diferente do getEmpresaId).
let currentContaId: string | null = null;

export function setQueryContaId(id: string | null): void {
  currentContaId = id;
}

export function getContaIdOrNull(): string | null {
  return currentContaId;
}
