import { describe, it, expect } from "vitest";
import {
  parseValor, parseData, parseOfx, marcarDuplicatas, novoVistoNoLote, type ParsedRow,
  mapSheetRow, parseSheet,
} from "@/lib/import-parsers";
import * as XLSX from "xlsx";
import { chaveConteudo } from "@/lib/conciliacao";

describe("parseValor", () => {
  it("formato BR com milhar e vírgula decimal", () => {
    expect(parseValor("1.234,56")).toBe(1234.56);
    expect(parseValor("100,00")).toBe(100);
  });
  it("remove R$ e espaços", () => {
    expect(parseValor("R$ 1.000,00")).toBe(1000);
  });
  it("parênteses = negativo", () => {
    expect(parseValor("(50,00)")).toBe(-50);
    expect(parseValor("(1.234,56)")).toBe(-1234.56);
  });
  it("sinal negativo explícito e ponto decimal", () => {
    expect(parseValor("-80")).toBe(-80);
    expect(parseValor("1234.56")).toBe(1234.56);
  });
  it("número já numérico passa direto", () => {
    expect(parseValor(1234.56)).toBe(1234.56);
  });
  it("vazio / nulo / inválido → null", () => {
    expect(parseValor("")).toBeNull();
    expect(parseValor(null)).toBeNull();
    expect(parseValor(undefined)).toBeNull();
    expect(parseValor("abc")).toBeNull();
  });
});

describe("parseData", () => {
  it("dd/mm/aaaa → AAAA-MM-DD", () => {
    expect(parseData("01/07/2026")).toBe("2026-07-01");
  });
  it("ano de 2 dígitos vira 20xx", () => {
    expect(parseData("1/7/26")).toBe("2026-07-01");
  });
  it("já em ISO (com ou sem hora) preserva a data", () => {
    expect(parseData("2026-07-01")).toBe("2026-07-01");
    expect(parseData("2026-07-01T12:30:00")).toBe("2026-07-01");
  });
  it("objeto Date usa o fuso local", () => {
    expect(parseData(new Date(2026, 6, 1))).toBe("2026-07-01");
  });
  it("lixo → null", () => {
    expect(parseData("sem data")).toBeNull();
    expect(parseData("")).toBeNull();
  });
});

// OFX 1.x (SGML) mínimo e SEM dados reais — 2 transações + LEDGERBAL/AVAILBAL.
const OFX_FIXTURE = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
<OFX>
<SIGNONMSGSRSV1><SONRS>
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<DTSERVER>20260731120000
<LANGUAGE>POR
<FI><ORG>BANCO TESTE<FID>0001</FI>
</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM><BANKID>0077<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260701<DTEND>20260731
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260701120000<TRNAMT>1234.56<FITID>AAA111<NAME>PIX RECEBIDO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260702<TRNAMT>-80.00<FITID>BBB222<NAME>TARIFA<MEMO>PACOTE</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1154.56<DTASOF>20260731120000</LEDGERBAL>
<AVAILBAL><BALAMT>999.99<DTASOF>20260731120000</AVAILBAL>
</STMTRS>
</STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe("parseOfx", () => {
  const { rows, account, ledger } = parseOfx(OFX_FIXTURE);

  it("lê todas as transações", () => {
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ok)).toBe(true);
  });

  it("crédito → in, débito → out (valor sempre positivo)", () => {
    const [credito, debito] = rows;
    expect(credito).toMatchObject({ ok: true, tipo: "in", valor: 1234.56, fitid: "AAA111", data: "2026-07-01" });
    expect(debito).toMatchObject({ ok: true, tipo: "out", valor: 80, fitid: "BBB222", data: "2026-07-02" });
  });

  it("junta NAME + MEMO quando diferentes", () => {
    expect(rows[0]).toMatchObject({ descricao: "PIX RECEBIDO" });
    expect(rows[1]).toMatchObject({ descricao: "TARIFA — PACOTE" });
  });

  it("extrai a identidade da conta (fingerprint = bankId|acctId)", () => {
    expect(account).toMatchObject({
      bankId: "0077",
      acctId: "12345-6",
      acctType: "CHECKING",
      org: "BANCO TESTE",
      fingerprint: "0077|12345-6",
    });
  });

  it("lê o LEDGERBAL (e não o AVAILBAL) como saldo do banco", () => {
    expect(ledger).toEqual({ amount: 1154.56, asOfISO: "2026-07-31" });
  });
});

