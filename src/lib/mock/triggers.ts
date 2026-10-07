// ─── Gatilhos e cascatas do banco real, espelhados no protótipo ────────────
// Só o que muda comportamento visível nas telas:
//   - pagamentos_diarios: trava "pago é imutável" + histórico mensal (mig. 39)
//   - regras_categorizacao: atualizado_em + categoria da mesma empresa (mig. 14)
//   - empresa_membros, rh_acessos, gestao_acessos, perfis.is_master: registro de alterações de usuários (mig. 46/54)
//   - ON DELETE CASCADE / RESTRICT / SET NULL das FKs usadas pelas telas.
import { tabela, uuid, clone, type Row } from "./db";
import { uid } from "./acl";
import { usuarioAtual } from "./auth";

export class TriggerError extends Error {
  constructor(message: string, public code = "P0001") {
    super(message);
  }
}

const brl = (v: unknown) =>
  Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type OpGravar = "INSERT" | "UPDATE";
type OpLog = OpGravar | "DELETE";

const CAMPOS_IMUTAVEIS = ["data", "titular", "chave_pix", "tipo_chave", "valor", "pago_em", "pago_por"];

export function antesDeGravar(table: string, op: OpGravar, novo: Row, antigo: Row | null): Row {
  const agora = new Date().toISOString();
  if (table === "pagamentos_diarios") {
    const n: Row = { ...novo, atualizado_em: agora };
    if (op === "INSERT") {
      if (n.pago) {
        n.pago_em = n.pago_em ?? agora;
        n.pago_por = n.pago_por ?? uid();
      }
      n.criado_por = n.criado_por ?? uid();
      return n;
    }
    if (antigo?.pago) {
      if (!n.pago) throw new TriggerError('Um pagamento pago não volta para "em aberto". Se foi engano, peça ao master para ESTORNAR.');
      if (antigo.estornado && !n.estornado) throw new TriggerError("Um estorno não pode ser desfeito.");
      if (CAMPOS_IMUTAVEIS.some((c) => JSON.stringify(n[c] ?? null) !== JSON.stringify(antigo[c] ?? null))) {
        throw new TriggerError("Pagamento pago é imutável: data, titular, chave Pix e valor não mudam mais. Estorne e lance de novo.");
      }
    }
    if (n.pago && !antigo?.pago) {
      n.pago_em = n.pago_em ?? agora;
      n.pago_por = n.pago_por ?? uid();
    }
    return n;
  }
  if (table === "regras_categorizacao") {
    const n: Row = op === "UPDATE" ? { ...novo, atualizado_em: agora } : novo;
    const cat = tabela("plano_contas").find((c) => c.id === n.categoria_id);
    if (n.empresa_id != null && cat && cat.empresa_id !== n.empresa_id) {
      throw new TriggerError("A categoria da regra precisa ser do plano de contas da mesma empresa.");
    }
    return n;
  }
  return novo;
}

export function antesDeExcluir(table: string, row: Row) {
  if (table === "pagamentos_diarios" && row.pago) {
    throw new TriggerError(
      `Pagamento já marcado como PAGO não pode ser excluído (${row.titular} — R$ ${brl(row.valor)}). Se foi engano, peça ao master para ESTORNAR.`
    );
  }
  if (table === "plano_contas" && tabela("plano_contas").some((c) => c.parent_id === row.id)) {
    throw new TriggerError(
      `update or delete on table "plano_contas" violates foreign key constraint "plano_contas_parent_id_fkey" on table "plano_contas"`,
      "23503"
    );
  }
  if (table === "contas_bancarias" && tabela("movimentacoes").some((m) => m.conta_id === row.id)) {
    throw new TriggerError(
      `update or delete on table "contas_bancarias" violates foreign key constraint "movimentacoes_conta_id_fkey" on table "movimentacoes"`,
      "23503"
    );
  }
}

