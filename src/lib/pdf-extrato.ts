// Leitura de extrato em PDF (C6 Bank).
//
// O C6 PJ não exporta OFX — só PDF. O PDF é "de texto" (não é imagem), então dá
// para reconstruir a tabela pelas coordenadas de cada pedaço de texto: itens na
// mesma altura (y) formam uma linha; a distância horizontal (x) entre eles diz
// se continuam a mesma célula ou se já é a coluna seguinte.
//
// Layout do extrato C6:
//   Data lançamento | Data contábil | Tipo | Descrição | Valor
//   04/05             04/05           Entrada PIX  Pix recebido de ...  R$ 0,01
//
// A data usada é a de LANÇAMENTO (1ª coluna): é por ela que o próprio C6 agrupa
// os meses e soma o "Entradas/Saídas" de cada mês (a contábil pode cair no mês
// seguinte, ex.: lançamento 30/05 com contábil 01/06 entra no total de maio).
//
// O pdfjs é carregado sob demanda (import dinâmico) — são ~1 MB que só pesam
// quando o usuário realmente envia um PDF.
import {
  buildRow, parseData, parseValor,
  type OfxAccountMeta, type OfxLedger, type ParsedRow,
} from "@/lib/import-parsers";
import { norm } from "@/lib/format";

// Uma linha do PDF já quebrada em células (colunas), da esquerda para a direita.
export type PdfLine = string[];

// Um pedaço de texto do PDF com sua posição na página (origem no canto inferior
// esquerdo, em pontos).
export type PdfItem = { str: string; x: number; y: number; w: number };

// Itens até ~2pt de diferença em y estão visualmente na mesma linha.
const Y_TOL = 2;
// Espaço horizontal (em pontos) a partir do qual é outra COLUNA. As colunas do
// C6 ficam a 40pt+ umas das outras; palavras da mesma frase, a menos de 3pt.
const GAP_COLUNA = 12;

// ─── Extração do PDF → linhas/células ───────────────────────
// Agrupa os itens de uma linha em células: junta o que está colado (mesma
// palavra/frase) e abre uma célula nova quando o espaço é de coluna.
function itensParaCelulas(itens: PdfItem[]): PdfLine {
  const ordenados = itens.filter((i) => i.str.trim() !== "").sort((a, b) => a.x - b.x);
  const celulas: string[] = [];
  let atual = "";
  let fim = 0;
  for (const it of ordenados) {
    const gap = it.x - fim;
    if (!atual) atual = it.str;
    else if (gap < 0.8) atual += it.str;          // partido no meio da palavra (acento)
    else if (gap < GAP_COLUNA) atual += ` ${it.str}`; // outra palavra, mesma célula
    else { celulas.push(atual); atual = it.str; }     // próxima coluna
    fim = it.x + it.w;
  }
  if (atual) celulas.push(atual);
  return celulas.map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function itensParaLinhas(itens: PdfItem[]): PdfLine[] {
  const ordenados = [...itens].sort((a, b) => b.y - a.y || a.x - b.x); // topo → base
  const linhas: PdfLine[] = [];
  let grupo: PdfItem[] = [];
  let y = NaN;
  for (const it of ordenados) {
    if (grupo.length && Math.abs(it.y - y) > Y_TOL) {
      linhas.push(itensParaCelulas(grupo));
      grupo = [];
    }
    if (!grupo.length) y = it.y;
    grupo.push(it);
  }
  if (grupo.length) linhas.push(itensParaCelulas(grupo));
  return linhas.filter((l) => l.length > 0);
}

// Lê o PDF no navegador e devolve as linhas de todas as páginas, em ordem.
export async function extractPdfLines(file: File): Promise<PdfLine[]> {
  const pdfjs = await import("pdfjs-dist");
  // O worker é servido como asset pelo Vite (fica fora do bundle principal).
  const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const linhas: PdfLine[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const conteudo = await page.getTextContent();
      const itens: PdfItem[] = [];
      for (const item of conteudo.items) {
        if (!("str" in item)) continue; // marcador de estrutura, não é texto
        itens.push({ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width });
      }
      linhas.push(...itensParaLinhas(itens));
      page.cleanup();
    }
    return linhas;
  } finally {
    await doc.destroy();
  }
}

