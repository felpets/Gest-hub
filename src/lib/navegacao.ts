// ─── Mapa de navegação do Zaytan Hub (Financeiro · RH · Gestão) ────────────
// Fonte única para o menu lateral, para as abas das telas consolidadas e para
// a tradução entre as rotas do RH e os módulos internos do RHApp.
import {
  ArrowLeftRight, Banknote, BarChart3, Briefcase, Building2, CalendarClock, ClipboardList, CreditCard,
  FileSearch, FileText, FolderCheck, FolderTree, Gift, GraduationCap, HandCoins, LayoutDashboard,
  LineChart, ListChecks, LogOut, Receipt, Repeat, Scale, Settings, ShoppingCart, Sparkles,
  SlidersHorizontal, Star, Stethoscope, ToggleLeft, Upload, UserCog, Users, Wallet, CalendarRange,
  type LucideIcon,
} from "lucide-react";
import type { Capacidade } from "@/lib/permissoes";
import type { Funcionalidade } from "@/lib/funcionalidades";

export type Pilar = "financeiro" | "rh" | "gestao";

export type ItemMenu = {
  titulo: string;
  url: string;
  icon: LucideIcon;
  // Módulo do RH (para o filtro por perfil do RH). Só nos itens do pilar RH.
  moduloRH?: string;
  // Restrições que não são capacidade: "master" ou "gerir_usuarios".
  especial?: "master" | "gerir_usuarios";
  badge?: "pendentes" | "pix";
};

// Ordem do menu: Gestão → Financeiro → RH. A Gestão vem primeiro porque o
// Dashboard é a leitura gerencial do sistema inteiro; quem não tem acesso a
// ela simplesmente não vê o grupo (o filtro é o mesmo de sempre).
export const MENU: { pilar: Pilar; titulo: string; itens: ItemMenu[] }[] = [
  {
    pilar: "gestao",
    titulo: "Gestão",
    itens: [
      { titulo: "Dashboard", url: "/", icon: BarChart3 },
    ],
  },
  {
    pilar: "financeiro",
    titulo: "Financeiro",
    itens: [
      { titulo: "Caixa", url: "/financeiro/caixa", icon: ArrowLeftRight },
      { titulo: "Extratos", url: "/financeiro/extratos", icon: Upload, badge: "pendentes" },
      { titulo: "Pagamentos", url: "/financeiro/pagamentos", icon: Receipt, badge: "pix" },
      { titulo: "Receitas e vendas", url: "/financeiro/receitas", icon: HandCoins },
      { titulo: "Análise financeira", url: "/financeiro/relatorios", icon: LineChart },
    ],
  },
  {
    pilar: "rh",
    titulo: "RH",
    itens: [
      { titulo: "Painel do RH", url: "/rh", icon: LayoutDashboard, moduloRH: "dashboard" },
      { titulo: "Funcionários", url: "/rh/funcionarios", icon: Users, moduloRH: "funcionarios" },
      { titulo: "Treinamento", url: "/rh/treinamento", icon: GraduationCap, moduloRH: "funcionarios" },
      { titulo: "Recrutamento", url: "/rh/recrutamento", icon: Briefcase, moduloRH: "recrutamento" },
      { titulo: "Folha de pagamento", url: "/rh/folha", icon: Banknote, moduloRH: "pagamentos" },
    ],
  },
];

export function pilarDaRota(path: string): Pilar {
  if (path.startsWith("/financeiro")) return "financeiro";
  if (path === "/rh" || path.startsWith("/rh/")) return "rh";
  return "gestao";
}

// ─── Configurações: uma área só (engrenagem no topo) ───────────────────────
// Ajustes do Financeiro, Plano de contas, Configurações do RH, Usuários,
// Empresas e cargos e as funcionalidades opcionais deixaram o menu lateral e
// viraram seções desta página (/configuracoes?secao=…).
export type SecaoConfig = {
  id: string;
  titulo: string;
  desc: string;
  grupo: string;
  icon: LucideIcon;
  caps?: Capacidade[];
  especial?: "master" | "gerir_usuarios";
  moduloRH?: string;
};

