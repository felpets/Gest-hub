import * as XLSX from "xlsx";
import { pad } from "@/lib/datas";
import { norm } from "@/lib/format";
import { chaveConteudo } from "@/lib/conciliacao";

// Linha já interpretada do arquivo importado. `categoria` é editável na tela
// (escolhida pelo usuário no plano de contas). O MovimentacaoInput final é
// montado na hora de importar, mesclando a categoria escolhida.
export type ParsedRow = {
  linha: number;
  ok: boolean;
  erro?: string;
  // valores crus (para exibir mesmo quando inválida)
  dataRaw: string;
  descRaw: string;
  valorRaw: string;
  // interpretados (quando ok)
  data?: string; // YYYY-MM-DD
  descricao?: string;
  valor?: number; // sempre positivo
  tipo?: "in" | "out";
  fitid?: string | null;
  categoria: string; // editável; vazio até o usuário escolher
  duplicate?: boolean; // já existe no banco (por FITID ou por conteúdo)
  dupContent?: boolean; // duplicata detectada por CONTEÚDO (dia+valor+tipo+descrição), sem FITID igual
  dupNoArquivo?: boolean; // a repetição está no próprio arquivo, não no que já foi importado
  incluirMesmoAssim?: boolean; // usuário decidiu importar apesar da duplicata
};

// Identidade da conta lida do cabeçalho do OFX (quando presente). Serve para
// casar/criar a conta bancária certa na importação. Null quando o arquivo não
// traz esse bloco (ou quando é CSV/Excel).
export type OfxAccountMeta = {
  bankId: string | null;      // <BANKID>
  acctId: string | null;      // <ACCTID>
  acctType: string | null;    // <ACCTTYPE> (CHECKING/SAVINGS/CREDITCARD...)
  org: string | null;         // <ORG> (nome do banco)
  fid: string | null;         // <FID>
  fingerprint: string | null; // `${bankId}|${acctId}`, ou null se faltar algum
};

// Saldo informado pelo próprio banco no OFX (<LEDGERBAL>): o valor exato da
// conta numa data. Serve para acertar o saldo inicial e bater com o banco.
export type OfxLedger = { amount: number; asOfISO: string };

// Resultado de um arquivo importado: as linhas + a conta detectada (1 por arquivo).
export type FileParse = {
  fileName: string;
  source: "ofx" | "sheet" | "pdf";
  rows: ParsedRow[];
  account: OfxAccountMeta | null; // null p/ CSV/Excel ou OFX sem <BANKACCTFROM>
  ledger: OfxLedger | null;       // saldo do banco (OFX com <LEDGERBAL> ou PDF do C6)
};

// ─── Helpers ────────────────────────────────────────────────
// `norm` (remoção de acento/caixa) agora vive em @/lib/format; re-export mantido
// para compatibilidade com quem importava daqui.
export { norm };