// Registro de alterações de usuários (fn_log_usuario, migração 46).
export function registrarHistoricoUsuario(
  userId: unknown, acao: string, detalhes: Record<string, unknown>, autorId: unknown = uid()
) {
  const usuario = tabela("auth.users").find((u) => u.id === userId);
  const autor = tabela("auth.users").find((u) => u.id === autorId);
  tabela("usuarios_historico").push({
    id: uuid(),
    user_id: userId,
    email: usuario?.email ?? null,
    nome: tabela("perfis").find((p) => p.user_id === userId)?.nome ?? null,
    acao,
    detalhes: clone(detalhes),
    autor_id: autorId ?? null,
    autor_email: autor?.email ?? null,
    ocorrido_em: new Date().toISOString(),
  });
}

const nomeCargo = (chave: unknown) => (chave == null ? null : tabela("cargos").find((c) => c.chave === chave)?.nome ?? String(chave));

// Gatilhos das tabelas de acesso: só registram o que alguém logado fez pela tela.
function historicoDeAcesso(table: string, op: OpLog, novo: Row | null, antigo: Row | null) {
  if (!uid()) return;
  const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (table === "empresa_membros") {
    const antes = op === "INSERT" ? null : antigo?.papel;
    const depois = op === "DELETE" ? null : novo?.papel;
    if (igual(antes, depois)) return;
    const empresaId = (novo ?? antigo)?.empresa_id;
    registrarHistoricoUsuario((novo ?? antigo)?.user_id, "acesso_financeiro", {
      empresaId,
      empresa: tabela("empresas").find((e) => e.id === empresaId)?.nome ?? null,
      antes: nomeCargo(antes),
      depois: nomeCargo(depois),
    });
  } else if (table === "rh_acessos") {
    const foto = (r: Row | null) => (r ? { perfil: r.perfil ?? null, empresas: r.empresas ?? null } : null);
    const antes = op === "INSERT" ? null : foto(antigo);
    const depois = op === "DELETE" ? null : foto(novo);
    if (igual(antes, depois)) return;
    registrarHistoricoUsuario((novo ?? antigo)?.user_id, "acesso_rh", { antes, depois });
  } else if (table === "gestao_acessos") {
    if (op === "UPDATE") return;
    registrarHistoricoUsuario((novo ?? antigo)?.user_id, "acesso_gestao", { antes: op === "DELETE", depois: op === "INSERT" });
  } else if (table === "perfis" && op !== "DELETE") {
    const antes = op === "INSERT" ? false : !!antigo?.is_master;
    const depois = !!novo?.is_master;
    if (antes === depois) return;
    registrarHistoricoUsuario(novo?.user_id, "administracao", { antes, depois });
  }
}

// clientes.mensalidade = soma das mensalidades ativas (trigger da migração 52).
function sincronizarMensalidadeCliente(clienteId: string) {
  const cliente = tabela("clientes").find((c) => c.id === clienteId);
  if (!cliente) return;
  const ativas = tabela("cliente_mensalidades")
    .filter((m) => m.cliente_id === clienteId && m.ativo)
    .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
  cliente.mensalidade = Math.round(ativas.reduce((s, m) => s + Number(m.valor), 0) * 100) / 100;
  if (ativas[0]) cliente.dia_vencimento = ativas[0].dia_vencimento;
}