export const SECOES_CONFIG: SecaoConfig[] = [
  { id: "geral", titulo: "Geral", desc: "Aparência e preferências deste login", grupo: "Geral", icon: SlidersHorizontal },
  {
    id: "financeiro", titulo: "Ajustes do Financeiro", grupo: "Financeiro", icon: Settings,
    desc: "Contas bancárias, regras automáticas, feriados e integração com o banco",
    caps: ["config_gerir"],
  },
  {
    id: "plano", titulo: "Plano de contas", grupo: "Financeiro", icon: FolderTree,
    desc: "Categorias de receita e despesa usadas em todo o sistema",
    caps: ["plano_gerir"],
  },
  {
    id: "rh", titulo: "Configurações do RH", grupo: "RH", icon: Users,
    desc: "Benefícios, cargos, jornada, adiantamento e dados do RH",
    caps: ["rh_acessar"], moduloRH: "config",
  },
  {
    id: "usuarios", titulo: "Usuários", grupo: "Usuários e permissões", icon: UserCog,
    desc: "Logins, acessos ao Financeiro e ao RH e registro de alterações",
    especial: "gerir_usuarios",
  },
  {
    id: "empresas", titulo: "Empresas e cargos", grupo: "Usuários e permissões", icon: Building2,
    desc: "Empresas, módulos, membros e o que cada cargo pode fazer",
    especial: "master",
  },
  {
    id: "funcionalidades", titulo: "Funcionalidades", grupo: "Funcionalidades", icon: ToggleLeft,
    desc: "Ligar ou desligar as partes opcionais do sistema",
    especial: "master",
  },
];

// Primeira seção da lista permitida (a página cai nela quando a URL não pede
// nenhuma, ou pede uma que o acesso não abre).
export function secaoConfigAtiva(permitidas: readonly SecaoConfig[], pedida?: string): SecaoConfig | undefined {
  return permitidas.find((s) => s.id === pedida) ?? permitidas[0];
}

// ─── Abas das telas consolidadas ───────────────────────────────────────────
export type AbaDef = {
  id: string;
  titulo: string;
  icon: LucideIcon;
  caps?: Capacidade[];
  // Aba de funcionalidade opcional: some quando ela está desligada em
  // Configurações › Funcionalidades (ver src/lib/funcionalidades.ts).
  funcionalidade?: Funcionalidade;
};

// Endereços antigos de abas que foram consolidadas continuam abrindo: o id
// velho vira o novo em vez de cair na primeira aba sem explicação.
const ABAS_RENOMEADAS: Record<string, Record<string, string>> = {
  // Pagamentos: a "Visão geral" repetia Contas do mês (e a agenda completa vive
  // no Dashboard); as Recorrências viraram uma seção de Contas do mês.
  pagamentos: { visao: "pix", recorrencias: "contas" },
};

// Seções do RH que viraram aba de outra seção. O endereço antigo continua
// abrindo (as rotas redirecionam), e o RHApp continua navegando pelo módulo.
export const SECAO_RH_RENOMEADA: Record<string, { secao: string; aba: string }> = {
  atestados: { secao: "funcionarios", aba: "atestados" },
};

export function abaRenomeada(tela: string, id?: string): string | undefined {
  return (id && ABAS_RENOMEADAS[tela]?.[id]) || id;
}