describe("marcarDuplicatas", () => {
  const linha = (data: string, descricao: string, valor: number, fitid: string | null = null): ParsedRow => ({
    linha: 1, ok: true, dataRaw: data, descRaw: descricao, valorRaw: String(valor),
    data, descricao, valor, tipo: "out", fitid, categoria: "",
  });
  const nada = { fitids: new Set<string>(), conteudos: new Set<string>() };

  it("o mesmo valor saindo duas vezes no dia: a 2ª é repetição do próprio arquivo", () => {
    const rows = marcarDuplicatas(
      [linha("2026-05-21", "Pix enviado para FACEBOOK", 150), linha("2026-05-21", "Pix enviado para FACEBOOK", 150)],
      nada,
      novoVistoNoLote()
    );
    expect(rows[0]).toMatchObject({ duplicate: false, dupContent: false, dupNoArquivo: false });
    expect(rows[1]).toMatchObject({ duplicate: true, dupContent: true, dupNoArquivo: true });
  });

  it("o que já está gravado na conta é duplicata — mas não 'do arquivo'", () => {
    const gravada = linha("2026-05-21", "Pix enviado para FACEBOOK", 150);
    const existentes = {
      fitids: new Set<string>(),
      conteudos: new Set([chaveConteudo({ dataISO: gravada.data!, valor: 150, tipo: "out", descricao: gravada.descricao! })]),
    };
    const rows = marcarDuplicatas([gravada], existentes, novoVistoNoLote());
    expect(rows[0]).toMatchObject({ duplicate: true, dupContent: true, dupNoArquivo: false });
  });

  it("mesmo FITID é duplicata forte (não vira 'possível duplicata')", () => {
    const existentes = { fitids: new Set(["AAA111"]), conteudos: new Set<string>() };
    const rows = marcarDuplicatas([linha("2026-05-21", "TARIFA", 80, "AAA111")], existentes, novoVistoNoLote());
    expect(rows[0]).toMatchObject({ duplicate: true, dupContent: false, dupNoArquivo: false });
  });

  it("valores ou dias diferentes não são duplicata", () => {
    const rows = marcarDuplicatas(
      [linha("2026-05-21", "Pix enviado para FACEBOOK", 150), linha("2026-05-21", "Pix enviado para FACEBOOK", 151), linha("2026-05-22", "Pix enviado para FACEBOOK", 150)],
      nada,
      novoVistoNoLote()
    );
    expect(rows.every((r) => !r.duplicate)).toBe(true);
  });

  it("o mesmo `visto` pega repetição entre dois arquivos do mesmo envio", () => {
    const visto = novoVistoNoLote();
    const arquivo1 = marcarDuplicatas([linha("2026-05-21", "ALUGUEL", 1000)], nada, visto);
    const arquivo2 = marcarDuplicatas([linha("2026-05-21", "ALUGUEL", 1000)], nada, visto);
    expect(arquivo1[0].duplicate).toBe(false);
    expect(arquivo2[0]).toMatchObject({ duplicate: true, dupNoArquivo: true });
  });
});

// ─── Fatura de cartão exportada em Excel ────────────────────
// Cabeçalhos da exportação do cartão: data de compra, nome e final do cartão,
// categoria do emissor, descrição, parcela, valor em dólar, cotação e valor em
// reais. Só data, descrição e valor em REAIS viram lançamento.
describe("planilha da fatura de cartão", () => {
  const linha = (extra: Record<string, unknown> = {}) => ({
    "Data de compra": "24/07/2026",
    "Nome no cartão": "ZAYTAN E T",
    "Final do Cartão": "9965",
    "Categoria": "Elétrico",
    "Descrição": "ANTHROPIC",
    "Parcela": "Única",
    "Valor (em US$)": "19,72",
    "Cotação (em R$)": "5,35",
    "Valor (em R$)": "105,44",
    ...extra,
  });

  it("lê data, descrição e o valor em reais — nunca o dólar nem a cotação", () => {
    const r = mapSheetRow(linha(), 2);
    expect(r.ok).toBe(true);
    expect(r.data).toBe("2026-07-24");
    expect(r.descricao).toBe("ANTHROPIC");
    expect(r.valor).toBe(105.44);
  });

  it("valor negativo é crédito (pagamento/estorno da fatura)", () => {
    const r = mapSheetRow(linha({ "Descrição": "Inclusao de Pagamento", "Valor (em R$)": "-109,13", "Valor (em US$)": "0", "Cotação (em R$)": "0" }), 4);
    expect(r.valor).toBe(109.13);
    expect(r.tipo).toBe("out"); // sinal negativo; a tela inverte quando o destino é cartão
  });

  it("a categoria do emissor entra como sugestão crua (a tela descarta o que não é do plano)", () => {
    expect(mapSheetRow(linha(), 2).categoria).toBe("Elétrico");
  });

  it("linha sem valor em reais não passa", () => {
    const r = mapSheetRow(linha({ "Valor (em R$)": "0" }), 3);
    expect(r.ok).toBe(false);
    expect(r.erro).toBe("Valor inválido");
  });

  it("fatura do C6: pula a linha de título e acha o cabeçalho na linha 2", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Razão Social: ZAYTAN ESTRATEGIA E TECNOLOGIA DIGITAL LTDA", "", "", "", "Cartão C6 Business"],
      ["Data de compra", "Nome no cartão", "Final do Cartão", "Categoria", "Descrição", "Parcela", "Valor (em US$)", "Cotação (em R$)", "Valor (em R$)"],
      ["01/07/2026", "ZAYTAN E E T D LTDA", "9965", "-", "Inclusao de Pagamento", "Única", "$ 0,00", "R$ 0,00", "R$ - 200,71"],
      ["01/07/2026", "ZAYTAN E E T D LTDA", "9965", "Elétrico", "SUPABASE", "Única", "$ 25,00", "R$ 5,45", "R$ 136,19"],
    ]);
    const [pagamento, compra] = parseSheet(sheet);
    expect(pagamento).toMatchObject({ ok: true, linha: 3, data: "2026-07-01", descricao: "Inclusao de Pagamento", valor: 200.71, tipo: "out" });
    expect(compra).toMatchObject({ ok: true, linha: 4, descricao: "SUPABASE", valor: 136.19, tipo: "in", categoria: "Elétrico" });
  });

  it("planilha com cabeçalho na linha 1 continua igual", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["data", "descricao", "valor"], ["01/08/2026", "PIX RECEBIDO", "1.500,00"]]);
    expect(parseSheet(sheet)).toMatchObject([{ ok: true, linha: 2, valor: 1500 }]);
  });

  it("planilha de banco comum continua lendo a coluna 'valor'", () => {
    const r = mapSheetRow({ data: "01/08/2026", descricao: "PIX RECEBIDO", valor: "1.500,00" }, 2);
    expect(r.valor).toBe(1500);
    expect(r.tipo).toBe("in");
  });
});
