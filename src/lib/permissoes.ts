// Cargos configuráveis (RBAC dinâmico). As permissões vivem no banco
// (tabelas cargos/cargo_capacidades, migração 29); aqui fica só o CATÁLOGO
// estável de capacidades e o mapa rota→capacidade que a UI usa.
//
// Modelo: um cargo é um nome + um conjunto de capacidades (flags). A UI usa
// isto p/ mostrar páginas/botões; o banco (RLS) é a fonte de verdade da
// gravação. Leitura segue liberada a qualquer membro da empresa.
//
// Zaytan Hub (Financeiro + RH + Gestão): as telas consolidadas juntam abas que
// antes eram páginas com capacidades diferentes. Por isso uma rota pede UMA
// das capacidades da lista e cada aba confere a sua (src/lib/navegacao.ts).

// Chave interna do cargo (ex.: 'admin', 'operador', 'c_ab12…'). É texto livre.
export type Papel = string;

export type Capacidade =
  | "ver_dashboard"
  | "ver_relatorios"
  | "mov_gerir"
  | "contas_gerir"
  | "clientes_gerir"
  | "plano_gerir"
  | "config_gerir"
  | "vendas_gerir"
  | "pag_diario_gerir"
  | "rh_acessar"
  | "gestao_acessar";

// Catálogo exibido na tela de Cargos (ordem = ordem dos checkboxes).
export const CAPACIDADES: { chave: Capacidade; nome: string; desc: string }[] = [
  { chave: "ver_dashboard", nome: "Ver Fluxo e Projeção de Caixa", desc: "Caixa › Fluxo realizado e Projeção de caixa (leitura). A Gestão é do Administrador ou de quem for liberado em Usuários." },
  { chave: "ver_relatorios", nome: "Ver Análises financeiras", desc: "Financeiro › Análise financeira e exportações (leitura)." },
  { chave: "mov_gerir", nome: "Lançar e editar movimentações", desc: "Caixa › Movimentações e Extratos (importar, revisar, conferir)." },
  { chave: "contas_gerir", nome: "Gerenciar Contas a Pagar e Recorrentes", desc: "Pagamentos: contas, recorrências e dívidas/acordos." },
  { chave: "clientes_gerir", nome: "Gerenciar Clientes", desc: "Receitas: clientes e cobranças." },
  { chave: "plano_gerir", nome: "Editar Plano de Contas", desc: "Categorias do plano de contas." },
  { chave: "config_gerir", nome: "Ajustes e configurações", desc: "Ajustes, contas bancárias e feriados." },
  { chave: "vendas_gerir", nome: "Registrar vendas", desc: "Receitas › Vendas (não mexe no saldo das contas)." },
  { chave: "pag_diario_gerir", nome: "Pagamentos diários (Pix)", desc: "Lista de Pix do dia e o histórico dela (inclui, só para leitura, os pagamentos diários lançados no RH). Sem esta permissão as chaves nem aparecem." },
];

// O RH NÃO é capacidade de cargo: quem entra nele é liberado pessoa a pessoa
// (tabela rh_acessos, Configurações › Usuários). `rh_acessar` é derivada desse acesso
// e só existe aqui para as rotas e o menu usarem a mesma engrenagem.
// A Gestão também não: `gestao_acessar` vale para o master, para o cargo
// Administrador na empresa ativa e para quem for liberado pessoa a pessoa
// (tabela gestao_acessos, migração 54) — ver lib/empresa.
export const TODAS_CAPACIDADES: Capacidade[] = [...CAPACIDADES.map((c) => c.chave), "rh_acessar", "gestao_acessar"];

// Vê a Gestão? Master, Administrador da empresa ativa ou liberado em Usuários.
export function podeVerGestao(isMaster: boolean, papel: Papel, liberado: boolean): boolean {
  return isMaster || papel === "admin" || liberado;
}

export function nomeCapacidade(cap: string): string {
  return CAPACIDADES.find((c) => c.chave === cap)?.nome ?? cap;
}

// Rota → capacidades aceitas (basta UMA). Rotas ausentes não exigem
// capacidade (ex.: telas de administração, tratadas no próprio componente).
const ROTA_CAP: Record<string, Capacidade[]> = {
  "/": ["gestao_acessar"],
  "/financeiro/caixa": ["mov_gerir", "ver_dashboard", "ver_relatorios"],
  "/financeiro/extratos": ["mov_gerir"],
  "/financeiro/pagamentos": ["contas_gerir", "pag_diario_gerir"],
  "/financeiro/receitas": ["clientes_gerir", "vendas_gerir"],
  "/financeiro/relatorios": ["ver_relatorios"],
  "/financeiro/plano-de-contas": ["plano_gerir"],
  "/financeiro/ajustes": ["config_gerir"],
  "/rh": ["rh_acessar"],
};

// Capacidades aceitas por uma rota (match exato ou pelo prefixo mais longo,
// sempre em fronteira de segmento: "/rh" cobre "/rh/folha", não "/rhx").
export function rotaCapacidades(path: string): Capacidade[] | null {
  if (ROTA_CAP[path]) return ROTA_CAP[path];
  const hit = Object.keys(ROTA_CAP)
    .filter((r) => r !== "/" && path.startsWith(r + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? ROTA_CAP[hit] : null;
}

// Primeira capacidade aceita (compatibilidade com quem espera uma só).
export function rotaCapacidade(path: string): Capacidade | null {
  return rotaCapacidades(path)?.[0] ?? null;
}

export function temAlguma(caps: Set<string>, lista: readonly string[] | null | undefined): boolean {
  return !lista || lista.length === 0 || lista.some((c) => caps.has(c));
}

export function podeAcessar(caps: Set<string>, path: string): boolean {
  return temAlguma(caps, rotaCapacidades(path));
}

export function temCap(caps: Set<string>, cap: Capacidade): boolean {
  return caps.has(cap);
}

// A aba Usuários fica FORA do catálogo de capacidades de propósito: definir a
// senha de outra pessoa é poder demais para virar um checkbox que qualquer
// cargo novo possa ganhar. É master + admin, e ponto — a função server-side
// (/api/usuarios) confere a mesma regra por conta própria.
export function podeGerirUsuarios(isMaster: boolean, papel: Papel): boolean {
  return isMaster || papel === "admin";
}

// "Casa" de cada cargo, em ordem de preferência. Cargos enxutos (ex.: só
// Pagamentos Diários, ou só RH) não devem cair no Dashboard da Gestão logo
// depois do login — vão direto para a área que usam.
const ENTRADAS: [string, Capacidade[]][] = [
  ["/", ["gestao_acessar"]],
  ["/financeiro/caixa", ["mov_gerir"]],
  ["/financeiro/pagamentos", ["contas_gerir", "pag_diario_gerir"]],
  ["/financeiro/receitas", ["clientes_gerir", "vendas_gerir"]],
  ["/financeiro/extratos", ["mov_gerir"]],
  ["/financeiro/relatorios", ["ver_relatorios"]],
  ["/rh", ["rh_acessar"]],
  // Cargos que só mexem em configuração (plano de contas, ajustes) caem na
  // área única de Configurações — ela abre para qualquer login.
  ["/configuracoes", ["plano_gerir", "config_gerir"]],
];

export type RotaEntrada = string;

// Primeira página que o cargo consegue abrir (cai em "/" se nenhuma serve —
// aí a tela de acesso restrito é mesmo a resposta certa).
export function primeiraRotaPermitida(caps: Set<string>): RotaEntrada {
  return ENTRADAS.find(([, lista]) => temAlguma(caps, lista))?.[0] ?? "/";
}