export const ABAS = {
  // Gestão › Dashboard = antigo Dashboard + antigos Relatórios + indicadores de pessoas.
  dashboard: [
    // A Gestão inteira é de quem tem gestao_acessar (Administrador ou liberado
    // em Usuários); Pessoas continua pedindo também o acesso ao RH.
    // O Histórico (o que já passou pelo extrato) e a Previsão (o que vem pela
    // frente) ficam lado a lado: é a leitura que o gestor faz de uma vez. As
    // Análises financeiras foram para o Caixa, perto dos lançamentos.
    { id: "visao", titulo: "Histórico", icon: LayoutDashboard, caps: ["gestao_acessar"] },
    { id: "projecao", titulo: "Projeção de caixa", icon: Sparkles, caps: ["gestao_acessar"] },
    { id: "pessoas", titulo: "Pessoas (RH)", icon: Users, caps: ["rh_acessar"] },
  ],
  // Financeiro › Caixa = Movimentações + Fluxo realizado + Análises financeiras
  // (veio da Gestão) + Cartões (o demonstrativo de gastos de cada cartão).
  // A Projeção de caixa mudou para a Gestão, ao lado do Histórico.
  caixa: [
    { id: "movimentacoes", titulo: "Movimentações", icon: ArrowLeftRight, caps: ["mov_gerir"] },
    { id: "fluxo", titulo: "Fluxo realizado", icon: LineChart, caps: ["ver_dashboard"] },
    { id: "analises", titulo: "Análises financeiras", icon: BarChart3, caps: ["ver_relatorios"] },
    { id: "cartoes", titulo: "Cartões", icon: CreditCard, caps: ["contas_gerir", "mov_gerir"] },
  ],
  // Financeiro › Extratos = Importar → Revisar/classificar → Conferir.
  extratos: [
    { id: "importar", titulo: "1. Importar", icon: Upload, caps: ["mov_gerir"] },
    { id: "revisar", titulo: "2. Revisar e classificar", icon: ListChecks, caps: ["mov_gerir"] },
    { id: "conferir", titulo: "3. Conferir com o banco", icon: FileSearch, caps: ["mov_gerir"] },
  ],
  // Financeiro › Pagamentos. O Pix do dia vem primeiro: é a tarefa diária.
  // Contas do mês absorveu as Recorrências (a regra e o que ela gera na mesma
  // tela) e a antiga Visão geral. Dívidas e acordos é opcional. Cartões foi
  // para o Caixa (o endereço antigo redireciona — ver routes/financeiro/pagamentos).
  pagamentos: [
    { id: "pix", titulo: "Pix do dia", icon: Wallet, caps: ["pag_diario_gerir"] },
    { id: "contas", titulo: "Contas do mês", icon: Receipt, caps: ["contas_gerir"] },
    { id: "dividas", titulo: "Dívidas e acordos", icon: Scale, caps: ["contas_gerir"], funcionalidade: "dividas_acordos" },
  ],
  // Financeiro › Receitas = Clientes + Cobranças (contas a receber) + Vendas.
  receitas: [
    { id: "clientes", titulo: "Clientes", icon: Users, caps: ["clientes_gerir"] },
    { id: "cobrancas", titulo: "Cobranças", icon: HandCoins, caps: ["clientes_gerir"] },
    { id: "vendas", titulo: "Vendas", icon: ShoppingCart, caps: ["vendas_gerir"] },
  ],
} satisfies Record<string, AbaDef[]>;

// ─── RH: rota ↔ módulo/sub-aba do RHApp ────────────────────────────────────
// Cada seção do pilar RH é uma rota; as sub-telas viram abas (?aba=).
// `modulo`/`sub` são os ids internos do RHApp (aba/sub), preservados.
export type AbaRH = { id: string; titulo: string; icon: LucideIcon; modulo: string; sub: string };

export const SECOES_RH: Record<string, { titulo: string; subtitulo: string; abas: AbaRH[] }> = {
  "": {
    titulo: "Painel do RH",
    subtitulo: "Pendências e indicadores do dia a dia de pessoas",
    abas: [{ id: "painel", titulo: "Painel", icon: LayoutDashboard, modulo: "dashboard", sub: "" }],
  },
  funcionarios: {
    titulo: "Funcionários",
    subtitulo: "Cadastro, benefícios, dados bancários e documentos",
    abas: [
      { id: "lista", titulo: "Lista de funcionários", icon: Users, modulo: "funcionarios", sub: "lista" },
      { id: "documentos", titulo: "Documentos", icon: FolderCheck, modulo: "funcionarios", sub: "documentos" },
      // Ausência é informação da pessoa: virou aba daqui em vez de um item
      // próprio no menu (era a única seção do RH com uma tela só).
      { id: "atestados", titulo: "Atestados e faltas", icon: Stethoscope, modulo: "atestados", sub: "" },
    ],
  },
  // Consolidação: o treinamento estava espalhado em Funcionários (painel e turmas)
  // e na Folha (processamento/pagamento). Agora é uma seção só.
  treinamento: {
    titulo: "Treinamento",
    subtitulo: "Admissão em treinamento: prazos, turmas, cálculo e pagamento",
    abas: [
      { id: "trainees", titulo: "Trainees", icon: CalendarClock, modulo: "funcionarios", sub: "treinamento" },
      { id: "turmas", titulo: "Turmas", icon: GraduationCap, modulo: "funcionarios", sub: "turmas" },
      { id: "pagamentos", titulo: "Cálculo e pagamento", icon: Wallet, modulo: "pagamentos", sub: "treinamento" },
    ],
  },
  recrutamento: {
    titulo: "Recrutamento",
    subtitulo: "Funil de candidatos, agenda de entrevistas e roteiro",
    abas: [
      { id: "candidatos", titulo: "Candidatos", icon: Users, modulo: "recrutamento", sub: "candidatos" },
      { id: "talentos", titulo: "Banco de talentos", icon: Star, modulo: "recrutamento", sub: "talentos" },
      { id: "agenda", titulo: "Agenda e entrevistas", icon: CalendarRange, modulo: "recrutamento", sub: "agenda" },
      { id: "roteiro", titulo: "Roteiro", icon: FileText, modulo: "recrutamento", sub: "roteiro" },
    ],
  },
  folha: {
    titulo: "Folha de pagamento",
    subtitulo: "Extrato oficial, repasse, benefícios, rescisões e pagamentos avulsos",
    abas: [
      { id: "extrato", titulo: "Extrato mensal", icon: ClipboardList, modulo: "pagamentos", sub: "demonstrativos" },
      { id: "repasse", titulo: "Folha de repasse", icon: Banknote, modulo: "pagamentos", sub: "folha" },
      { id: "beneficios", titulo: "Benefícios", icon: Gift, modulo: "pagamentos", sub: "beneficios" },
      { id: "rescisoes", titulo: "Rescisões", icon: LogOut, modulo: "pagamentos", sub: "rescisoes" },
      { id: "diario", titulo: "Pagamento diário", icon: Wallet, modulo: "pagamentos", sub: "diario" },
    ],
  },
};
// As Configurações do RH saíram do pilar RH: agora são uma seção da área única
// de Configurações (engrenagem no topo) — ver SECOES_CONFIG e destinoRH.

