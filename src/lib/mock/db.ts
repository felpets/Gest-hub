// ─── Banco em memória do protótipo (dados FICTÍCIOS) ───────────────────────
// O protótipo do Zaytan Hub roda sem tocar no Supabase real. Este módulo
// guarda as "tabelas" num objeto em memória (espelhado no localStorage do
// navegador, só como conveniência de demonstração) com as MESMAS colunas dos
// bancos reais, para que as telas e a camada de dados rodem sem alteração.
//
// Dois namespaces convivem aqui, como acontece hoje na vida real (dois
// projetos Supabase separados):
//   - tabelas sem prefixo  → projeto "Financeiro"   (ieqkhecsyarszhhonaor)
//   - tabelas "rh.<nome>"  → projeto "ZAYTAN CRM RH" (apatabasuxkgqxabuqdj)
// O prefixo evita a colisão real de nomes (as duas bases têm uma tabela
// `pagamentos_diarios`, com esquemas diferentes).

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

// v9: categoria compensada (migração 56) — força sementes novas em quem
// já abriu a demonstração.
const STORAGE_KEY = "zaytan.prototipo.db.v9";

export const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

const nowISO = () => new Date().toISOString();
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ─── Esquema mínimo: chave primária, defaults e unicidades ─────────────────
// Unicidade: a lista de colunas, ou um índice PARCIAL — { cols, onde } — que só
// vale nas linhas que passam no `onde`, como o `where` de um índice no Postgres.
export type UnicidadeSpec = string[] | { cols: string[]; onde: (r: Row) => boolean };

export const normalizarUnicidade = (u: UnicidadeSpec): { cols: string[]; onde: (r: Row) => boolean } =>
  Array.isArray(u) ? { cols: u, onde: () => true } : u;

type TableSpec = {
  pk: string[];
  defaults?: () => Row;
  unique?: UnicidadeSpec[]; // nulls não colidem
};

const idPk = (extra?: () => Row): TableSpec => ({
  pk: ["id"],
  defaults: () => ({ id: uuid(), ...(extra ? extra() : {}) }),
});

export const SPECS: Record<string, TableSpec> = {
  // Financeiro
  empresas: idPk(() => ({ criado_em: nowISO(), modulos: ["financeiro"] })),
  perfis: { pk: ["user_id"], defaults: () => ({ is_master: false, criado_em: nowISO(), nome: null }) },
  empresa_membros: { pk: ["empresa_id", "user_id"], defaults: () => ({ papel: "admin", criado_em: nowISO() }) },
  cargos: { pk: ["chave"], defaults: () => ({ is_sistema: false, ordem: 100, criado_em: nowISO() }) },
  cargo_capacidades: { pk: ["cargo_chave", "capacidade"] },
  rh_acessos: { pk: ["user_id"], defaults: () => ({ perfil: null, empresas: null, criado_em: nowISO(), criado_por: null }) },
  gestao_acessos: { pk: ["user_id"], defaults: () => ({ criado_em: nowISO(), criado_por: null }) },
  usuarios_historico: idPk(() => ({ detalhes: {}, autor_id: null, autor_email: null, ocorrido_em: nowISO() })),
  clientes: idPk(() => ({
    status: "Pago", mensalidade: 0, ticket: 0, atraso: 0, criado_em: nowISO(),
    dia_vencimento: 5, cliente_desde: null, chave_ofx: null, ativo: true,
  })),
  movimentacoes: {
    ...idPk(() => ({
      descricao_ia: null, categoria: null, confianca: 1, status: "Realizado", criado_em: nowISO(),
      fitid: null, categoria_sugerida_id: null, categoria_status: "confirmada", lote_id: null,
    })),
    unique: [["empresa_id", "conta_id", "fitid"]],
  },
  previstos: idPk(() => ({
    categoria: null, criado_em: nowISO(), recorrente_id: null, boletos: [], pago: false, pago_em: null, pago_valor: null,
    cartao_id: null,
  })),
  cliente_mensalidades: idPk(() => ({
    descricao: "Mensalidade", dia_vencimento: 5, ativo: true, criado_em: nowISO(), criado_por: null,
  })),
  cartoes: idPk(() => ({
    final: null, dia_fechamento: null, dia_vencimento: null, ativo: true, criado_em: nowISO(), criado_por: null,
  })),
  cartao_lancamentos: {
    ...idPk(() => ({ categoria: null, fitid: null, lote_id: null, criado_em: nowISO(), criado_por: null })),
    unique: [{ cols: ["cartao_id", "fitid"], onde: (r) => r.fitid != null }],
  },
  regras: idPk(() => ({ ativo: true, criado_em: nowISO() })),
  plano_contas: idPk(() => ({
    codigo: null, parent_id: null, criado_em: nowISO(), oculto_relatorios: false,
    competencia_modo: "pagamento", competencia_dia_corte: null, investimento_anuncios: false, compensar: false,
  })),
  configuracoes: { pk: ["empresa_id"], defaults: () => ({ saldo_inicial: 0, saldo_inicial_data: todayLocal(), funcionalidades: {}, atualizado_em: nowISO() }) },
  recorrentes: idPk(() => ({
    categoria: null, dia: 1, fim: null, criado_em: nowISO(), boletos: [], modo_dia: "fixo", dia_util_n: null, dia2: null,
    fonte_rh: null, cartao_id: null,
  })),
  regras_categorizacao: {
    ...idPk(() => ({
      tipo_match: "contem", origem: "manual", acertos: 0, ativo: true, criado_em: nowISO(), atualizado_em: nowISO(),
    })),
    unique: [["empresa_id", "padrao", "tipo_match"]],
  },
  cobrancas: {
    ...idPk(() => ({
      status: "aberto", pago_em: null, pago_valor: null, movimentacao_id: null, criado_em: nowISO(),
      venda_id: null, parcela: null, parcelas_total: null, forma_pagamento: null, descricao: null, criado_por: null,
      mensalidade_id: null,
    })),
    // Uma cobrança por MENSALIDADE e mês (migração 52). As linhas antigas, sem
    // mensalidade, seguem com a trava por cliente; parcelas de venda ficam fora.
    unique: [
      { cols: ["mensalidade_id", "competencia"], onde: (r) => r.mensalidade_id != null },
      { cols: ["cliente_id", "competencia"], onde: (r) => r.venda_id == null && r.mensalidade_id == null },
    ],
  },
  contas_bancarias: idPk(() => ({
    banco: null, bank_id: null, acct_id: null, acct_type: null, saldo_inicial: 0, saldo_inicial_data: todayLocal(),
    ativo: true, ordem: 0, cor: null, criado_em: nowISO(), saldo_ajustado_em: null, saldo_ajustado_por: null,
    saldo_ajuste_motivo: null,
  })),
  feriados: { ...idPk(() => ({ nome: null, criado_em: nowISO() })), unique: [["empresa_id", "data"]] },
  integracoes_inter: idPk(() => ({
    ativo: true, ultimo_saldo: null, ultimo_saldo_em: null, ultima_sync: null, ultimo_erro: null,
    criado_em: nowISO(), atualizado_em: nowISO(),
  })),
  pagamentos_processos: idPk(() => ({
    valor: 0, dia_pagamento: 5, parcela_atual: 1, parcelas_total: 1, chave_pix: null, ativo: true, criado_em: nowISO(),
  })),
  pagamentos_processos_parcelas: idPk(() => ({
    pago_em: todayLocal(), valor: 0, comprovante_path: null, comprovante_nome: null, criado_em: nowISO(),
  })),
  orcamentos: {
    ...idPk(() => ({ competencia: null, criado_em: nowISO() })),
    unique: [["empresa_id", "plano_conta_id", "competencia"]],
  },
  vendas: idPk(() => ({
    data: todayLocal(), vendedor: "", forma_pagamento: "pix", valor_bruto: 0, valor_liquido: 0,
    observacao: null, criado_em: nowISO(), cliente_id: null, descricao: null, criado_por: null,
  })),
  pagamentos_diarios: idPk(() => ({
    data: todayLocal(), tipo_chave: "outro", descricao: null, pago: false, pago_em: null, pago_por: null,
    estornado: false, estornado_em: null, estorno_motivo: null, criado_em: nowISO(), criado_por: null,
    atualizado_em: nowISO(),
  })),
  pagamentos_diarios_historico: idPk(() => ({
    campos: [], dados_antes: null, dados_depois: null, ocorrido_em: nowISO(),
  })),
};

