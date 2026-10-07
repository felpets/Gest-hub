// ─── Cliente Supabase simulado (protótipo, dados fictícios) ────────────────
// Implementa o subconjunto do supabase-js usado pelo Financeiro e pelo RH:
//   from(t).select/insert/update/delete/upsert + eq/neq/in/gt/gte/lt/lte/is/
//   like/ilike/not/or/match + order/range/limit/single/maybeSingle + count/head
//   rpc(), storage.from(bucket), auth.*, channel() (no-op), functions (no-op).
// Cada chamada devolve { data, error, count } como o original — nunca lança —
// e respeita as policies espelhadas em ./acl, as unicidades, as cascatas e os
// gatilhos relevantes do banco real (trava/histórico do Pix diário etc.).
import { tabela, specOf, marcarAlterado, clone, normalizarUnicidade, type Row } from "./db";
import { policyDe } from "./acl";
import { mockAuth } from "./auth";
import { executarRpc } from "./rpc";
import { antesDeGravar, depoisDeGravar, antesDeExcluir, cascatasDe, TriggerError } from "./triggers";

export type PgError = { message: string; code: string; details: string | null; hint: string | null };
export const pgError = (message: string, code = "P0001"): PgError => ({ message, code, details: null, hint: null });

type Result = { data: unknown; error: PgError | null; count: number | null; status: number; statusText: string };

const latencia = () => new Promise((r) => setTimeout(r, 40 + Math.random() * 80));

