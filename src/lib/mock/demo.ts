// ─── Identidades FICTÍCIAS do protótipo ────────────────────────────────────
// Empresas, logins e pessoas abaixo são inventados. Os logins servem para
// demonstrar os cargos/permissões (master, admin, operador, leitura, Pix, RH).

export const SENHA_DEMO = "demo1234";

export const EMPRESAS_DEMO = [
  { id: "0b1f6a52-1c3e-4d6a-9d7e-000000000001", nome: "Laportec", rh: "Laportec" },
  { id: "0b1f6a52-1c3e-4d6a-9d7e-000000000002", nome: "Avora", rh: "Avora" },
  { id: "0b1f6a52-1c3e-4d6a-9d7e-000000000003", nome: "Zaytan", rh: "Zaytan" },
] as const;

export const [E1, E2, E3] = EMPRESAS_DEMO.map((e) => e.id);

export type UsuarioDemo = {
  id: string;
  email: string;
  nome: string;
  papel: string; // "master", o cargo nas empresas do Financeiro, ou "" (sem Financeiro)
  empresas: string[]; // empresas do Financeiro em que a pessoa tem o cargo
  descricao: string;
  // Acesso ao módulo RH (tabela rh_acessos): perfil null = administrador do RH
  // ("rh" | "financeiro" | "recrutamento" restringem); empresas null = todas.
  rh?: { perfil: string | null; empresas: string[] | null };
};

export const USUARIOS_DEMO: UsuarioDemo[] = [
  {
    id: "7d0c0000-0000-4000-8000-000000000001",
    email: "diretoria@zaytanhub.demo",
    nome: "Diretoria (Master)",
    papel: "master",
    empresas: [E1, E2, E3],
    descricao: "Vê tudo: Financeiro, RH e Gestão, em todas as empresas.",
  },
  {
    id: "7d0c0000-0000-4000-8000-000000000002",
    email: "financeiro@zaytanhub.demo",
    nome: "Ana Souza",
    papel: "admin",
    empresas: [E1, E2],
    rh: { perfil: null, empresas: null },
    descricao: "Administradora: Financeiro + RH + Gestão nas empresas dela.",
  },
  {
    id: "7d0c0000-0000-4000-8000-000000000003",
    email: "operador@zaytanhub.demo",
    nome: "Bruno Martins",
    papel: "operador",
    empresas: [E1],
    descricao: "Operação financeira do dia a dia (sem Ajustes e sem RH).",
  },
  {
    id: "7d0c0000-0000-4000-8000-000000000004",
    email: "leitura@zaytanhub.demo",
    nome: "Carla Nunes",
    papel: "visualizador",
    empresas: [E1],
    descricao: "Só leitura: Dashboard e Fluxo de Caixa.",
  },
  {
    id: "7d0c0000-0000-4000-8000-000000000005",
    email: "pix@zaytanhub.demo",
    nome: "Diego Alves",
    papel: "pagador",
    empresas: [E1],
    descricao: "Cargo enxuto: só a lista de Pagamentos Diários (Pix).",
  },
  {
    id: "7d0c0000-0000-4000-8000-000000000006",
    email: "rh@zaytanhub.demo",
    nome: "Larissa Prado",
    papel: "",
    empresas: [],
    rh: { perfil: "rh", empresas: ["Laportec"] },
    descricao: "Gerente de RH: só o RH (sem Financeiro), restrita à Laportec.",
  },
  {
    id: "7d0c0000-0000-4000-8000-000000000007",
    email: "recrutamento@zaytanhub.demo",
    nome: "Paulo Mendes",
    papel: "",
    empresas: [],
    rh: { perfil: "recrutamento", empresas: ["Laportec", "Avora"] },
    descricao: "Recrutador da Laportec e da Avora: só o painel e o funil de Recrutamento (sem Financeiro).",
  },
];
