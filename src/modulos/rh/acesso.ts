import { useAuth } from "@/lib/auth";
import { useEmpresa } from "@/lib/empresa";
import { empresaRHDoFinanceiro } from "@/modulos/rh/empresas";

export { EMPRESAS_RH } from "@/modulos/rh/empresas";

export type AcessoRH = {
  liberado: boolean;
  perfil: string; // "" = administrador do RH | "rh" | "financeiro" | "recrutamento"
  empresa: string; // empresa em que o RH está trabalhando; "" = todas as empresas
  restrita: boolean; // o acesso da pessoa é de algumas empresas (não vê "todas")
  nome: string;
};

// Perfis do RH (os mesmos do CRM RH). "" = administrador do RH.
export const PERFIS_RH: { valor: string; nome: string; desc: string }[] = [
  { valor: "", nome: "Administrador", desc: "Tudo, inclusive Configurações do RH e reabrir fechamentos." },
  { valor: "rh", nome: "Operador", desc: "Tudo menos Configurações. Na folha: ajusta, confere e importa; não paga nem fecha." },
  { valor: "financeiro", nome: "Financeiro", desc: "Tudo menos Configurações. Na folha: confere, importa, paga e fecha." },
  { valor: "recrutamento", nome: "Recrutamento", desc: "Só o painel e o funil de candidatos (o banco bloqueia o resto)." },
];

export function nomePerfilRH(perfil: string | null | undefined): string {
  return PERFIS_RH.find((p) => p.valor === (perfil ?? ""))?.nome ?? String(perfil);
}

// Quem entra no RH, com que perfil e em qual empresa vem da tabela rh_acessos
// (supabase/42_rh_modulo.sql), carregada junto com empresa e cargo. É a mesma
// regra que o banco aplica nas tabelas rh_* — a tela só reflete.
//
// A empresa é a escolhida no topo, como no Financeiro. Telas da Gestão (que
// mostram o seletor do Financeiro) pedem `seguirFinanceiro` para usar a empresa
// ativa de lá, quando a pessoa tem RH nela.
export function useAcessoRH(opcoes: { seguirFinanceiro?: boolean } = {}): AcessoRH {
  const { user } = useAuth();
  const { rh, empresaRH, empresasRH, empresas, empresaId } = useEmpresa();
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const nome = typeof meta.nome === "string" && meta.nome ? meta.nome : user?.email ?? "Administrador";

  let empresa = empresaRH;
  if (opcoes.seguirFinanceiro) {
    const nomeFinanceiro = empresas.find((e) => e.id === empresaId)?.nome;
    empresa = empresaRHDoFinanceiro(nomeFinanceiro, empresasRH) ?? empresaRH;
  }
  return { liberado: rh.liberado, perfil: rh.perfil, empresa, restrita: rh.empresas !== null, nome };
}