// ─── Parser do extrato C6 (puro, testável) ──────────────────
const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const RE_DIA_MES = /^(\d{2})\/(\d{2})$/;
const RE_VALOR = /^-?\s*R\$\s*[\d.]+,\d{2}$/;
// "Maio 2026 ( 01/05/2026 - 31/05/2026 )" — cabeçalho de mês
const RE_SECAO_MES = /^([a-zç]+)\s+(\d{4})\b/i;
// "Saldo do dia 20/08/26" — fecha cada dia; o último é o saldo final do extrato
const RE_SALDO_DIA = /^saldo do dia\s+(\d{2})\/(\d{2})\/(\d{2})$/i;
// "Agência: 1 • Conta: 423163442" — a agência do C6 PJ é sempre 1, então só a
// conta identifica (por isso o grupo dela não é capturado).
const RE_AGENCIA_CONTA = /ag[eê]ncia:\s*[\w-]+\s*[•·|-]\s*conta:\s*([\d.-]+)/i;

// Compensação nº 336 do C6 Bank — vira o `bankId` da conta, igual ao OFX.
const C6_BANK_ID = "336";

// Ano do lançamento a partir do mês da seção (o extrato só mostra dd/mm).
// Numa seção de janeiro, um 31/12 é do ano anterior; em dezembro, um 01/01 é do
// seguinte — na prática o C6 agrupa pela data de lançamento, mas a guarda evita
// datas absurdas caso o arquivo traga alguma exceção.
function anoDoLancamento(mes: number, mesSecao: number, anoSecao: number): number {
  if (mesSecao === 1 && mes === 12) return anoSecao - 1;
  if (mesSecao === 12 && mes === 1) return anoSecao + 1;
  return anoSecao;
}

export function parseExtratoPdf(linhas: PdfLine[]): {
  rows: ParsedRow[];
  account: OfxAccountMeta | null;
  ledger: OfxLedger | null;
} {
  const rows: ParsedRow[] = [];
  let ledger: OfxLedger | null = null;
  let acctId: string | null = null;
  let ehC6 = false;

  let mesSecao = 0;
  let anoSecao = 0;

  for (const celulas of linhas) {
    const primeira = celulas[0] ?? "";
    const ultima = celulas[celulas.length - 1] ?? "";
    const linhaToda = celulas.join(" ");

    if (!ehC6 && /c6\s*bank/i.test(linhaToda)) ehC6 = true;

    if (!acctId) {
      const m = linhaToda.match(RE_AGENCIA_CONTA);
      if (m) acctId = m[1];
    }

    // Cabeçalho de mês: fixa o ano das datas dd/mm que vierem a seguir.
    const secao = primeira.match(RE_SECAO_MES);
    if (secao) {
      const mes = MESES[norm(secao[1])];
      if (mes) { mesSecao = mes; anoSecao = Number(secao[2]); continue; }
    }

    // "Saldo do dia dd/mm/aa" + valor: o último do arquivo é o saldo que o banco
    // informa depois de todos os lançamentos — é o que serve para conciliar.
    const saldo = primeira.match(RE_SALDO_DIA);
    if (saldo) {
      const valor = parseValor(ultima);
      if (valor !== null) {
        ledger = { amount: valor, asOfISO: `20${saldo[3]}-${saldo[2]}-${saldo[1]}` };
      }
      continue;
    }

    // Transação: dd/mm (lançamento) | dd/mm (contábil) | tipo | descrição | valor
    const dia = primeira.match(RE_DIA_MES);
    if (!dia || celulas.length < 4 || !RE_DIA_MES.test(celulas[1]) || !RE_VALOR.test(ultima)) continue;

    const tipoCol = celulas[2];
    const descricao = celulas.slice(3, -1).join(" ").trim() || tipoCol;
    const ano = anoSecao ? anoDoLancamento(Number(dia[2]), mesSecao, anoSecao) : 0;
    const dataRaw = ano ? `${dia[1]}/${dia[2]}/${ano}` : `${dia[1]}/${dia[2]}`;

    rows.push(
      buildRow({
        linha: rows.length + 1,
        dataRaw,
        descRaw: descricao,
        valorRaw: ultima,
        // Sem o cabeçalho do mês não dá para saber o ano — melhor recusar a
        // linha do que gravar um lançamento com data errada.
        data: ano ? parseData(dataRaw) : null,
        valorNum: parseValor(ultima),
        fitid: null, // o PDF não traz identificador do banco; dedup fica por conteúdo
      })
    );
  }

  if (rows.length === 0) {
    throw new Error("PDF sem transações reconhecidas — esperado um extrato do C6 Bank.");
  }

  const account: OfxAccountMeta | null = acctId
    ? {
        bankId: C6_BANK_ID,
        acctId,
        acctType: "CHECKING",
        org: ehC6 ? "C6 Bank" : null,
        fid: null,
        fingerprint: `${C6_BANK_ID}|${acctId}`,
      }
    : null;

  return { rows, account, ledger };
}