// Acha um valor na linha por nomes de coluna alternativos (sem acento/caixa).
function pick(row: Record<string, unknown>, candidates: string[]): unknown {
  const map = new Map(Object.keys(row).map((k) => [norm(k), row[k]]));
  for (const c of candidates) {
    const v = map.get(c);
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

// "1.234,56" / "R$ 1.234,56" / "(1.234,56)" / "-80" / 1234.56 → número (com sinal)
export function parseValor(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[R$\s]/gi, "");
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s); // (1.234,56) = negativo
  s = s.replace(/[()]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); // formato BR
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

// dd/mm/aaaa, aaaa-mm-dd ou Date → "AAAA-MM-DD"
export function parseData(raw: unknown): string | null {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`;
  }
  const s = String(raw ?? "").trim();
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const d = +m[1], mo = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

const TIPO_IN = ["in", "entrada", "credito", "crédito", "c", "receita", "+"];
const TIPO_OUT = ["out", "saida", "saída", "debito", "débito", "d", "despesa", "-"];

// Monta e valida uma ParsedRow a partir dos campos brutos.
// Exportado para os parsers que vivem fora daqui (ex.: PDF em pdf-extrato.ts).
export function buildRow(p: {
  linha: number;
  dataRaw: string;
  descRaw: string;
  valorRaw: string;
  data: string | null;
  valorNum: number | null;
  tipoRaw?: string;
  fitid?: string | null;
  categoria?: string;
}): ParsedRow {
  const base = {
    linha: p.linha,
    dataRaw: p.dataRaw,
    descRaw: p.descRaw,
    valorRaw: p.valorRaw,
    fitid: p.fitid ?? null,
    categoria: p.categoria ?? "",
  };
  if (!p.descRaw.trim()) return { ...base, ok: false, erro: "Sem descrição" };
  if (!p.data) return { ...base, ok: false, erro: "Data inválida" };
  if (p.valorNum === null || p.valorNum === 0) return { ...base, ok: false, erro: "Valor inválido" };

  const t = norm(p.tipoRaw ?? "");
  let tipo: "in" | "out";
  if (TIPO_IN.includes(t)) tipo = "in";
  else if (TIPO_OUT.includes(t)) tipo = "out";
  else tipo = p.valorNum < 0 ? "out" : "in"; // sem tipo explícito: sinal do valor

  return {
    ...base,
    ok: true,
    data: p.data,
    descricao: p.descRaw.trim(),
    valor: Math.abs(p.valorNum),
    tipo,
  };
}

// ─── Duplicatas ─────────────────────────────────────────────
// O que já foi visto nesta importação. É compartilhado entre os arquivos da
// mesma conta (dá para mandar vários meses de uma vez) e mutado a cada linha.
export type VistoNoLote = { fitids: Set<string>; conteudos: Set<string> };
export const novoVistoNoLote = (): VistoNoLote => ({ fitids: new Set(), conteudos: new Set() });

// Marca cada linha comparando com o que já está gravado na conta (`existentes`)
// e com o que já passou neste mesmo lote (`visto`).
//
// Duplicata por FITID é o vínculo forte: mesmo código do banco = mesma
// transação. Por CONTEÚDO (dia+valor+tipo+descrição) é palpite, e vale separar
// os dois casos: repetir uma linha do PRÓPRIO arquivo costuma ser legítimo
// (o mesmo valor saindo duas vezes no dia é comum), enquanto repetir algo já
// gravado costuma ser reimportação. Quem decide é o usuário, na prévia.
export function marcarDuplicatas(
  rows: ParsedRow[],
  existentes: { fitids: Set<string>; conteudos: Set<string> },
  visto: VistoNoLote
): ParsedRow[] {
  return rows.map((r) => {
    const dupFitid = !!r.fitid && (existentes.fitids.has(r.fitid) || visto.fitids.has(r.fitid));
    if (r.fitid) visto.fitids.add(r.fitid);

    let dupContent = false;
    let dupNoArquivo = false;
    if (r.ok && r.data && r.valor != null && r.tipo) {
      const k = chaveConteudo({ dataISO: r.data, valor: r.valor, tipo: r.tipo, descricao: r.descricao ?? "" });
      const jaGravado = existentes.conteudos.has(k);
      const jaNoLote = visto.conteudos.has(k);
      dupNoArquivo = jaNoLote && !jaGravado;
      dupContent = jaGravado || jaNoLote;
      visto.conteudos.add(k);
    }

    return {
      ...r,
      duplicate: dupFitid || dupContent,
      dupContent: dupContent && !dupFitid,
      dupNoArquivo: dupNoArquivo && !dupFitid,
    };
  });
}

// ─── Planilha (CSV / Excel) ─────────────────────────────────
// Também lê a fatura de cartão exportada em Excel, que tem cabeçalhos próprios
// ("Data de compra", "Valor (em R$)") e colunas que não entram no lançamento:
// nome e final do cartão, categoria do emissor, parcela, valor em dólar e
// cotação. O valor em REAIS é procurado primeiro — numa compra internacional,
// pegar a coluna em dólar lançaria o valor errado.
const SHEET_DATA_COLS = [
  "data", "date", "dt", "data lancamento", "data movimento",
  "data de compra", "data da compra", "data compra", "data da transacao", "data de transacao",
];
const SHEET_DESC_COLS = ["descricao", "descrição", "historico", "histórico", "lancamento", "lançamento", "memo", "description", "detalhe", "estabelecimento"];
const SHEET_VALOR_COLS = [
  "valor (em r$)", "valor em r$", "valor (r$)", "valor r$", "valor (em reais)", "valor brl",
  "valor", "value", "amount", "montante",
];

export function mapSheetRow(row: Record<string, unknown>, linha: number): ParsedRow {
  const dataRaw = String(pick(row, SHEET_DATA_COLS) ?? "");
  const descRaw = String(pick(row, SHEET_DESC_COLS) ?? "");
  const valorVal = pick(row, SHEET_VALOR_COLS);
  const categoria = String(pick(row, ["categoria", "category"]) ?? "");
  const tipoRaw = String(pick(row, ["tipo", "type", "natureza"]) ?? "");

  return buildRow({
    linha,
    dataRaw,
    descRaw,
    valorRaw: valorVal == null ? "" : String(valorVal),
    data: parseData(dataRaw),
    valorNum: parseValor(valorVal),
    tipoRaw,
    categoria,
  });
}

// O cabeçalho nem sempre está na linha 1: a fatura do C6 abre com uma linha de
// título ("Razão Social: … Cartão C6 Business") e só depois vêm os nomes das
// colunas. Procura, nas primeiras linhas, a que tem data, descrição e valor;
// sem achar, fica com a primeira (comportamento de sempre).
const MAX_LINHAS_ATE_CABECALHO = 30;

function linhaDoCabecalho(sheet: XLSX.WorkSheet): number {
  const inicio = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).s.r : 0;
  const linhas = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: true });
  for (let i = 0; i < Math.min(linhas.length, MAX_LINHAS_ATE_CABECALHO); i++) {
    const celulas = new Set(linhas[i].map((c) => norm(String(c ?? ""))));
    const tem = (cols: string[]) => cols.some((c) => celulas.has(c));
    if (tem(SHEET_DATA_COLS) && tem(SHEET_DESC_COLS) && tem(SHEET_VALOR_COLS)) return inicio + i;
  }
  return inicio;
}

export function parseSheet(sheet: XLSX.WorkSheet): ParsedRow[] {
  const cabecalho = linhaDoCabecalho(sheet);
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false, range: cabecalho });
  return json.map((row, i) => mapSheetRow(row, cabecalho + i + 2)); // +2: 1-based e pula o cabeçalho
}

export async function parseSpreadsheet(file: File): Promise<ParsedRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  return parseSheet(wb.Sheets[wb.SheetNames[0]]);
}

// ─── Planilha de Contas a Pagar ─────────────────────────────
// Colunas do modelo: descrição, status (Pago/A cobrar/Não Pago), custo (R$), dia.
// Difere do extrato (data/valor): aqui o "dia" é um número 1..31 (dia do mês), o
// tipo é sempre saída, e cada linha vira uma REGRA de pagamento recorrente. O modo
// de vencimento, a categoria e o tipo são ajustados na tela de revisão.
export type ParsedContaPagarRow = {
  linha: number;
  ok: boolean;
  erro?: string;
  descRaw: string;
  custoRaw: string;
  statusRaw: string;
  diaRaw: string;
  descricao?: string;
  valor?: number; // sempre positivo
  dia?: number; // 1..28 (clampado); ausente = usuário define na revisão
  statusPago?: boolean; // status "Pago" na planilha
};

const CP_DESC_COLS = [
  "descricao", "descrição", "descriçao", "detalhes da despesa", "detalhes", "detalhe",
  "despesa", "conta", "fornecedor", "nome", "historico", "histórico",
];
const CP_CUSTO_COLS = ["custo", "valor", "valor (r$)", "custo (r$)", "montante", "preco", "preço", "valor mensal"];
const CP_DIA_COLS = ["dia", "dia vencimento", "dia do vencimento", "dia venc", "vencimento", "data da transacao", "data da transação", "data"];
const CP_STATUS_COLS = ["status", "situacao", "situação", "pago", "categoria"];
const CP_STATUS_PAGO = new Set(["pago", "paga", "quitado", "quitada", "sim", "ok"]);

// Extrai o "dia" (1..28). Aceita número puro ("1"), ou data ("01/07/2026" → 1).
function pickDia(diaRaw: string): number | undefined {
  const tok = diaRaw.split(/[^0-9]/).filter(Boolean)[0]; // 1º grupo numérico
  if (!tok) return undefined;
  const n = parseInt(tok, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(28, n);
}

function mapContaPagarRow(row: Record<string, unknown>, linha: number): ParsedContaPagarRow {
  const descRaw = String(pick(row, CP_DESC_COLS) ?? "").trim();
  const custoV = pick(row, CP_CUSTO_COLS);
  const custoRaw = custoV == null ? "" : String(custoV).trim();
  const diaRaw = String(pick(row, CP_DIA_COLS) ?? "").trim();
  const statusRaw = String(pick(row, CP_STATUS_COLS) ?? "").trim();

  const valorParsed = parseValor(custoV);
  const valor = valorParsed == null ? null : Math.abs(valorParsed);
  const dia = pickDia(diaRaw);
  const statusPago = statusRaw ? CP_STATUS_PAGO.has(norm(statusRaw)) : false;

  if (!descRaw) return { linha, ok: false, erro: "Sem descrição", descRaw, custoRaw, statusRaw, diaRaw };
  if (valor == null || valor === 0)
    return { linha, ok: false, erro: "Custo inválido", descRaw, custoRaw, statusRaw, diaRaw, descricao: descRaw };
  return { linha, ok: true, descRaw, custoRaw, statusRaw, diaRaw, descricao: descRaw, valor, dia, statusPago };
}

export async function parseContasPagarSheet(file: File): Promise<ParsedContaPagarRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  return json.map((row, i) => mapContaPagarRow(row, i + 2)); // +2: linha 1 = cabeçalho
}

// ─── OFX (1.x SGML e 2.x XML) ───────────────────────────────
// Pega o valor de uma tag: <TAG>valor  (até o próximo '<' ou fim de linha).
function ofxTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : "";
}

// DTPOSTED: AAAAMMDD[HHMMSS...] → AAAA-MM-DD
function ofxDate(raw: string): string | null {
  const m = raw.match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function parseOfx(text: string): { rows: ParsedRow[]; account: OfxAccountMeta; ledger: OfxLedger | null } {
  // O cabeçalho (tudo ANTES do 1º <STMTTRN>) traz a identidade da conta e do
  // banco — antes era descartado pelo .slice(1). Lê <BANKACCTFROM>/<CCACCTFROM>
  // e o <ORG> do <SONRS><FI>.
  const header = text.split(/<STMTTRN>/i)[0] ?? "";
  const acctBlock =
    header.match(/<BANKACCTFROM>[\s\S]*?<\/BANKACCTFROM>/i)?.[0] ??
    header.match(/<CCACCTFROM>[\s\S]*?<\/CCACCTFROM>/i)?.[0] ??
    header;
  const bankId = ofxTag(acctBlock, "BANKID") || null;
  const acctId = ofxTag(acctBlock, "ACCTID") || null;
  const account: OfxAccountMeta = {
    bankId,
    acctId,
    acctType: ofxTag(acctBlock, "ACCTTYPE") || null,
    org: ofxTag(header, "ORG") || null,
    fid: ofxTag(header, "FID") || null,
    fingerprint: bankId && acctId ? `${bankId}|${acctId}` : null,
  };

  // Cada transação fica em um bloco <STMTTRN>...</STMTTRN> (ou até o próximo).
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const rows = blocks.map((block, i) => {
    const dataRaw = ofxTag(block, "DTPOSTED");
    const valorRaw = ofxTag(block, "TRNAMT");
    const fitid = ofxTag(block, "FITID") || null;
    const name = ofxTag(block, "NAME");
    const memo = ofxTag(block, "MEMO");
    const trntype = ofxTag(block, "TRNTYPE");
    const descRaw =
      name && memo && name !== memo ? `${name} — ${memo}` : name || memo;

    // TRNTYPE CREDIT/DEBIT ajuda quando o sinal vem ausente.
    const tipoRaw = /credit/i.test(trntype) ? "in" : /debit/i.test(trntype) ? "out" : "";

    return buildRow({
      linha: i + 1,
      dataRaw,
      descRaw,
      valorRaw,
      data: ofxDate(dataRaw),
      valorNum: parseValor(valorRaw.replace(",", ".")), // OFX usa ponto decimal
      tipoRaw,
      fitid,
    });
  });

  // Saldo do banco: <LEDGERBAL><BALAMT>..</BALAMT><DTASOF>..</DTASOF>. Pega o
  // bloco LEDGERBAL específico (há também AVAILBAL) para não confundir o BALAMT.
  const ledgerBlock = text.match(/<LEDGERBAL>[\s\S]*?<\/LEDGERBAL>/i)?.[0] ?? "";
  const balAmt = ofxTag(ledgerBlock, "BALAMT");
  const asOf = ofxDate(ofxTag(ledgerBlock, "DTASOF"));
  const amount = balAmt ? Number(balAmt.replace(",", ".")) : NaN;
  const ledger: OfxLedger | null =
    Number.isFinite(amount) && asOf ? { amount, asOfISO: asOf } : null;

  return { rows, account, ledger };
}

// Lê arquivo OFX como texto, com fallback Latin-1 (OFX 1.x costuma ser ISO-8859-1).
async function readOfxText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  // Heurística: se aparecer caractere de substituição, tentar latin1.
  if (utf8.includes("�")) {
    try {
      return new TextDecoder("latin1").decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

// ─── Dispatcher por extensão ────────────────────────────────
// Devolve as linhas + a conta detectada (OFX/PDF) ou null (CSV/Excel).
export async function parseFile(file: File): Promise<FileParse> {
  if (/\.ofx$/i.test(file.name)) {
    const { rows, account, ledger } = parseOfx(await readOfxText(file));
    return { fileName: file.name, source: "ofx", rows, account, ledger };
  }
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    // Import dinâmico: o leitor de PDF (pdfjs, ~1 MB) só é baixado quando o
    // usuário manda um PDF de verdade.
    const { extractPdfLines, parseExtratoPdf } = await import("@/lib/pdf-extrato");
    const { rows, account, ledger } = parseExtratoPdf(await extractPdfLines(file));
    return { fileName: file.name, source: "pdf", rows, account, ledger };
  }
  const rows = await parseSpreadsheet(file);
  return { fileName: file.name, source: "sheet", rows, account: null, ledger: null };
}