// Indicadores e Relatórios do RH moram na Gestão (Dashboard › Pessoas).
export const PESSOAS_VISOES = [
  { id: "indicadores", titulo: "Indicadores", modulo: "indicadores" },
  { id: "relatorios", titulo: "Relatórios", modulo: "relatorios" },
] as const;

export type DestinoRH = { to: string; search?: Record<string, string> };

// Navegação interna do RHApp (irPara(modulo, sub)) → rota do Zaytan Hub.
export function destinoRH(modulo: string, sub: string): DestinoRH {
  if (modulo === "indicadores" || modulo === "relatorios") {
    return { to: "/", search: { aba: "pessoas", visao: modulo } };
  }
  // Configurações do RH agora moram na área única de Configurações.
  if (modulo === "config") return { to: "/configuracoes", search: { secao: "rh" } };
  // O KPI "Entrevistas" do painel pedia um sub inexistente ("entrevistas").
  const subNorm = modulo === "recrutamento" && sub === "entrevistas" ? "agenda" : sub;
  for (const [secao, def] of Object.entries(SECOES_RH)) {
    const aba = def.abas.find((a) => a.modulo === modulo && (a.sub === subNorm || (!a.sub && !subNorm)));
    if (aba) return { to: secao ? `/rh/${secao}` : "/rh", search: def.abas.length > 1 ? { aba: aba.id } : undefined };
  }
  // Módulo sem sub reconhecido: primeira aba da seção desse módulo.
  for (const [secao, def] of Object.entries(SECOES_RH)) {
    const aba = def.abas.find((a) => a.modulo === modulo);
    if (aba) return { to: secao ? `/rh/${secao}` : "/rh", search: def.abas.length > 1 ? { aba: aba.id } : undefined };
  }
  return { to: "/rh" };
}

// Perfis do RH (espelho de PERFIS no RHApp.jsx): quais módulos cada um vê.
const MODULOS_OPERADOR_RH = ["dashboard", "funcionarios", "recrutamento", "atestados", "pagamentos", "indicadores", "relatorios"];
const PERFIS_RH: Record<string, string[]> = {
  recrutamento: ["dashboard", "recrutamento"],
  rh: MODULOS_OPERADOR_RH,
  financeiro: MODULOS_OPERADOR_RH,
};

// null = sem restrição (admin do RH). Perfil desconhecido falha fechado.
export function modulosRH(perfil: string): string[] | null {
  if (!perfil) return null;
  return PERFIS_RH[perfil] ?? ["dashboard"];
}

export function podeVerModuloRH(perfil: string, modulo: string): boolean {
  const m = modulosRH(perfil);
  return !m || m.includes(modulo);
}
