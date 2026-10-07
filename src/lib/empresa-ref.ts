// Referência de módulo da empresa ativa.
// Vive fora de queries.ts/empresa.tsx para evitar import circular:
// - empresa.tsx (EmpresaProvider) chama setQueryEmpresaId ao resolver/trocar a empresa.
// - queries.ts (fetchers/mutations) chama getEmpresaId para filtrar/gravar por empresa.
let currentEmpresaId: string | null = null;

export function setQueryEmpresaId(id: string | null): void {
  currentEmpresaId = id;
}

export function getEmpresaIdOrNull(): string | null {
  return currentEmpresaId;
}

// Trava de segurança: nunca deve ser chamado sem empresa ativa
// (todas as queries usam enabled:!!empresaId e o AppShell só renderiza com empresa).
export function getEmpresaId(): string {
  if (!currentEmpresaId) {
    throw new Error("Nenhuma empresa ativa selecionada.");
  }
  return currentEmpresaId;
}