export function depoisDeGravar(table: string, op: OpLog, novo: Row | null, antigo: Row | null) {
  if (table === "cliente_mensalidades") {
    sincronizarMensalidadeCliente(String((novo ?? antigo)?.cliente_id));
    return;
  }
  if (table === "empresa_membros" || table === "rh_acessos" || table === "gestao_acessos" || table === "perfis") {
    historicoDeAcesso(table, op, novo, antigo);
    return;
  }
  if (table !== "pagamentos_diarios") return;
  const linha = (novo ?? antigo) as Row;
  let acao: string;
  let campos: string[] = [];
  if (op === "INSERT") acao = "criado";
  else if (op === "DELETE") acao = "excluido";
  else {
    campos = Object.keys(novo ?? {})
      .filter((k) => k !== "atualizado_em" && JSON.stringify(novo?.[k] ?? null) !== JSON.stringify(antigo?.[k] ?? null))
      .sort();
    if (campos.length === 0) return; // update que não mudou nada: não polui
    acao = !antigo?.pago && novo?.pago ? "pago" : !antigo?.estornado && novo?.estornado ? "estornado" : "alterado";
  }
  if (!tabela("empresas").some((e) => e.id === linha.empresa_id)) return;
  tabela("pagamentos_diarios_historico").push({
    id: uuid(),
    empresa_id: linha.empresa_id,
    pagamento_id: linha.id,
    competencia: String(linha.data ?? "").slice(0, 7),
    acao,
    campos: op === "UPDATE" ? campos : [],
    dados_antes: op === "INSERT" ? null : clone(antigo),
    dados_depois: op === "DELETE" ? null : clone(novo),
    titular: linha.titular ?? null,
    chave_pix: linha.chave_pix ?? null,
    valor: linha.valor ?? null,
    autor_id: uid(),
    autor_email: usuarioAtual()?.email ?? null,
    ocorrido_em: new Date().toISOString(),
  });
}

// Remove linhas filhas (CASCADE) ou limpa a referência (SET NULL).
function apagarOnde(table: string, pred: (r: Row) => boolean) {
  const t = tabela(table);
  const removidas = t.filter(pred);
  if (removidas.length === 0) return;
  t.splice(0, t.length, ...t.filter((r) => !pred(r)));
  for (const r of removidas) cascatasDe(table, r);
}

const TABELAS_POR_EMPRESA = [
  "empresa_membros", "clientes", "cobrancas", "movimentacoes", "previstos", "regras", "planejamento_meses",
  "planejamento_itens", "configuracoes", "recorrentes", "regras_categorizacao", "contas_bancarias", "feriados",
  "integracoes_inter", "pagamentos_processos", "pagamentos_processos_parcelas", "orcamentos", "vendas",
  "pagamentos_diarios", "pagamentos_diarios_historico", "plano_contas", "cliente_mensalidades", "cartoes",
  "cartao_lancamentos",
];

export function cascatasDe(table: string, row: Row) {
  switch (table) {
    case "empresas":
      for (const t of TABELAS_POR_EMPRESA) apagarOnde(t, (r) => r.empresa_id === row.id);
      break;
    case "clientes":
      apagarOnde("cobrancas", (r) => r.cliente_id === row.id);
      apagarOnde("cliente_mensalidades", (r) => r.cliente_id === row.id);
      break;
    case "cliente_mensalidades":
      for (const c of tabela("cobrancas")) if (c.mensalidade_id === row.id) c.mensalidade_id = null;
      sincronizarMensalidadeCliente(String(row.cliente_id));
      break;
    case "cartoes":
      apagarOnde("cartao_lancamentos", (r) => r.cartao_id === row.id);
      break;
    case "recorrentes":
      apagarOnde("previstos", (r) => r.recorrente_id === row.id);
      break;
    case "pagamentos_processos":
      apagarOnde("pagamentos_processos_parcelas", (r) => r.processo_id === row.id);
      break;
    case "plano_contas":
      apagarOnde("regras_categorizacao", (r) => r.categoria_id === row.id);
      apagarOnde("orcamentos", (r) => r.plano_conta_id === row.id);
      for (const m of tabela("movimentacoes")) if (m.categoria_sugerida_id === row.id) m.categoria_sugerida_id = null;
      break;
    case "movimentacoes":
      for (const c of tabela("cobrancas")) if (c.movimentacao_id === row.id) c.movimentacao_id = null;
      break;
    case "rh.extratos_mensais":
      apagarOnde("rh.folha_eventos", (r) => r.extrato_id === row.id);
      apagarOnde("rh.beneficios_mensais", (r) => r.extrato_id === row.id);
      break;
    case "rh.folhas":
      apagarOnde("rh.folha_itens", (r) => r.folha_id === row.id);
      break;
  }
}
