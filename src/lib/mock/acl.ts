// ─── Espelho das policies (RLS) do Supabase, para o protótipo ──────────────
// Replica as funções do banco real — is_master(), tem_acesso_empresa() e
// cargo_tem() — e o mapa de policies por tabela (levantado de pg_policies
// dos dois projetos). Assim o protótipo continua respeitando cargos e
// capacidades exatamente como o sistema em produção.
import { tabela, type Row } from "./db";
import { usuarioAtual } from "./auth";

export function uid(): string | null {
  return usuarioAtual()?.id ?? null;
}

export function isMaster(): boolean {
  const id = uid();
  if (!id) return false;
  return tabela("perfis").some((p) => p.user_id === id && p.is_master === true);
}

export function papelNaEmpresa(empresaId: unknown): string | null {
  const id = uid();
  const m = tabela("empresa_membros").find((r) => r.empresa_id === empresaId && r.user_id === id);
  return m ? String(m.papel ?? "visualizador") : null;
}

export function temAcessoEmpresa(empresaId: unknown): boolean {
  if (isMaster()) return true;
  return papelNaEmpresa(empresaId) !== null;
}

export function cargoTem(empresaId: unknown, cap: string): boolean {
  if (isMaster()) return true;
  const papel = papelNaEmpresa(empresaId);
  if (!papel) return false;
  return tabela("cargo_capacidades").some((c) => c.cargo_chave === papel && c.capacidade === cap);
}

// ─── Mapa de policies ──────────────────────────────────────────────────────
type Check = (row: Row) => boolean;
type Policy = { read: Check; write: Check };

const porCap = (cap: string): Policy => ({
  read: (r) => temAcessoEmpresa(r.empresa_id),
  write: (r) => cargoTem(r.empresa_id, cap),
});
const soMaster: Policy = { read: () => isMaster(), write: () => isMaster() };
const autenticado = (): boolean => uid() !== null;

const POLICIES: Record<string, Policy> = {
  empresas: { read: (r) => temAcessoEmpresa(r.id), write: () => isMaster() },
  perfis: { read: (r) => r.user_id === uid() || isMaster(), write: () => isMaster() },
  empresa_membros: { read: (r) => r.user_id === uid() || isMaster(), write: () => isMaster() },
  cargos: { read: () => autenticado(), write: () => false },
  cargo_capacidades: { read: () => autenticado(), write: () => false },
  clientes: porCap("clientes_gerir"),
  cobrancas: porCap("clientes_gerir"),
  cliente_mensalidades: porCap("clientes_gerir"),
  configuracoes: porCap("config_gerir"),
  // Cadastro de cartões (migração 51): lê quem acessa a empresa, grava quem cuida das contas.
  cartoes: porCap("contas_gerir"),
  // Extrato do cartão (migração 53): grava quem importa extrato ou cuida das contas.
  cartao_lancamentos: {
    read: (r) => temAcessoEmpresa(r.empresa_id),
    write: (r) => cargoTem(r.empresa_id, "mov_gerir") || cargoTem(r.empresa_id, "contas_gerir"),
  },
  contas_bancarias: porCap("config_gerir"),
  feriados: porCap("config_gerir"),
  movimentacoes: porCap("mov_gerir"),
  planejamento_meses: porCap("mov_gerir"),
  planejamento_itens: porCap("mov_gerir"),
  regras: porCap("mov_gerir"),
  regras_categorizacao: {
    read: (r) => r.empresa_id == null || temAcessoEmpresa(r.empresa_id),
    write: (r) => isMaster() || (r.empresa_id != null && cargoTem(r.empresa_id, "mov_gerir")),
  },
  orcamentos: porCap("plano_gerir"),
  plano_contas: porCap("plano_gerir"),
  pagamentos_processos: porCap("contas_gerir"),
  pagamentos_processos_parcelas: porCap("contas_gerir"),
  previstos: porCap("contas_gerir"),
  recorrentes: porCap("contas_gerir"),
  vendas: porCap("vendas_gerir"),
  // Pix de terceiros: até a LEITURA exige a capacidade (migração 39).
  pagamentos_diarios: {
    read: (r) => cargoTem(r.empresa_id, "pag_diario_gerir"),
    write: (r) => cargoTem(r.empresa_id, "pag_diario_gerir"),
  },
  pagamentos_diarios_historico: {
    read: (r) => cargoTem(r.empresa_id, "pag_diario_gerir"),
    write: () => false, // só o gatilho escreve
  },
  integracoes_inter: soMaster,
  rh_acessos: { read: (r) => r.user_id === uid() || isMaster(), write: () => isMaster() },
  // Quem vê a Gestão sem ser Administrador (migração 54): mesmo desenho do RH.
  gestao_acessos: { read: (r) => r.user_id === uid() || isMaster(), write: () => isMaster() },
  // Registro de alterações de usuários (migração 46): só o master lê; ninguém grava pela API.
  usuarios_historico: { read: () => isMaster(), write: () => false },
  "auth.users": { read: () => false, write: () => false },
};

// ─── RH (migração 42): tabelas rh_* com acesso por usuário ─────────────────
// Espelha public.rh_pode(tabela, empresa): master sempre; senão precisa de uma
// linha em rh_acessos, com a empresa na lista (quando o acesso tem lista) e, no
// perfil "recrutamento", só candidatos, perguntas e configuração.
export function rhPode(tabelaRh: string, empresa: string | null): boolean {
  if (isMaster()) return true;
  const id = uid();
  const a = tabela("rh_acessos").find((r) => r.user_id === id);
  if (!a) return false;
  const lista = Array.isArray(a.empresas) ? (a.empresas as unknown[]).map((e) => String(e).trim().toLowerCase()) : null;
  if (lista !== null && empresa !== null && !lista.includes(empresa.trim().toLowerCase())) return false;
  if (a.perfil === "recrutamento" && !["candidatos", "perguntas", "config"].includes(tabelaRh)) return false;
  return true;
}

const RH_COM_EMPRESA = new Set([
  "funcionarios", "candidatos", "pagamentos", "atestados", "documentos", "treinamentos",
  "pagamentos_diarios", "extratos_mensais", "folhas",
]);

function politicaRH(table: string): Policy {
  const nome = table.slice("rh.".length);
  // Registro sem empresa preenchida só aparece para quem vê todas as empresas.
  const empresaDe = (r: Row): string | null => {
    if (RH_COM_EMPRESA.has(nome)) return String(r.empresa ?? "");
    if (nome === "folha_eventos") {
      return String(tabela("rh.extratos_mensais").find((x) => x.id === r.extrato_id)?.empresa ?? "");
    }
    if (nome === "folha_itens") {
      return String(tabela("rh.folhas").find((x) => x.id === r.folha_id)?.empresa ?? "");
    }
    return null;
  };
  const pode = (r: Row) => rhPode(nome, empresaDe(r));
  return { read: pode, write: pode };
}

export function policyDe(table: string): Policy {
  if (table.startsWith("rh.")) return politicaRH(table);
  return POLICIES[table] ?? { read: () => autenticado(), write: () => autenticado() };
}
