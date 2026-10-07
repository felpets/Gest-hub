// Ponto de entrada do modo protótipo: registra o seed (Financeiro + RH) e
// expõe o cliente simulado. Importado só por src/lib/supabase.ts e pelo RH.
import { registrarSeed, resetMockDb, onDbChange } from "./db";
import { seedFinanceiro } from "./seed-financeiro";
import { seedRh } from "./seed-rh";
import { createMockClient } from "./client";
import { reiniciarSessao } from "./auth";

registrarSeed(() => ({ ...seedFinanceiro(), ...seedRh() }));

export { createMockClient, onDbChange };
export { mockApiUsuarios, mockApiInterSync } from "./api";
export { USUARIOS_DEMO, SENHA_DEMO, EMPRESAS_DEMO } from "./demo";

export function restaurarDadosDemo() {
  resetMockDb();
  reiniciarSessao();
}
