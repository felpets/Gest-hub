// ─── RPCs do banco real, reimplementadas para o protótipo ──────────────────
// Cada função abaixo espelha a versão SQL correspondente em supabase/*.sql
// (mesmo nome, mesmos parâmetros, mesmo formato de retorno). As regras de
// negócio são as MESMAS — só o motor muda (JS em vez de Postgres).
import { tabela, uuid, type Row } from "./db";
import { isMaster, temAcessoEmpresa, cargoTem, uid } from "./acl";
import { usuarioAtual } from "./auth";
import { TriggerError, antesDeGravar, depoisDeGravar, cascatasDe } from "./triggers";

type Params = Record<string, unknown>;
type RpcFn = (p: Params) => unknown;

const falhar = (msg: string, code = "P0001"): never => {
  throw new TriggerError(msg, code);
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const toISO = (dt: Date) => `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
const deISO = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDias = (iso: string, n: number) => {
  const d = deISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const round2 = (v: number) => Math.round(v * 100) / 100;

// ─── Normalização de descrições (fn_normaliza_descricao — migração 17) ─────
const RUIDOS =
  /\b(PAG|PAGTO|PAGAMENTO|PAGAMENTOS|PAGO|PAGOS|PIX|TED|DOC|SISPAG|COMPRA|DEBITO|CREDITO|TRANSF|TRANSFERENCIA|SAQUE|TARIFA|CARTAO|CARD|BOLETO|RECEBIMENTO|RECEBIDO|RECEBIDA|ENVIADO|ENVIADA)\b/g;

export function normalizaDescricao(texto: unknown): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(RUIDOS, " ")
    .replace(/[0-9*#/.,:;@_\-\\()[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function chaveEstabelecimento(texto: unknown): string | null {
  const t = normalizaDescricao(texto);
  const tok = t.split(" ").find((x) => x.length >= 3);
  return tok ?? (t || null);
}

// word_similarity (pg_trgm), aproximado: fração dos trigramas do padrão que
// aparecem em alguma palavra (ou sequência de palavras) da descrição.
function trigramas(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().split(/\s+/).filter(Boolean)) {
    const p = `  ${w} `;
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}
function wordSimilarity(padrao: string, texto: string): number {
  const a = trigramas(padrao);
  if (a.size === 0) return 0;
  const palavras = texto.split(" ").filter(Boolean);
  let melhor = 0;
  for (let i = 0; i < palavras.length; i++) {
    for (let j = i; j < Math.min(palavras.length, i + 4); j++) {
      const b = trigramas(palavras.slice(i, j + 1).join(" "));
      let comum = 0;
      a.forEach((t) => b.has(t) && comum++);
      const sim = comum / (a.size + b.size - comum);
      const cobertura = comum / a.size;
      melhor = Math.max(melhor, Math.min(cobertura, sim + 0.25));
    }
  }
  return melhor;
}
const LIMIAR_TRGM = 0.5;

// ─── Plano de contas: caminho textual "Pai / Filho" ────────────────────────
export function caminhoCategoria(id: unknown): string | null {
  const contas = tabela("plano_contas");
  const nomes: string[] = [];
  let atual = contas.find((c) => c.id === id);
  let guarda = 0;
  while (atual && guarda++ < 10) {
    nomes.unshift(String(atual.nome));
    atual = atual.parent_id ? contas.find((c) => c.id === atual!.parent_id) : undefined;
  }
  return nomes.length ? nomes.join(" / ") : null;
}

function categoriaPorCaminho(empresa: unknown, caminho: unknown): string | null {
  const partes = String(caminho ?? "").trim().split(" / ");
  const contas = tabela("plano_contas").filter((c) => c.empresa_id === empresa);
  const root = contas.find((c) => c.parent_id == null && c.nome === partes[0]);
  if (!root) return null;
  if (partes.length >= 2) {
    const filho = contas.find((c) => c.parent_id === root.id && c.nome === partes[1]);
    if (filho) return String(filho.id);
  }
  return String(root.id);
}

// ─── Feriados e dia útil (migrações 26 e 32) ───────────────────────────────
function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

export function feriadosNacionais(ano: number): string[] {
  const p = pascoa(ano);
  const rel = (n: number) => {
    const d = new Date(p);
    d.setDate(d.getDate() + n);
    return toISO(d);
  };
  return [
    `${ano}-01-01`, `${ano}-04-21`, `${ano}-05-01`, `${ano}-09-07`, `${ano}-10-12`,
    `${ano}-11-02`, `${ano}-11-15`, `${ano}-11-20`, `${ano}-12-25`,
    rel(-48), rel(-47), rel(-2), rel(60),
  ];
}

function feriadosEfetivos(empresa: unknown, de: string, ate: string): string[] {
  const set = new Set<string>();
  for (let y = Number(de.slice(0, 4)); y <= Number(ate.slice(0, 4)); y++) {
    for (const d of feriadosNacionais(y)) if (d >= de && d <= ate) set.add(d);
  }
  for (const f of tabela("feriados")) {
    const d = String(f.data);
    if (f.empresa_id === empresa && d >= de && d <= ate) set.add(d);
  }
  return [...set].sort();
}

function diaUtil(empresa: unknown, iso: string): boolean {
  const dow = deISO(iso).getDay();
  if (dow === 0 || dow === 6) return false;
  if (feriadosNacionais(Number(iso.slice(0, 4))).includes(iso)) return false;
  return !tabela("feriados").some((f) => f.empresa_id === empresa && f.data === iso);
}

export function diaUtilAnteriorEmpresa(empresa: unknown, iso: string): string {
  let cand = iso;
  for (let g = 0; g < 40 && !diaUtil(empresa, cand); g++) cand = addDias(cand, -1);
  return cand;
}

// ─── Registro das RPCs ─────────────────────────────────────────────────────
const RPCS: Record<string, RpcFn> = {};

export function registrarRpc(nome: string, fn: RpcFn) {
  RPCS[nome] = fn;
}

export function executarRpc(nome: string, params: Params): unknown {
  const fn = RPCS[nome];
  if (!fn) {
    throw new TriggerError(`Could not find the function public.${nome} in the schema cache`, "PGRST202");
  }
  if (!usuarioAtual()) throw new TriggerError("JWT ausente: faça login.", "42501");
  return fn(params);
}

// Helpers de gravação interna (respeitam gatilhos, ignoram policies).
function inserir(table: string, row: Row): Row {
  const r = antesDeGravar(table, "INSERT", row, null);
  tabela(table).push(r);
  depoisDeGravar(table, "INSERT", r, null);
  return r;
}
function atualizar(table: string, row: Row, patch: Row) {
  const antes = { ...row };
  Object.assign(row, antesDeGravar(table, "UPDATE", { ...row, ...patch }, antes));
  depoisDeGravar(table, "UPDATE", row, antes);
}
function remover(table: string, pred: (r: Row) => boolean): number {
  const t = tabela(table);
  const fora = t.filter(pred);
  t.splice(0, t.length, ...t.filter((r) => !pred(r)));
  for (const r of fora) cascatasDe(table, r);
  return fora.length;
}

// ─── Categorização (migrações 16, 17, 18) ──────────────────────────────────
registrarRpc("fn_normaliza_descricao", (p) => normalizaDescricao(p.p_texto));

function melhorRegra(empresa: unknown, descricao: unknown): Row | null {
  const norm = normalizaDescricao(descricao);
  const candidatas = tabela("regras_categorizacao")
    .filter((rc) => rc.ativo && rc.tipo_match === "contem" && (rc.empresa_id === empresa || rc.empresa_id == null))
    .map((rc) => {
      const padrao = String(rc.padrao);
      const contem = norm.includes(padrao);
      const sim = contem ? 1 : wordSimilarity(padrao, norm);
      return { rc, contem, sim };
    })
    .filter((x) => x.contem || x.sim >= LIMIAR_TRGM);
  candidatas.sort(
    (a, b) =>
      Number(b.rc.empresa_id != null) - Number(a.rc.empresa_id != null) ||
      Number(b.contem) - Number(a.contem) ||
      Number(b.rc.acertos) - Number(a.rc.acertos) ||
      b.sim - a.sim ||
      String(b.rc.atualizado_em).localeCompare(String(a.rc.atualizado_em))
  );
  return candidatas[0]?.rc ?? null;
}

registrarRpc("fn_categorizar_pendentes", (p) => {
  if (!cargoTem(p.p_empresa, "mov_gerir")) return 0; // SECURITY INVOKER: a RLS barra o update
  let n = 0;
  for (const m of tabela("movimentacoes")) {
    if (m.empresa_id !== p.p_empresa || m.categoria_status !== "pendente" || m.categoria_sugerida_id != null) continue;
    if (p.p_lote && m.lote_id !== p.p_lote) continue;
    const regra = melhorRegra(m.empresa_id, m.descricao);
    if (regra) {
      m.categoria_sugerida_id = regra.categoria_id;
      n++;
    }
  }
  return n;
});

function aprenderRegra(empresa: unknown, descricao: unknown, categoriaId: unknown) {
  const chave = chaveEstabelecimento(descricao);
  if (!chave || chave.length < 3) return;
  const existente = tabela("regras_categorizacao").find(
    (r) => r.empresa_id === empresa && r.padrao === chave && r.tipo_match === "contem"
  );
  if (existente) {
    atualizar("regras_categorizacao", existente, {
      acertos: existente.categoria_id === categoriaId ? Number(existente.acertos) + 1 : 1,
      categoria_id: categoriaId,
      ativo: true,
    });
  } else {
    inserir("regras_categorizacao", {
      id: uuid(), empresa_id: empresa, padrao: chave, tipo_match: "contem", categoria_id: categoriaId,
      origem: "aprendida", acertos: 1, ativo: true,
      criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
    });
  }
}

registrarRpc("fn_aprovar_lote", (p) => {
  const itens = Array.isArray(p.p_aprovacoes) ? (p.p_aprovacoes as Row[]) : [];
  let n = 0;
  for (const it of itens) {
    if (!it.id || !it.categoria_id) continue;
    const m = tabela("movimentacoes").find((x) => x.id === it.id && x.categoria_status === "pendente");
    if (!m || !cargoTem(m.empresa_id, "mov_gerir")) continue;
    const cat = tabela("plano_contas").find((c) => c.id === it.categoria_id && c.empresa_id === m.empresa_id);
    if (!cat) continue; // anti-envenenamento: categoria de outra empresa
    const caminho = caminhoCategoria(cat.id);
    if (!caminho) continue;
    m.categoria = caminho;
    m.categoria_sugerida_id = cat.id;
    m.categoria_status = "confirmada";
    aprenderRegra(m.empresa_id, m.descricao, cat.id);
    n++;
  }
  return n;
});

registrarRpc("fn_semear_regras_do_historico", (p) => {
  if (!cargoTem(p.p_empresa, "mov_gerir")) return 0;
  const cont = new Map<string, Map<string, number>>();
  for (const m of tabela("movimentacoes")) {
    if (m.empresa_id !== p.p_empresa || m.categoria_status !== "confirmada" || !m.categoria) continue;
    const chave = chaveEstabelecimento(m.descricao);
    const cat = categoriaPorCaminho(m.empresa_id, m.categoria);
    if (!chave || chave.length < 4 || !cat) continue;
    const porCat = cont.get(chave) ?? new Map<string, number>();
    porCat.set(cat, (porCat.get(cat) ?? 0) + 1);
    cont.set(chave, porCat);
  }
  let n = 0;
  for (const [chave, porCat] of cont) {
    const total = [...porCat.values()].reduce((a, b) => a + b, 0);
    const [domCat, domN] = [...porCat.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (total < 2 || domN / total < 0.7) continue;
    const ex = tabela("regras_categorizacao").find(
      (r) => r.empresa_id === p.p_empresa && r.padrao === chave && r.tipo_match === "contem"
    );
    if (ex) {
      if (ex.origem === "manual") continue;
      atualizar("regras_categorizacao", ex, {
        categoria_id: domN >= Number(ex.acertos) ? domCat : ex.categoria_id,
        acertos: Math.max(Number(ex.acertos), domN),
        ativo: true,
      });
    } else {
      inserir("regras_categorizacao", {
        id: uuid(), empresa_id: p.p_empresa, padrao: chave, tipo_match: "contem", categoria_id: domCat,
        origem: "aprendida", acertos: domN, ativo: true,
        criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
      });
    }
    n++;
  }
  return n;
});

// ─── Cobranças de clientes (migrações 22 e 26) ─────────────────────────────
registrarRpc("fn_gerar_cobrancas", (p) => {
  const empresa = p.p_empresa;
  if (!cargoTem(empresa, "clientes_gerir")) {
    return falhar('new row violates row-level security policy for table "cobrancas"', "42501");
  }
  const agora = new Date();
  const limite = `${agora.getFullYear()}-${pad2(agora.getMonth() + 1)}-01`;
  const [ly, lm] = [agora.getFullYear(), agora.getMonth() + 2]; // até o mês seguinte
  const fim = toISO(new Date(ly, lm - 1, 1));
  let n = 0;
  // Uma cobrança por mensalidade ATIVA de cliente ativo (migração 52).
  for (const m of tabela("cliente_mensalidades")) {
    if (m.empresa_id !== empresa || !m.ativo) continue;
    const c = tabela("clientes").find((x) => x.id === m.cliente_id);
    if (!c || !c.ativo) continue;
    const desdeCliente = `${String(c.cliente_desde ?? String(c.criado_em ?? limite).slice(0, 10)).slice(0, 7)}-01`;
    const inicio = `${String(m.inicio ?? limite).slice(0, 7)}-01`;
    let comp = inicio > desdeCliente ? inicio : desdeCliente;
    for (let g = 0; comp <= fim && g < 240; g++) {
      const existe = tabela("cobrancas").some((x) => x.mensalidade_id === m.id && x.competencia === comp);
      if (!existe) {
        const nominal = `${comp.slice(0, 8)}${pad2(Math.min(Number(m.dia_vencimento ?? 5), 28))}`;
        inserir("cobrancas", {
          id: uuid(), empresa_id: empresa, cliente_id: c.id, mensalidade_id: m.id, competencia: comp,
          vencimento: diaUtilAnteriorEmpresa(empresa, nominal), valor: Number(m.valor),
          status: "aberto", pago_em: null, pago_valor: null, movimentacao_id: null,
          descricao: String(m.descricao ?? "Mensalidade"), criado_em: new Date().toISOString(),
        });
        n++;
      }
      const d = deISO(comp);
      comp = toISO(new Date(d.getFullYear(), d.getMonth() + 1, 1));
    }
  }
  return n;
});

registrarRpc("fn_conciliar_cobrancas", (p) => {
  const empresa = p.p_empresa;
  if (!cargoTem(empresa, "clientes_gerir")) return 0;
  let n = 0;
  const abertas = tabela("cobrancas")
    .filter((cb) => cb.empresa_id === empresa && cb.status === "aberto")
    .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  for (const cb of abertas) {
    const cl = tabela("clientes").find((c) => c.id === cb.cliente_id);
    const chave = String((cl?.chave_ofx as string)?.trim() || cl?.nome || "");
    if (chave.trim().length < 3) continue;
    const alvo = normalizaDescricao(chave);
    const valor = Number(cb.valor);
    const de = addDias(String(cb.competencia), -10);
    const dAte = deISO(String(cb.competencia));
    const ate = toISO(new Date(dAte.getFullYear(), dAte.getMonth() + 2, dAte.getDate()));
    const usadas = new Set(tabela("cobrancas").map((x) => x.movimentacao_id).filter(Boolean));
    const cands = tabela("movimentacoes")
      .filter(
        (m) =>
          m.empresa_id === empresa && m.tipo === "in" && m.categoria_status === "confirmada" &&
          normalizaDescricao(m.descricao).includes(alvo) &&
          Math.abs(Number(m.valor) - valor) <= Math.max(2, valor * 0.02) &&
          String(m.data) >= de && String(m.data) <= ate && !usadas.has(m.id)
      )
      .sort((a, b) => {
        const da = Math.abs(deISO(String(a.data)).getTime() - deISO(String(cb.vencimento)).getTime());
        const db = Math.abs(deISO(String(b.data)).getTime() - deISO(String(cb.vencimento)).getTime());
        return da - db || Math.abs(Number(a.valor) - valor) - Math.abs(Number(b.valor) - valor);
      });
    const m = cands[0];
    if (m) {
      Object.assign(cb, { status: "pago", pago_em: m.data, pago_valor: Number(m.valor), movimentacao_id: m.id });
      n++;
    }
  }
  return n;
});

// ─── Previstos / dia útil (migrações 26, 27, 32) ───────────────────────────
registrarRpc("fn_limpar_previstos_vencidos", (p) => {
  if (!cargoTem(p.p_empresa, "contas_gerir")) return 0;
  const h = hoje();
  const inicioMes = `${h.slice(0, 7)}-01`;
  return remover(
    "previstos",
    (x) =>
      x.empresa_id === p.p_empresa &&
      String(x.data) < h &&
      !(x.tipo === "out" && (x.pago === false || String(x.data) >= inicioMes))
  );
});

registrarRpc("fn_feriados_efetivos", (p) => feriadosEfetivos(p.p_empresa, String(p.p_de), String(p.p_ate)));

registrarRpc("fn_ajustar_dia_util", (p) => {
  const h = hoje();
  let n = 0;
  if (cargoTem(p.p_empresa, "contas_gerir")) {
    for (const x of tabela("previstos")) {
      if (x.empresa_id !== p.p_empresa || String(x.data) < h) continue;
      const aj = diaUtilAnteriorEmpresa(x.empresa_id, String(x.data));
      if (aj !== x.data) { x.data = aj; n++; }
    }
  }
  if (cargoTem(p.p_empresa, "clientes_gerir")) {
    for (const c of tabela("cobrancas")) {
      if (c.empresa_id !== p.p_empresa || c.status !== "aberto" || String(c.vencimento) < h) continue;
      const aj = diaUtilAnteriorEmpresa(c.empresa_id, String(c.vencimento));
      if (aj !== c.vencimento) { c.vencimento = aj; n++; }
    }
  }
  return n;
});

// ─── Pagamentos diários (migração 39) ──────────────────────────────────────
registrarRpc("fn_estornar_pagamento_diario", (p) => {
  if (!isMaster()) falhar("Apenas o administrador master pode estornar um pagamento já pago.");
  const motivo = String(p.p_motivo ?? "").trim();
  if (!motivo) falhar("Informe o motivo do estorno.");
  const pg = tabela("pagamentos_diarios").find((x) => x.id === p.p_id);
  if (!pg) return falhar("Pagamento não encontrado.");
  if (!pg.pago) falhar("Só dá para estornar um pagamento marcado como pago.");
  if (pg.estornado) falhar("Este pagamento já foi estornado.");
  atualizar("pagamentos_diarios", pg, { estornado: true, estornado_em: new Date().toISOString(), estorno_motivo: motivo });
  return null;
});

// ─── Saldo (migração 41) ───────────────────────────────────────────────────
registrarRpc("fn_ajustar_saldo_inicial", (p) => {
  if (!isMaster()) falhar("Apenas o administrador master pode ajustar o saldo inicial.");
  const motivo = String(p.p_motivo ?? "").trim();
  if (!motivo) falhar("Informe o motivo do ajuste.");
  if (p.p_modo !== "saldo" && p.p_modo !== "ajuste") falhar(`Modo invalido: ${p.p_modo} (use 'saldo' ou 'ajuste')`);
  if (p.p_valor === null || p.p_valor === undefined) falhar("Informe o valor.");
  const conta = tabela("contas_bancarias").find((c) => c.id === p.p_conta);
  if (!conta) return falhar("Conta bancaria nao encontrada.");
  const antes = Number(conta.saldo_inicial);
  let novo: number;
  let dataIni = String(conta.saldo_inicial_data);
  if (p.p_modo === "ajuste") {
    novo = round2(antes + Number(p.p_valor));
  } else {
    if (!p.p_data) falhar("Informe a data do saldo do banco.");
    const movs = tabela("movimentacoes").filter(
      (m) => m.conta_id === conta.id && m.empresa_id === conta.empresa_id &&
        m.categoria_status === "confirmada" && String(m.data) <= String(p.p_data)
    );
    const soma = movs.reduce((s, m) => s + (m.tipo === "in" ? 1 : -1) * Number(m.valor), 0);
    const primeira = movs.map((m) => String(m.data)).sort()[0];
    novo = round2(Number(p.p_valor) - soma);
    dataIni = primeira ? addDias(primeira, -1) : String(p.p_data);
  }
  Object.assign(conta, {
    saldo_inicial: novo, saldo_inicial_data: dataIni, saldo_ajustado_em: new Date().toISOString(),
    saldo_ajustado_por: uid(), saldo_ajuste_motivo: motivo,
  });
  return {
    conta: conta.nome, saldo_inicial_antes: antes, saldo_inicial_depois: novo,
    saldo_inicial_data: dataIni, diferenca: round2(novo - antes),
  };
});

// ─── Empresas, membros e cargos (migrações 13, 28, 29, 36, 40) ─────────────
// Empresas por módulo (migração 44): "financeiro", "rh" ou os dois.
function normalizarModulos(valor: unknown): string[] {
  const lista = [...new Set((Array.isArray(valor) ? valor : []).map((m) => String(m ?? "").trim().toLowerCase()).filter(Boolean))].sort();
  if (lista.length === 0 || lista.some((m) => m !== "financeiro" && m !== "rh")) falhar("Escolha Financeiro, RH ou os dois");
  return lista;
}

function prepararFinanceiro(empresaId: string) {
  if (!tabela("configuracoes").some((c) => c.empresa_id === empresaId)) {
    inserir("configuracoes", { empresa_id: empresaId, saldo_inicial: 0, saldo_inicial_data: hoje(), funcionalidades: {}, atualizado_em: new Date().toISOString() });
  }
  if (!tabela("contas_bancarias").some((c) => c.empresa_id === empresaId)) {
    inserir("contas_bancarias", {
      id: uuid(), empresa_id: empresaId, nome: "Conta principal", banco: "Conta PJ", ordem: 0, ativo: true,
      saldo_inicial: 0, saldo_inicial_data: hoje(), criado_em: new Date().toISOString(),
    });
  }
}

const mesmaEmpresa = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

registrarRpc("criar_empresa", (p) => {
  const modulos = normalizarModulos(p.p_modulos ?? ["financeiro"]);
  if (!isMaster()) falhar("Apenas o master pode criar empresas");
  const nome = String(p.p_nome ?? "").trim();
  if (!nome) falhar("Informe o nome da empresa");
  if (tabela("empresas").some((e) => mesmaEmpresa(e.nome, nome))) falhar(`Já existe uma empresa com o nome ${nome}`);
  const id = uuid();
  inserir("empresas", { id, nome, modulos, criado_em: new Date().toISOString() });
  inserir("empresa_membros", { empresa_id: id, user_id: uid(), papel: "admin", criado_em: new Date().toISOString() });
  if (modulos.includes("financeiro")) prepararFinanceiro(id);
  return id;
});

registrarRpc("fn_definir_modulos_empresa", (p) => {
  const modulos = normalizarModulos(p.p_modulos);
  if (!isMaster()) falhar("Apenas o master pode alterar os módulos de uma empresa");
  const empresa = tabela("empresas").find((e) => e.id === p.p_empresa);
  if (!empresa) return falhar("Empresa não encontrada");
  const atuais = (empresa.modulos as string[] | undefined) ?? ["financeiro", "rh"];
  const temDados = (tabelas: string[], pred: (r: Row) => boolean) => tabelas.some((tb) => tabela(tb).some(pred));
  if (atuais.includes("financeiro") && !modulos.includes("financeiro")
    && temDados(["movimentacoes", "previstos", "pagamentos_diarios", "clientes"], (r) => r.empresa_id === empresa.id)) {
    falhar(`A empresa ${empresa.nome} já tem lançamentos no Financeiro; o módulo não pode ser desligado`);
  }
  if (atuais.includes("rh") && !modulos.includes("rh")
    && temDados(["rh.funcionarios", "rh.candidatos", "rh.pagamentos_diarios"], (r) => mesmaEmpresa(r.empresa, empresa.nome))) {
    falhar(`A empresa ${empresa.nome} já tem cadastros no RH; o módulo não pode ser desligado`);
  }
  empresa.modulos = modulos;
  if (modulos.includes("financeiro")) prepararFinanceiro(String(empresa.id));
  return modulos;
});

// Empresas do RH que a pessoa enxerga: master todas; senão as da lista do acesso (null = todas).
registrarRpc("fn_empresas_rh", () => {
  const acesso = tabela("rh_acessos").find((a) => a.user_id === uid());
  if (!isMaster() && !acesso) return [];
  const lista = !isMaster() && Array.isArray(acesso?.empresas) ? (acesso?.empresas as string[]) : null;
  return tabela("empresas")
    .filter((e) => ((e.modulos as string[] | undefined) ?? ["financeiro", "rh"]).includes("rh"))
    .filter((e) => lista === null || lista.some((x) => mesmaEmpresa(x, e.nome)))
    .map((e) => ({ id: e.id, nome: e.nome }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
});

registrarRpc("fn_excluir_empresa", (p) => {
  if (!isMaster()) falhar("Apenas o master pode excluir empresas.");
  const alvo = tabela("empresas").find((e) => e.id === p.p_empresa);
  if (!alvo) return falhar("Empresa não encontrada.");
  const contagem: Record<string, number> = {};
  let total = 0;
  for (const t of ["cobrancas", "movimentacoes", "previstos", "recorrentes", "regras", "regras_categorizacao",
    "orcamentos", "pagamentos_processos", "vendas", "pagamentos_diarios", "clientes", "plano_contas", "contas_bancarias"]) {
    const n = tabela(t).filter((r) => r.empresa_id === p.p_empresa).length;
    contagem[t] = n;
    total += n;
  }
  remover("empresas", (e) => e.id === p.p_empresa);
  return { ...contagem, total };
});

registrarRpc("listar_membros", (p) => {
  if (!isMaster()) return [];
  const users = tabela("auth.users");
  return tabela("empresa_membros")
    .filter((m) => m.empresa_id === p.p_empresa)
    .map((m) => ({
      user_id: m.user_id,
      email: users.find((u) => u.id === m.user_id)?.email ?? "",
      is_master: !!tabela("perfis").find((x) => x.user_id === m.user_id)?.is_master,
      papel: m.papel,
    }))
    .sort((a, b) => String(a.email).localeCompare(String(b.email)));
});

registrarRpc("vincular_membro_por_email", (p) => {
  if (!isMaster()) falhar("Apenas o master pode vincular membros");
  const papel = String(p.p_papel ?? "operador");
  if (!tabela("cargos").some((c) => c.chave === papel)) falhar(`Cargo invalido: ${papel}`);
  const u = tabela("auth.users").find((x) => String(x.email).toLowerCase() === String(p.p_email).toLowerCase());
  if (!u) return falhar(`Usuario ${p.p_email} nao existe. Crie em Authentication > Users primeiro.`);
  if (!tabela("perfis").some((x) => x.user_id === u.id)) inserir("perfis", { user_id: u.id, is_master: false, criado_em: new Date().toISOString(), nome: u.nome ?? null });
  const ex = tabela("empresa_membros").find((m) => m.empresa_id === p.p_empresa && m.user_id === u.id);
  if (ex) ex.papel = papel;
  else inserir("empresa_membros", { empresa_id: p.p_empresa, user_id: u.id, papel, criado_em: new Date().toISOString() });
  return u.id;
});

registrarRpc("definir_papel_membro", (p) => {
  if (!isMaster()) falhar("Apenas o master pode definir papeis");
  if (!tabela("cargos").some((c) => c.chave === p.p_papel)) falhar(`Cargo invalido: ${p.p_papel}`);
  const m = tabela("empresa_membros").find((x) => x.empresa_id === p.p_empresa && x.user_id === p.p_user);
  if (m) atualizar("empresa_membros", m, { papel: p.p_papel });
  return null;
});

const CAPS_VALIDAS = [
  "ver_dashboard", "ver_relatorios", "mov_gerir", "contas_gerir", "clientes_gerir", "plano_gerir",
  "config_gerir", "vendas_gerir", "pag_diario_gerir",
];

registrarRpc("salvar_cargo", (p) => {
  if (!isMaster()) falhar("Apenas o master pode gerenciar cargos");
  const nome = String(p.p_nome ?? "").trim();
  if (!nome) falhar("Informe o nome do cargo");
  const chave = String(p.p_chave ?? "").trim() || `c_${uuid().replace(/-/g, "").slice(0, 16)}`;
  let caps = (p.p_caps as string[] | null) ?? [];
  for (const c of caps) if (!CAPS_VALIDAS.includes(c)) falhar(`Capacidade invalida: ${c}`);
  const ex = tabela("cargos").find((c) => c.chave === chave);
  if (ex) ex.nome = nome;
  else inserir("cargos", { chave, nome, is_sistema: false, ordem: 100, criado_em: new Date().toISOString() });
  if (chave === "admin") caps = CAPS_VALIDAS;
  remover("cargo_capacidades", (r) => r.cargo_chave === chave);
  for (const c of new Set(caps)) inserir("cargo_capacidades", { cargo_chave: chave, capacidade: c });
  return chave;
});

registrarRpc("excluir_cargo", (p) => {
  if (!isMaster()) falhar("Apenas o master pode excluir cargos");
  if (tabela("cargos").some((c) => c.chave === p.p_chave && c.is_sistema)) falhar("Cargos de sistema nao podem ser excluidos");
  if (tabela("empresa_membros").some((m) => m.papel === p.p_chave)) falhar("Cargo em uso por um ou mais membros. Troque o papel deles antes.");
  remover("cargo_capacidades", (r) => r.cargo_chave === p.p_chave);
  remover("cargos", (r) => r.chave === p.p_chave);
  return null;
});

registrarRpc("copiar_plano_contas", (p) => {
  if (!isMaster()) falhar("Apenas o master pode copiar o plano de contas");
  const origem = tabela("plano_contas").filter((c) => c.empresa_id === p.p_origem);
  const destino = tabela("plano_contas").filter((c) => c.empresa_id === p.p_destino);
  const mapa = new Map<unknown, unknown>();
  let n = 0;
  const copiar = (c: Row, parentDestino: unknown) => {
    const ja = destino.find((d) => d.nome === c.nome && (d.parent_id ?? null) === (parentDestino ?? null));
    const novoId = ja ? ja.id : uuid();
    if (!ja) {
      inserir("plano_contas", { ...c, id: novoId, empresa_id: p.p_destino, parent_id: parentDestino ?? null, criado_em: new Date().toISOString() });
      n++;
    }
    mapa.set(c.id, novoId);
  };
  for (const c of origem.filter((x) => x.parent_id == null)) copiar(c, null);
  for (const c of origem.filter((x) => x.parent_id != null)) copiar(c, mapa.get(c.parent_id));
  return n;
});

registrarRpc("pode_gerir_usuarios", () =>
  isMaster() || tabela("empresa_membros").some((m) => m.user_id === uid() && m.papel === "admin")
);

// Empresas que o chamador administra (null = master, vale para todas).
export function escopoAdmin(): string[] | null {
  if (isMaster()) return null;
  return tabela("empresa_membros").filter((m) => m.user_id === uid() && m.papel === "admin").map((m) => String(m.empresa_id));
}

registrarRpc("listar_usuarios_gerenciaveis", () => {
  const escopo = escopoAdmin();
  if (escopo !== null && escopo.length === 0) return [];
  const users = tabela("auth.users");
  const perfis = tabela("perfis");
  const alvos = escopo === null
    ? users.map((u) => u.id)
    : [...new Set(tabela("empresa_membros").filter((m) => escopo.includes(String(m.empresa_id))).map((m) => m.user_id))]
        .filter((id) => !perfis.find((x) => x.user_id === id)?.is_master);
  return users
    .filter((u) => alvos.includes(u.id) && !u.deleted_at)
    .map((u) => {
      const perfil = perfis.find((x) => x.user_id === u.id);
      return {
        user_id: u.id,
        email: u.email,
        nome: perfil?.nome ?? u.nome ?? null,
        is_master: !!perfil?.is_master,
        criado_em: u.created_at,
        ultimo_login: u.last_sign_in_at ?? null,
        vinculos: tabela("empresa_membros")
          .filter((m) => m.user_id === u.id && (escopo === null || escopo.includes(String(m.empresa_id))))
          .map((m) => ({
            empresaId: m.empresa_id,
            empresa: tabela("empresas").find((e) => e.id === m.empresa_id)?.nome ?? "",
            papel: m.papel,
          })),
      };
    })
    .sort((a, b) => String(a.nome ?? a.email).localeCompare(String(b.nome ?? b.email)));
});

// ─── Banco Inter (migração 30) — simulado, sem segredo nenhum ──────────────
registrarRpc("fn_inter_status", (p) => {
  if (!temAcessoEmpresa(p.p_empresa)) return [];
  return tabela("integracoes_inter")
    .filter((i) => i.empresa_id === p.p_empresa)
    .map((i) => ({
      conta_id: i.conta_id, ativo: i.ativo, ultimo_saldo: i.ultimo_saldo, ultimo_saldo_em: i.ultimo_saldo_em,
      ultima_sync: i.ultima_sync, ultimo_erro: i.ultimo_erro,
      client_id_mask: isMaster() ? `••••${String(i.client_id ?? "").slice(-4)}` : null,
    }));
});

registrarRpc("fn_inter_salvar", (p) => {
  if (!isMaster()) falhar("Apenas o master configura a integração.");
  const conta = tabela("contas_bancarias").find((c) => c.id === p.p_conta);
  if (!conta) return falhar("Conta bancaria nao encontrada.");
  const ex = tabela("integracoes_inter").find((i) => i.conta_id === p.p_conta);
  // O protótipo NÃO guarda segredo algum: só um marcador do client_id.
  const dados = { client_id: `demo-${String(p.p_client_id ?? "").slice(-4)}`, client_secret: "", cert_pem: "", key_pem: "", conta_corrente: p.p_conta_corrente ?? null, ativo: true };
  if (ex) Object.assign(ex, dados, { atualizado_em: new Date().toISOString() });
  else inserir("integracoes_inter", { id: uuid(), empresa_id: conta.empresa_id, conta_id: conta.id, ...dados, criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() });
  return null;
});

registrarRpc("fn_inter_toggle", (p) => {
  if (!isMaster()) falhar("Apenas o master configura a integração.");
  const i = tabela("integracoes_inter").find((x) => x.conta_id === p.p_conta);
  if (i) i.ativo = !!p.p_ativo;
  return null;
});

registrarRpc("fn_inter_remover", (p) => {
  if (!isMaster()) falhar("Apenas o master configura a integração.");
  remover("integracoes_inter", (x) => x.conta_id === p.p_conta);
  return null;
});

// ─── Pix do dia × pagamentos diários do RH (migração 43) ───────────────────
// Mão única: quem tem pag_diario_gerir na empresa lê o que o RH lançou para
// ela. A empresa do RH é texto; casa pelo nome (rh_empresa_corresponde).
export function empresaCorresponde(nomeFinanceiro: unknown, empresaRh: unknown): boolean {
  const rh = String(empresaRh ?? "").trim().toLowerCase();
  const fin = String(nomeFinanceiro ?? "").trim().toLowerCase();
  return rh !== "" && (fin === rh || fin.startsWith(`${rh} `));
}

registrarRpc("fn_rh_pagamentos_para_pix", (p) => {
  if (!cargoTem(p.p_empresa, "pag_diario_gerir")) {
    falhar("Sem permissão para ver os pagamentos diários desta empresa", "42501");
  }
  const empresa = tabela("empresas").find((e) => e.id === p.p_empresa);
  if (!empresa) return [];
  const de = String(p.p_de);
  const ate = String(p.p_ate);
  return tabela("rh.pagamentos_diarios")
    .filter((r) => {
      const d = String(r.data_pagamento ?? "");
      return d >= de && d <= ate && empresaCorresponde(empresa.nome, r.empresa);
    })
    .map((r) => {
      const doc = (r.data ?? {}) as Row;
      return {
        id: String(r.id),
        data: String(r.data_pagamento),
        pessoa: String(r.pessoa || doc.pessoa || ""),
        chave_pix: String(doc.pix ?? ""),
        forma: String(doc.formaPagamento || "Pix"),
        valor: Number(r.valor ?? 0),
        descricao: String(doc.descricao ?? ""),
        pago: ["true", "t", "1", "sim"].includes(String(doc.pago ?? "").toLowerCase()),
        empresa_rh: r.empresa ?? null,
      };
    })
    .sort((a, b) => b.data.localeCompare(a.data) || a.id.localeCompare(b.id));
});

// ─── Compromissos do RH vistos pelo Financeiro (migração 48) ──────────────
// Mesma regra do SQL: o que o RH já lançou por pessoa (adiantamento/salário),
// os pagamentos diários e — só onde o RH ainda não lançou — a projeção pelo
// salário × percentual de adiantamento.
const ultimoDiaMes = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

// Dia do mês ajustado para trás até cair em dia útil (sábado/domingo saem).
const diaUtilAte = (ano: number, mes: number, dia: number): string => {
  const alvo = Math.min(Math.max(dia, 1), ultimoDiaMes(`${ano}-${pad2(mes)}`));
  const d = new Date(ano, mes - 1, alvo);
  for (let i = 0; i < 10 && (d.getDay() === 0 || d.getDay() === 6); i++) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const mesesDaJanela = (de: string, ate: string): { comp: string; ano: number; mes: number }[] => {
  const out: { comp: string; ano: number; mes: number }[] = [];
  let [y, m] = de.slice(0, 7).split("-").map(Number);
  // Um mês antes, como no SQL: o período pode pegar a folha da competência anterior.
  if (m === 1) { y -= 1; m = 12; } else { m -= 1; }
  const fim = ate.slice(0, 7);
  for (let i = 0; i < 48; i++) {
    const comp = `${y}-${pad2(m)}`;
    if (comp > fim) break;
    out.push({ comp, ano: y, mes: m });
    if (m === 12) { y += 1; m = 1; } else { m += 1; }
  }
  return out;
};

registrarRpc("fn_rh_compromissos_financeiros", (p) => {
  const empresaId = p.p_empresa;
  // A folha por pessoa é para quem já vê o dinheiro da empresa inteira. O cargo
  // de Pagamentos Diários (só Pix) recebe apenas os pagamentos diários.
  const veFolha = isMaster() || cargoTem(empresaId, "ver_dashboard") || cargoTem(empresaId, "contas_gerir");
  if (!(veFolha || cargoTem(empresaId, "pag_diario_gerir"))) {
    falhar("Sem permissão para ver os compromissos do RH desta empresa", "42501");
  }
  const empresa = tabela("empresas").find((e) => e.id === empresaId);
  if (!empresa) return [];
  const de = String(p.p_de);
  const ate = String(p.p_ate);
  const cfg = ((tabela("rh.config")[0]?.data ?? {}) as Row) || {};
  const pctPadrao = Number(cfg.percentualAdiant ?? 40);
  const valeDia = Number(cfg.valeDia ?? 20);
  const naJanela = (d: string) => !!d && d >= de && d <= ate;
  const doDocumento = (r: Row) => (r.data ?? {}) as Row;

  const funcionarios = tabela("rh.funcionarios");
  const nomeDe = (id: unknown) => String(funcionarios.find((f) => f.id === id)?.nome ?? "");

  // 1) Lançamentos do RH por pessoa.
  const lancados = (veFolha ? tabela("rh.pagamentos") : [])
    .filter((r) => ["Adiantamento", "Salário"].includes(String(r.tipo)) && empresaCorresponde(empresa.nome, r.empresa))
    .map((r) => {
      const doc = doDocumento(r);
      const data = String(doc.dataRealizada || doc.dataPagamento || doc.dataPrevista || "");
      return {
        id: String(r.id),
        origem: r.tipo === "Adiantamento" ? "adiantamento" : "salario",
        fonte: "rh_pagamentos",
        pessoa: String(doc.nome || nomeDe(r.funcionario_id)),
        funcionario_id: r.funcionario_id ?? null,
        competencia: String(r.competencia ?? ""),
        data,
        valor: Number(r.valor ?? 0),
        status: doc.status === "Realizado" || doc.dataPagamento ? "realizado" : "projetado",
        descricao: r.tipo === "Adiantamento" ? "Adiantamento quinzenal (RH)" : "Salário — folha (RH)",
        empresa_rh: r.empresa ?? null,
      };
    });

  const saida = lancados.filter((l) => naJanela(l.data) && l.valor !== 0);

  // 2) Pagamentos diários do RH.
  for (const r of tabela("rh.pagamentos_diarios")) {
    const d = String(r.data_pagamento ?? "");
    if (!naJanela(d) || !empresaCorresponde(empresa.nome, r.empresa)) continue;
    const doc = doDocumento(r);
    saida.push({
      id: `rhd-${r.id}`,
      origem: "diario",
      fonte: "rh_pagamentos_diarios",
      pessoa: String(r.pessoa || doc.pessoa || ""),
      funcionario_id: null,
      competencia: d.slice(0, 7),
      data: d,
      valor: Number(r.valor ?? 0),
      status: ["true", "t", "1", "sim"].includes(String(doc.pago ?? "").toLowerCase()) ? "realizado" : "projetado",
      descricao: String(doc.descricao || "Pagamento diário (RH)"),
      empresa_rh: r.empresa ?? null,
    });
  }

  // 3) Projeção, só onde o RH ainda não lançou a competência.
  const ativos = veFolha
    ? funcionarios.filter((f) => String(f.status ?? "").toLowerCase() === "ativo" && empresaCorresponde(empresa.nome, f.empresa))
    : [];
  for (const { comp, ano, mes } of mesesDaJanela(de, ate)) {
    for (const f of ativos) {
      const doc = doDocumento(f);
      const adi = ((doc.beneficios as Row)?.adiantamento ?? {}) as Row;
      const salario = Number(doc.salarioBase ?? 0);
      const valorAdi = !adi.ativo
        ? 0
        : adi.tipo === "valor"
          ? Number(adi.valorManual ?? 0)
          : adi.tipo === "personalizado"
            ? Math.round(salario * Number(adi.percentual ?? 0)) / 100
            : Math.round(salario * pctPadrao) / 100;
      const temLancamento = (origem: string) =>
        lancados.some((l) => l.funcionario_id === f.id && l.competencia === comp && l.origem === origem);

      const dataVale = diaUtilAte(ano, mes, valeDia);
      if (valorAdi > 0 && naJanela(dataVale) && !temLancamento("adiantamento")) {
        saida.push({
          id: `proj-adi-${f.id}-${comp}`, origem: "adiantamento", fonte: "projecao",
          pessoa: String(f.nome ?? ""), funcionario_id: f.id ?? null, competencia: comp, data: dataVale,
          valor: valorAdi, status: "projetado",
          descricao: "Adiantamento quinzenal (projeção do RH)", empresa_rh: f.empresa ?? null,
        });
      }
      const dataFolha = diaUtilAte(ano, mes, 31);
      const liquido = Math.round((salario - valorAdi) * 100) / 100;
      if (liquido > 0 && naJanela(dataFolha) && !temLancamento("salario")) {
        saida.push({
          id: `proj-sal-${f.id}-${comp}`, origem: "salario", fonte: "projecao",
          pessoa: String(f.nome ?? ""), funcionario_id: f.id ?? null, competencia: comp, data: dataFolha,
          valor: liquido, status: "projetado",
          descricao: "Salário — folha (projeção do RH)", empresa_rh: f.empresa ?? null,
        });
      }
    }
  }

  return saida.sort((a, b) => a.data.localeCompare(b.data) || String(a.id).localeCompare(String(b.id)));
});

// ─── Cobranças de uma venda (migração 50) ─────────────────────────────────
// Mesma regra do SQL: confere a soma das parcelas contra o valor da venda,
// apaga as parcelas ainda EM ABERTO e grava as novas. Parcela paga fica.
registrarRpc("fn_cobrancas_da_venda", (p) => {
  const venda = tabela("vendas").find((v) => v.id === p.p_venda);
  if (!venda) return falhar("Venda não encontrada.");
  if (!venda.cliente_id) return falhar("A venda precisa de um cliente do cadastro para gerar cobranças.");
  if (!cargoTem(venda.empresa_id, "clientes_gerir")) {
    return falhar("Sem permissão para gerar cobranças nesta empresa", "42501");
  }
  const parcelas = (p.p_parcelas ?? []) as { valor: number | string; vencimento: string }[];
  if (parcelas.length === 0) return falhar("Informe ao menos uma parcela.");
  const total = Number(venda.valor_bruto ?? 0);
  const soma = round2(parcelas.reduce((s, x) => s + Number(x.valor ?? 0), 0));
  if (Math.abs(soma - total) > parcelas.length * 0.01) {
    return falhar(`A soma das parcelas (${soma}) não bate com o valor da venda (${total}).`);
  }

  remover("cobrancas", (c) => c.venda_id === venda.id && c.status === "aberto");
  const descricao = String(venda.descricao || "Venda");
  parcelas.forEach((x, i) => {
    const venc = String(x.vencimento);
    inserir("cobrancas", {
      id: uuid(),
      empresa_id: venda.empresa_id,
      cliente_id: venda.cliente_id,
      venda_id: venda.id,
      competencia: `${venc.slice(0, 7)}-01`,
      vencimento: venc,
      valor: round2(Number(x.valor ?? 0)),
      parcela: i + 1,
      parcelas_total: parcelas.length,
      forma_pagamento: venda.forma_pagamento ?? null,
      descricao: `${descricao} · parcela ${i + 1}/${parcelas.length}`,
      status: "aberto",
      pago_em: null,
      pago_valor: null,
      movimentacao_id: null,
      criado_por: uid(),
      criado_em: new Date().toISOString(),
    });
  });
  return parcelas.length;
});

// ─── Quem é quem na empresa (migração 50) ─────────────────────────────────
registrarRpc("fn_membros_da_empresa", (p) => {
  if (!temAcessoEmpresa(p.p_empresa)) return [];
  const perfis = tabela("perfis");
  return tabela("empresa_membros")
    .filter((m) => m.empresa_id === p.p_empresa)
    .map((m) => {
      const u = tabela("auth.users").find((x) => x.id === m.user_id);
      if (!u || u.deleted_at) return null;
      return {
        user_id: m.user_id,
        email: u.email ?? "",
        nome: perfis.find((x) => x.user_id === m.user_id)?.nome ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a!.email).localeCompare(String(b!.email)));
});

// ─── Totais mensais do RH (migração 49) ───────────────────────────────────
// Mesma regra do SQL: salários, adiantamento, VT e VR somados por competência.
// É daqui que a recorrência de Folha tira o valor de cada mês.
registrarRpc("fn_rh_totais_mensais", (p) => {
  const empresaId = p.p_empresa;
  if (!(isMaster() || cargoTem(empresaId, "ver_dashboard") || cargoTem(empresaId, "contas_gerir"))) {
    falhar("Sem permissão para ver os totais do RH desta empresa", "42501");
  }
  const empresa = tabela("empresas").find((e) => e.id === empresaId);
  if (!empresa) return [];
  const cfg = ((tabela("rh.config")[0]?.data ?? {}) as Row) || {};
  const pctPadrao = Number(cfg.percentualAdiant ?? 40);
  const diasUteisCfg = Number(cfg.diasUteis ?? 22);
  const vrDiario = Number(cfg.vrDiario ?? 0);
  const vrBase = String(cfg.vrBaseDias ?? "uteis");
  const vrFixos = Number(cfg.vrDiasFixos ?? 22);
  const prop = cfg.vrProporcionalAdmissao === true;
  const feriados = new Set((cfg.feriados as string[] | undefined) ?? []);

  const ativos = tabela("rh.funcionarios").filter(
    (f) => String(f.status ?? "").toLowerCase() === "ativo" && empresaCorresponde(empresa.nome, f.empresa)
  );

  // Adiantamento RECEBIDO por pessoa e competência (migração 59): lançado no RH
  // e dado como pago — status Realizado ou dataRealizada preenchida.
  const adiPago = new Map<string, number>();
  for (const r of tabela("rh.pagamentos")) {
    if (r.tipo !== "Adiantamento") continue;
    const doc = (r.data ?? {}) as Row;
    if (doc.status !== "Realizado" && !String(doc.dataRealizada ?? "")) continue;
    const k = `${r.funcionario_id}|${r.competencia}`;
    adiPago.set(k, (adiPago.get(k) ?? 0) + Number(r.valor ?? 0));
  }

  const saida: Row[] = [];
  const de = String(p.p_de).slice(0, 7);
  const ate = String(p.p_ate).slice(0, 7);
  let [y, m] = de.split("-").map(Number);
  for (let i = 0; i < 48; i++) {
    const comp = `${y}-${pad2(m)}`;
    if (comp > ate) break;
    const corridos = new Date(y, m, 0).getDate();
    let uteis = 0;
    for (let d = 1; d <= corridos; d++) {
      const dt = new Date(y, m - 1, d);
      const iso = `${comp}-${pad2(d)}`;
      if (dt.getDay() !== 0 && dt.getDay() !== 6 && !feriados.has(iso)) uteis++;
    }
    const diasVR = vrBase === "corridos" ? corridos : vrBase === "fixo" ? vrFixos : uteis;

    let salarios = 0, adiantamento = 0, vt = 0, vr = 0, folhaLiquida = 0;
    for (const f of ativos) {
      const doc = (f.data ?? {}) as Row;
      const ben = (doc.beneficios ?? {}) as Row;
      const adi = (ben.adiantamento ?? {}) as Row;
      const benVT = (ben.vt ?? {}) as Row;
      const benVR = (ben.vr ?? {}) as Row;
      const salario = Number(doc.salarioBase ?? 0);
      salarios += salario;
      folhaLiquida += Math.max(0, salario - (adiPago.get(`${f.id}|${comp}`) ?? 0));

      if (adi.ativo) {
        adiantamento +=
          adi.tipo === "valor"
            ? Number(adi.valorManual ?? 0)
            : Math.round(salario * Number(adi.tipo === "personalizado" ? adi.percentual ?? 0 : pctPadrao)) / 100;
      }
      if (benVT.ativo) {
        const valorDia =
          benVT.modo === "valorDia"
            ? Number(benVT.valorDia ?? 0)
            : Object.values((benVT.conducoes ?? {}) as Record<string, Row>).reduce(
                (s, c) => s + Number(c?.qtd ?? 0) * Number(c?.valor ?? 0), 0
              );
        vt += valorDia * diasUteisCfg;
      }
      if (benVR.ativo) {
        const proprio = String(benVR.diasTrabalhados ?? "").trim();
        vr += (proprio === "" ? diasVR : Number(proprio)) * vrDiario;
      }
    }
    saida.push({
      competencia: comp,
      salarios: round2(salarios),
      adiantamento: round2(adiantamento),
      vt: round2(vt),
      vr: round2(vr),
      pessoas: ativos.length,
      folha_liquida: round2(folhaLiquida),
      vr_aproximado: prop,
    });
    if (m === 12) { y += 1; m = 1; } else { m += 1; }
  }
  return saida;
});

// ─── Administração por pessoa (migração 45) ───────────────────────────────
registrarRpc("fn_definir_master", (p) => {
  if (!isMaster()) falhar("Apenas o administrador pode dar ou tirar a administração");
  const master = p.p_master === true;
  if (p.p_user === uid() && !master) falhar("Você não pode tirar a sua própria administração");
  if (!tabela("auth.users").some((u) => u.id === p.p_user)) falhar("Usuário não encontrado");
  const perfil = tabela("perfis").find((x) => x.user_id === p.p_user);
  if (perfil) atualizar("perfis", perfil, { is_master: master });
  else inserir("perfis", { user_id: p.p_user, is_master: master, criado_em: new Date().toISOString(), nome: null });
  if (!tabela("perfis").some((x) => x.is_master === true)) falhar("O sistema precisa de pelo menos um administrador");
  return null;
});