// ─── Comparação no estilo Postgres ─────────────────────────────────────────
const isNum = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v.trim()));
function igual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === "number" || typeof b === "number") return isNum(a) && isNum(b) && Number(a) === Number(b);
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b);
  return String(a) === String(b);
}
function comparar(a: unknown, b: unknown): number {
  if ((typeof a === "number" || typeof b === "number") && isNum(a) && isNum(b)) return Number(a) - Number(b);
  const sa = String(a), sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
const likeRegex = (pat: string, flags: string) =>
  new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", flags);

type Filtro = (r: Row) => boolean;

function filtroOp(col: string, op: string, val: string): Filtro {
  const v = val === "null" ? null : val;
  switch (op) {
    case "eq": return (r) => igual(r[col], v);
    case "neq": return (r) => r[col] != null && !igual(r[col], v);
    case "gt": return (r) => r[col] != null && comparar(r[col], v) > 0;
    case "gte": return (r) => r[col] != null && comparar(r[col], v) >= 0;
    case "lt": return (r) => r[col] != null && comparar(r[col], v) < 0;
    case "lte": return (r) => r[col] != null && comparar(r[col], v) <= 0;
    case "is": return (r) => (v === null ? r[col] == null : String(r[col]) === String(v));
    case "like": return (r) => r[col] != null && likeRegex(String(v), "").test(String(r[col]));
    case "ilike": return (r) => r[col] != null && likeRegex(String(v), "i").test(String(r[col]));
    case "in": {
      const lista = String(val).replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
      return (r) => lista.some((x) => igual(r[col], x));
    }
    default: return () => true;
  }
}

// Seleção de colunas: "id, nome, status" (sem relações embutidas — o app não usa).
function projetar(row: Row, cols: string): Row {
  const lista = cols.split(",").map((c) => c.trim()).filter(Boolean);
  if (lista.length === 0 || lista.includes("*")) return clone(row);
  const out: Row = {};
  for (const item of lista) {
    const [alias, nome] = item.includes(":") ? item.split(":").map((s) => s.trim()) : [item, item];
    out[alias] = clone(row[nome] ?? null);
  }
  return out;
}

const chave = (row: Row, cols: string[]) => cols.map((c) => JSON.stringify(row[c] ?? null)).join("|");

function violaUnicidade(table: string, row: Row, ignorar?: Row): PgError | null {
  const spec = specOf(table);
  const grupos = [{ cols: spec.pk, onde: () => true }, ...(spec.unique ?? []).map(normalizarUnicidade)];
  for (const { cols, onde } of grupos) {
    if (cols.some((c) => row[c] === null || row[c] === undefined)) continue; // null não colide
    if (!onde(row)) continue;                                                // índice parcial
    const k = chave(row, cols);
    const dup = tabela(table).some((r) => r !== ignorar && onde(r) && chave(r, cols) === k);
    if (dup) {
      return {
        message: `duplicate key value violates unique constraint "${table.replace(".", "_")}_${cols.join("_")}_key"`,
        code: "23505",
        details: `Key (${cols.join(", ")})=(${cols.map((c) => String(row[c])).join(", ")}) already exists.`,
        hint: null,
      };
    }
  }
  return null;
}

const rlsErro = (table: string) =>
  pgError(`new row violates row-level security policy for table "${table}"`, "42501");

// ─── Query builder ─────────────────────────────────────────────────────────
type Op = "select" | "insert" | "update" | "delete" | "upsert";

class MockQuery implements PromiseLike<Result> {
  private op: Op = "select";
  private cols = "*";
  private retornar = false;
  private filtros: Filtro[] = [];
  private ordens: { col: string; asc: boolean; nullsFirst?: boolean }[] = [];
  private de: number | null = null;
  private ate: number | null = null;
  private lim: number | null = null;
  private modoUnico: "single" | "maybe" | null = null;
  private contar = false;
  private head = false;
  private payload: Row | Row[] | null = null;
  private onConflict: string[] | null = null;
  private ignoreDuplicates = false;

  constructor(private table: string, private bypass = false) {}

  // Leitura (ou "returning" depois de insert/update/delete).
  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    this.cols = cols;
    if (this.op === "select") {
      this.contar = !!opts?.count;
      this.head = !!opts?.head;
    } else {
      this.retornar = true;
    }
    return this;
  }
  insert(rows: Row | Row[], _opts?: unknown) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = "upsert";
    this.payload = rows;
    this.onConflict = opts?.onConflict ? opts.onConflict.split(",").map((s) => s.trim()) : null;
    this.ignoreDuplicates = !!opts?.ignoreDuplicates;
    return this;
  }
  update(patch: Row, opts?: { count?: string }) {
    this.op = "update";
    this.payload = patch;
    this.contar = !!opts?.count;
    return this;
  }
  delete(opts?: { count?: string }) {
    this.op = "delete";
    this.contar = !!opts?.count;
    return this;
  }

  eq(col: string, v: unknown) { this.filtros.push((r) => igual(r[col], v)); return this; }
  neq(col: string, v: unknown) { this.filtros.push((r) => r[col] != null && !igual(r[col], v)); return this; }
  gt(col: string, v: unknown) { this.filtros.push((r) => r[col] != null && comparar(r[col], v) > 0); return this; }
  gte(col: string, v: unknown) { this.filtros.push((r) => r[col] != null && comparar(r[col], v) >= 0); return this; }
  lt(col: string, v: unknown) { this.filtros.push((r) => r[col] != null && comparar(r[col], v) < 0); return this; }
  lte(col: string, v: unknown) { this.filtros.push((r) => r[col] != null && comparar(r[col], v) <= 0); return this; }
  is(col: string, v: unknown) {
    this.filtros.push((r) => (v === null ? r[col] == null : String(r[col]) === String(v)));
    return this;
  }
  in(col: string, lista: unknown[]) { this.filtros.push((r) => lista.some((x) => igual(r[col], x))); return this; }
  like(col: string, p: string) { this.filtros.push((r) => r[col] != null && likeRegex(p, "").test(String(r[col]))); return this; }
  ilike(col: string, p: string) { this.filtros.push((r) => r[col] != null && likeRegex(p, "i").test(String(r[col]))); return this; }
  match(obj: Row) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  filter(col: string, op: string, val: string) { this.filtros.push(filtroOp(col, op, val)); return this; }
  not(col: string, op: string, val: unknown) {
    const f = filtroOp(col, op, val === null ? "null" : String(val));
    this.filtros.push((r) => !f(r));
    return this;
  }
  contains(col: string, val: unknown) {
    this.filtros.push((r) => {
      const atual = r[col];
      if (Array.isArray(atual) && Array.isArray(val)) return val.every((x) => atual.includes(x));
      if (atual && typeof atual === "object" && val && typeof val === "object")
        return Object.entries(val).every(([k, x]) => igual((atual as Row)[k], x));
      return false;
    });
    return this;
  }
  // "col.op.valor,col2.op.valor" (sem aninhamento and()).
  or(expr: string) {
    const partes = expr.split(",").map((p) => p.trim()).filter(Boolean);
    const fs = partes.map((p) => {
      const [col, op, ...resto] = p.split(".");
      return filtroOp(col, op, resto.join("."));
    });
    this.filtros.push((r) => fs.some((f) => f(r)));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.ordens.push({ col, asc: opts?.ascending !== false, nullsFirst: opts?.nullsFirst });
    return this;
  }
  range(de: number, ate: number) { this.de = de; this.ate = ate; return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.modoUnico = "single"; return this; }
  maybeSingle() { this.modoUnico = "maybe"; return this; }
  abortSignal() { return this; }
  throwOnError() { return this; }

  then<T1 = Result, T2 = never>(
    ok?: ((v: Result) => T1 | PromiseLike<T1>) | null,
    fail?: ((e: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return latencia().then(() => this.executar()).then(ok, fail);
  }

  private resposta(data: unknown, count: number | null = null, status = 200): Result {
    return { data, error: null, count, status, statusText: "OK" };
  }
  private falha(error: PgError, status = 400): Result {
    return { data: null, error, count: null, status, statusText: "Error" };
  }

  private visiveis(): Row[] {
    const pol = policyDe(this.table);
    return tabela(this.table).filter((r) => (this.bypass || pol.read(r)) && this.filtros.every((f) => f(r)));
  }

  private ordenar(rows: Row[]): Row[] {
    if (this.ordens.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const o of this.ordens) {
        const va = a[o.col], vb = b[o.col];
        const na = va === null || va === undefined, nb = vb === null || vb === undefined;
        if (na || nb) {
          if (na && nb) continue;
          const nullsFirst = o.nullsFirst ?? !o.asc; // padrão do Postgres
          return (na ? -1 : 1) * (nullsFirst ? 1 : -1);
        }
        const c = comparar(va, vb);
        if (c !== 0) return o.asc ? c : -c;
      }
      return 0;
    });
  }

  private fatiar(rows: Row[]): Row[] {
    let out = rows;
    if (this.de !== null && this.ate !== null) out = out.slice(this.de, this.ate + 1);
    if (this.lim !== null) out = out.slice(0, this.lim);
    return out;
  }

  private finalizar(rows: Row[], count: number | null): Result {
    const proj = rows.map((r) => projetar(r, this.cols));
    if (this.modoUnico) {
      if (proj.length === 1) return this.resposta(proj[0], count);
      if (proj.length === 0 && this.modoUnico === "maybe") return this.resposta(null, count);
      return this.falha(
        pgError(
          proj.length === 0 ? "JSON object requested, multiple (or no) rows returned" : "JSON object requested, multiple (or no) rows returned",
          "PGRST116"
        ),
        406
      );
    }
    return this.resposta(proj, count);
  }

  private executar(): Result {
    try {
      switch (this.op) {
        case "select": return this.execSelect();
        case "insert": return this.execInsert(false);
        case "upsert": return this.execInsert(true);
        case "update": return this.execUpdate();
        case "delete": return this.execDelete();
      }
    } catch (e) {
      if (e instanceof TriggerError) return this.falha(pgError(e.message, e.code));
      return this.falha(pgError(e instanceof Error ? e.message : String(e)), 500);
    }
  }

  private execSelect(): Result {
    const todas = this.ordenar(this.visiveis());
    const count = this.contar ? todas.length : null;
    if (this.head) return this.resposta(null, count);
    return this.finalizar(this.fatiar(todas), count);
  }

  private execInsert(upsert: boolean): Result {
    const pol = policyDe(this.table);
    const spec = specOf(this.table);
    const entrada = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
    const gravadas: Row[] = [];
    // Validação primeiro (tudo ou nada, como numa transação).
    const novas: { row: Row; alvo?: Row }[] = [];
    for (const bruto of entrada) {
      const row: Row = { ...(spec.defaults ? spec.defaults() : {}), ...clone(bruto) };
      let alvo: Row | undefined;
      if (upsert) {
        const cols = this.onConflict ?? spec.pk;
        const k = chave(row, cols);
        alvo = tabela(this.table).find((r) => chave(r, cols) === k);
        if (alvo && this.ignoreDuplicates) continue;
      }
      if (!this.bypass && !pol.write(alvo ? { ...alvo, ...clone(bruto) } : row)) return this.falha(rlsErro(this.table), 403);
      novas.push({ row: alvo ? { ...alvo, ...clone(bruto) } : row, alvo });
    }
    for (const n of novas) {
      const erro = violaUnicidade(this.table, n.row, n.alvo);
      if (erro) return this.falha(erro, 409);
      const lote = novas.filter((x) => x !== n && !x.alvo);
      if (!n.alvo && lote.some((x) => violaUnicidadeEntre(this.table, n.row, x.row))) {
        return this.falha(pgError("duplicate key value violates unique constraint", "23505"), 409);
      }
    }
    for (const n of novas) {
      if (n.alvo) {
        const antes = clone(n.alvo);
        const depois = antesDeGravar(this.table, "UPDATE", n.row, antes);
        Object.assign(n.alvo, depois);
        depoisDeGravar(this.table, "UPDATE", n.alvo, antes);
        gravadas.push(n.alvo);
      } else {
        const depois = antesDeGravar(this.table, "INSERT", n.row, null);
        tabela(this.table).push(depois);
        depoisDeGravar(this.table, "INSERT", depois, null);
        gravadas.push(depois);
      }
    }
    marcarAlterado();
    if (!this.retornar) return this.resposta(null, null, 201);
    return this.finalizar(gravadas, null);
  }

  private execUpdate(): Result {
    const pol = policyDe(this.table);
    const alvo = this.visiveis().filter((r) => this.bypass || pol.write(r));
    const patch = clone(this.payload as Row);
    // Checagem prévia (WITH CHECK + unicidade) antes de alterar qualquer linha.
    for (const r of alvo) {
      const novo = { ...r, ...patch };
      if (!this.bypass && !pol.write(novo)) return this.falha(rlsErro(this.table), 403);
      const erro = violaUnicidade(this.table, novo, r);
      if (erro) return this.falha(erro, 409);
    }
    const alteradas: Row[] = [];
    for (const r of alvo) {
      const antes = clone(r);
      const depois = antesDeGravar(this.table, "UPDATE", { ...r, ...patch }, antes);
      Object.assign(r, depois);
      depoisDeGravar(this.table, "UPDATE", r, antes);
      alteradas.push(r);
    }
    if (alteradas.length) marcarAlterado();
    const count = this.contar ? alteradas.length : null;
    if (!this.retornar) return this.resposta(null, count, 204);
    return this.finalizar(alteradas, count);
  }

  private execDelete(): Result {
    const pol = policyDe(this.table);
    const alvo = this.visiveis().filter((r) => this.bypass || pol.write(r));
    for (const r of alvo) antesDeExcluir(this.table, r);
    const ids = new Set(alvo);
    const restantes = tabela(this.table).filter((r) => !ids.has(r));
    tabela(this.table).splice(0, tabela(this.table).length, ...restantes);
    for (const r of alvo) {
      cascatasDe(this.table, r);
      depoisDeGravar(this.table, "DELETE", null, r);
    }
    if (alvo.length) marcarAlterado();
    const count = this.contar ? alvo.length : null;
    if (!this.retornar) return this.resposta(null, count, 204);
    return this.finalizar(alvo, count);
  }
}

