import { describe, it, expect } from "vitest";
import { itensParaLinhas, parseExtratoPdf, type PdfItem } from "@/lib/pdf-extrato";

// Coordenadas reais do extrato C6 (colunas em x = 36 / 95 / 154 / 234 / ~530),
// com os itens de espaço que o PDF insere entre as colunas. Dados fictícios.
const item = (str: string, x: number, y: number, w: number): PdfItem => ({ str, x, y, w });

const PAGINA: PdfItem[] = [
  item("Agência: 1 • Conta: 423163442", 45, 770.1, 87.8),
  item("Saldo do dia • 20 de maio de 2026 •", 421.5, 725.9, 106.4),
  item("R$ 1.234,56", 529.5, 725.9, 36.8),
  item("No app do C6 Bank", 30, 715, 53.4),
  // Cabeçalho do mês (o "( 01/05... )" vem colado, e 0,7pt acima)
  item("Maio 2026", 36, 538.4, 49.2),
  item("( 01/05/2026 - 31/05/2026 )", 88.5, 539.1, 66.9),
  item("Entradas:", 439.5, 538.4, 26.8),
  item("R$ 2.000,00", 468, 538.4, 21.8),
  // Cabeçalho da tabela (deve ser ignorado)
  item("Data", 36, 514.4, 16.9),
  item("lançamento", 36, 509.1, 24.6),
  item("Tipo", 154, 510.6, 16),
  item("Descrição", 234.4, 510.6, 35.5),
  item("Valor", 540.7, 510.6, 19.8),
  // Entrada — descrição partida no acento, como o pdfjs às vezes devolve
  item("04/05", 36, 494.1, 17.3),
  item(" ", 53.3, 494.1, 56.1),
  item("04/05", 95.4, 494.1, 17.3),
  item(" ", 112.6, 494.1, 55.6),
  item("Entrada PIX", 154.3, 494.1, 32.9),
  item(" ", 187.2, 494.1, 63.4),
  item("Pix recebido de Vin", 234.8, 494.1, 50),
  item("í", 284.8, 494.1, 2),
  item("cius Vieira", 286.8, 494.1, 30),
  item(" ", 370.1, 494.1, 225.5),
  item("R$ 2.000,00", 526.5, 494.1, 33.8),
  // Fecha o dia (não é lançamento; é o saldo do banco)
  item("Saldo do dia 04/05/26", 36, 475.4, 64.5),
  item("R$ 2.000,00", 539.2, 475.4, 20.9),
  // Saída com valor negativo
  item("06/05", 36, 405.6, 17.3),
  item("06/05", 95.4, 405.6, 17.3),
  item("Saída PIX", 154.3, 405.6, 26.2),
  item("Pix enviado para NORDESTE DIGITAL", 234.8, 405.6, 104.5),
  item("-R$ 174,00", 530.2, 405.6, 30),
  item("Saldo do dia 06/05/26", 36, 386.9, 64.5),
  item("R$ 1.826,00", 539.2, 386.9, 20.9),
  // Sem coluna de descrição: a descrição vira o próprio tipo
  item("18/05", 36, 368.1, 17.3),
  item("18/05", 95.4, 368.1, 17.3),
  item("Outros gastos", 154.3, 368.1, 35),
  item("-R$ 20,00", 532, 368.1, 28),
];

describe("itensParaLinhas", () => {
  const linhas = itensParaLinhas(PAGINA);

  it("agrupa por altura e separa as colunas", () => {
    expect(linhas).toContainEqual(["04/05", "04/05", "Entrada PIX", "Pix recebido de Vinícius Vieira", "R$ 2.000,00"]);
  });

  it("junta itens colados (acento partido) sem inventar espaço", () => {
    const l = linhas.find((x) => x[0] === "04/05")!;
    expect(l[3]).toBe("Pix recebido de Vinícius Vieira");
  });

  it("mantém na mesma linha o que está a menos de 2pt de diferença em y", () => {
    expect(linhas.some((l) => l[0] === "Maio 2026 ( 01/05/2026 - 31/05/2026 )")).toBe(true);
  });
});

describe("parseExtratoPdf", () => {
  const { rows, account, ledger } = parseExtratoPdf(itensParaLinhas(PAGINA));

  it("lê só os lançamentos (ignora cabeçalho e 'Saldo do dia')", () => {
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.ok)).toBe(true);
  });

  it("usa a data de lançamento com o ano do cabeçalho do mês", () => {
    expect(rows.map((r) => r.data)).toEqual(["2026-05-04", "2026-05-06", "2026-05-18"]);
  });

  it("valor negativo → saída; positivo → entrada (valor sempre positivo)", () => {
    expect(rows[0]).toMatchObject({ tipo: "in", valor: 2000, descricao: "Pix recebido de Vinícius Vieira" });
    expect(rows[1]).toMatchObject({ tipo: "out", valor: 174, descricao: "Pix enviado para NORDESTE DIGITAL" });
  });

  it("sem coluna de descrição, usa o tipo do lançamento", () => {
    expect(rows[2]).toMatchObject({ tipo: "out", valor: 20, descricao: "Outros gastos" });
  });

  it("PDF não traz FITID — dedup fica por conteúdo", () => {
    expect(rows.every((r) => r.fitid === null)).toBe(true);
  });

  it("identifica a conta (C6 = banco 336) e o saldo do último dia", () => {
    expect(account).toMatchObject({ bankId: "336", acctId: "423163442", org: "C6 Bank", fingerprint: "336|423163442" });
    expect(ledger).toEqual({ amount: 1826, asOfISO: "2026-05-06" });
  });

  it("mês com acento no cabeçalho (Março) também fixa o ano", () => {
    const { rows } = parseExtratoPdf([
      ["Março 2026 ( 01/03/2026 - 31/03/2026 )"],
      ["10/03", "10/03", "Pagamento", "CLARO SA", "-R$ 99,90"],
    ]);
    expect(rows[0]).toMatchObject({ data: "2026-03-10", tipo: "out", valor: 99.9 });
  });

  it("dia impossível não vira data inventada", () => {
    const { rows } = parseExtratoPdf([
      ["Maio 2026 ( 01/05/2026 - 31/05/2026 )"],
      ["45/13", "45/13", "Pagamento", "LIXO", "-R$ 10,00"],
    ]);
    expect(rows[0]).toMatchObject({ ok: false, erro: "Data inválida" });
  });

  it("PDF que não é extrato → erro claro", () => {
    expect(() => parseExtratoPdf([["Contrato de prestação de serviços"], ["Cláusula 1ª"]])).toThrow();
  });
});
