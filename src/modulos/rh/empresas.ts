// Empresas no RH. O RH grava a empresa como texto em cada registro ("Laportec");
// o cadastro de empresas (Configurações › Empresas e cargos) diz quais empresas usam o
// RH, o Financeiro ou os dois (supabase/44_empresas_por_modulo.sql). A empresa
// ativa do topo vale para os dois pilares, como no Financeiro.

// Lista usada só se o cadastro ainda não informar os módulos (banco sem a migração 44).
// É a mesma lista padrão do RHApp.jsx.
export const EMPRESAS_RH = ["Laportec", "Avora", "Zaytan"] as const;

// "" = todas as empresas do grupo. Só para quem tem o RH sem restrição de
// empresa — é a visão que o fechamento da competência da folha exige.
export const TODAS_EMPRESAS_RH = "";

export type Modulo = "financeiro" | "rh";
export const MODULOS: { valor: Modulo; nome: string }[] = [
  { valor: "financeiro", nome: "Financeiro" },
  { valor: "rh", nome: "RH" },
];

const chave = (s: string) => s.trim().toLowerCase();

export function semRepetir(nomes: readonly string[]): string[] {
  const lista: string[] = [];
  for (const nome of nomes) {
    if (nome && !lista.some((x) => chave(x) === chave(nome))) lista.push(nome);
  }
  return lista;
}

// Empresas que a pessoa pode escolher no RH. `cadastro` = empresas com o módulo
// RH (fn_empresas_rh, já filtradas pelo acesso). `empresas` do acesso: null = todas.
export function empresasDoRH(
  acesso: { liberado: boolean; empresas: readonly string[] | null },
  cadastro: readonly string[],
): string[] {
  if (!acesso.liberado) return [];
  const base = semRepetir(cadastro);
  if (acesso.empresas === null) return base;
  // Acesso restrito: as empresas dele que ainda estão no cadastro do RH, com a grafia de lá.
  return semRepetir(
    acesso.empresas
      .map((e) => base.find((b) => chave(b) === chave(e)))
      .filter((e): e is string => !!e),
  );
}

// Empresa do RH que corresponde a um nome do Financeiro — a mesma regra do banco
// (rh_empresa_corresponde): nome igual, ou o do Financeiro começa pelo do RH.
export function empresaRHDoFinanceiro(nomeFinanceiro: string | null | undefined, lista: readonly string[]): string | null {
  if (!nomeFinanceiro) return null;
  const fin = chave(nomeFinanceiro);
  return lista.find((rh) => fin === chave(rh) || fin.startsWith(`${chave(rh)} `)) ?? null;
}

// Empresa do RH ao entrar: a última escolhida (se ainda vale) → a que casa com a
// empresa ativa do Financeiro → a primeira da lista.
export function escolherEmpresaRH(opcoes: {
  lista: readonly string[];
  podeTodas: boolean;
  salva: string | null;
  nomeFinanceiro?: string | null;
}): string {
  const { lista, podeTodas, salva, nomeFinanceiro } = opcoes;
  if (salva !== null && (salva === TODAS_EMPRESAS_RH ? podeTodas : lista.includes(salva))) return salva;
  return empresaRHDoFinanceiro(nomeFinanceiro, lista) ?? lista[0] ?? TODAS_EMPRESAS_RH;
}

// Rótulo curto dos módulos de uma empresa.
export function nomeModulos(modulos: readonly string[]): string {
  const tem = (m: Modulo) => modulos.includes(m);
  if (tem("financeiro") && tem("rh")) return "Financeiro e RH";
  if (tem("rh")) return "Só RH";
  return "Só Financeiro";
}