function violaUnicidadeEntre(table: string, a: Row, b: Row): boolean {
  const spec = specOf(table);
  return [{ cols: spec.pk, onde: () => true }, ...(spec.unique ?? []).map(normalizarUnicidade)].some(
    ({ cols, onde }) =>
      cols.every((c) => a[c] != null && b[c] != null) && onde(a) && onde(b) && chave(a, cols) === chave(b, cols)
  );
}

// ─── Storage em memória ────────────────────────────────────────────────────
const arquivos = new Map<string, Blob>();
const PLACEHOLDER =
  "data:text/plain;charset=utf-8," +
  encodeURIComponent("Arquivo de demonstração do protótipo Zaytan Hub (dados fictícios).");

function storageBucket(bucket: string) {
  const k = (p: string) => `${bucket}/${p}`;
  return {
    async upload(path: string, file: Blob, opts?: { upsert?: boolean }) {
      await latencia();
      if (arquivos.has(k(path)) && !opts?.upsert) return { data: null, error: pgError("The resource already exists", "409") };
      arquivos.set(k(path), file);
      return { data: { path, id: path, fullPath: k(path) }, error: null };
    },
    async createSignedUrl(path: string, _secs: number) {
      const b = arquivos.get(k(path));
      return { data: { signedUrl: b ? URL.createObjectURL(b) : PLACEHOLDER }, error: null };
    },
    async createSignedUrls(paths: string[], _secs: number) {
      return {
        data: paths.map((p) => ({ path: p, signedUrl: arquivos.get(k(p)) ? URL.createObjectURL(arquivos.get(k(p))!) : PLACEHOLDER, error: null })),
        error: null,
      };
    },
    getPublicUrl(path: string) {
      const b = arquivos.get(k(path));
      return { data: { publicUrl: b ? URL.createObjectURL(b) : PLACEHOLDER } };
    },
    async download(path: string) {
      const b = arquivos.get(k(path));
      return b ? { data: b, error: null } : { data: new Blob(["Arquivo de demonstração (dados fictícios)."]), error: null };
    },
    async remove(paths: string[]) {
      for (const p of paths) arquivos.delete(k(p));
      return { data: paths.map((p) => ({ name: p })), error: null };
    },
    async list(prefix = "") {
      const base = k(prefix);
      const nomes = [...arquivos.keys()].filter((x) => x.startsWith(base)).map((x) => ({ name: x.slice(base.length).replace(/^\//, "") }));
      return { data: nomes, error: null };
    },
  };
}

// ─── Fábrica ───────────────────────────────────────────────────────────────
// `prefixo` separa os "projetos": o RH usa createMockClient("rh").
export function createMockClient(prefixo = "") {
  const nome = (t: string) => (prefixo ? `${prefixo}.${t}` : t);
  const canal = {
    on() { return canal; },
    subscribe(cb?: (s: string) => void) { cb?.("SUBSCRIBED"); return canal; },
    unsubscribe() { return Promise.resolve("ok"); },
  };
  return {
    from: (t: string) => new MockQuery(nome(t)),
    rpc: async (fn: string, params: Record<string, unknown> = {}) => {
      await latencia();
      try {
        const data = executarRpc(prefixo ? `${prefixo}.${fn}` : fn, params);
        marcarAlterado();
        return { data, error: null, count: null, status: 200, statusText: "OK" };
      } catch (e) {
        const err = e instanceof TriggerError ? pgError(e.message, e.code) : pgError(e instanceof Error ? e.message : String(e));
        return { data: null, error: err, count: null, status: 400, statusText: "Error" };
      }
    },
    auth: mockAuth,
    storage: { from: storageBucket },
    functions: { invoke: async () => ({ data: null, error: pgError("Edge Functions indisponíveis no protótipo.") }) },
    channel: () => canal,
    removeChannel: async () => "ok",
    removeAllChannels: async () => [],
  };
}

// Acesso interno (RPCs/gatilhos/seed) que ignora as policies — equivale a
// SECURITY DEFINER / owner no banco real.
export const interno = (t: string) => new MockQuery(t, true);