// Tabelas do RH: todas com pk `id` (texto no banco real) e `updated_at`.
const RH_TABLES = [
  "app_state", "funcionarios", "candidatos", "pagamentos", "documentos", "atestados", "perguntas",
  "config", "folhas", "folha_itens", "folha_importacoes", "extratos_mensais", "folha_eventos",
  "backups", "beneficios_mensais", "pagamentos_beneficios", "pagamentos_diarios", "treinamentos",
];
for (const t of RH_TABLES) {
  SPECS[`rh.${t}`] = { pk: ["id"], defaults: () => ({ id: uuid(), updated_at: nowISO() }) };
}

export function specOf(table: string): TableSpec {
  return SPECS[table] ?? { pk: ["id"], defaults: () => ({ id: uuid() }) };
}

// ─── Estado ────────────────────────────────────────────────────────────────
let tables: Tables | null = null;
let seeder: (() => Tables) | null = null;
const listeners = new Set<() => void>();

// O seed é registrado de fora (evita import circular com os geradores).
export function registrarSeed(fn: () => Tables) {
  seeder = fn;
}

function load(): Tables {
  if (tables) return tables;
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        tables = JSON.parse(raw) as Tables;
        return tables;
      }
    } catch {
      /* storage indisponível ou corrompido: recomeça do seed */
    }
  }
  tables = seeder ? seeder() : {};
  persistir();
  return tables;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistir() {
  if (typeof localStorage === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tables));
    } catch {
      /* quota cheia: o protótipo segue funcionando só em memória */
    }
  }, 150);
}

export function tabela(nome: string): Row[] {
  const t = load();
  if (!t[nome]) t[nome] = [];
  return t[nome];
}

export function substituirTabela(nome: string, linhas: Row[]) {
  load()[nome] = linhas;
}

export function marcarAlterado() {
  persistir();
  listeners.forEach((l) => l());
}

export function onDbChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Volta aos dados fictícios originais (botão "Restaurar dados de demonstração").
export function resetMockDb() {
  tables = seeder ? seeder() : {};
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tables));
    } catch {
      /* ignora */
    }
  }
  listeners.forEach((l) => l());
}

export const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
