import { describe, it, expect } from "vitest";
import { chaveConteudo, conferirExtrato, type Lancamento } from "@/lib/conciliacao";

// Helper enxuto para montar lançamentos de teste.
function lanc(p: Partial<Lancamento> & Pick<Lancamento, "dataISO" | "valor" | "tipo">): Lancamento {
  return {
    id: p.id,
    dataISO: p.dataISO,
    valor: p.valor,
    tipo: p.tipo,
    descricao: p.descricao ?? "",
    fitid: p.fitid ?? null,
  };
}

describe("chaveConteudo", () => {
  it("mesmo dia+valor+tipo+nome → mesma chave (ignora acento/caixa/espaço)", () => {
    const a = chaveConteudo({ dataISO: "2026-07-01", valor: 100, tipo: "in", descricao: "  João  DA  Silva " });
    const b = chaveConteudo({ dataISO: "2026-07-01", valor: 100, tipo: "in", descricao: "joao da silva" });
    expect(a).toBe(b);
  });

  it("normaliza o valor para 2 casas (100 == 100.00)", () => {
    const a = chaveConteudo({ dataISO: "2026-07-01", valor: 100, tipo: "in", descricao: "x" });
    const b = chaveConteudo({ dataISO: "2026-07-01", valor: 100.004, tipo: "in", descricao: "x" });
    expect(a).toBe(b);
  });

  it("valor ou tipo diferente → chave diferente", () => {
    const base = { dataISO: "2026-07-01", valor: 100, tipo: "in" as const, descricao: "x" };
    expect(chaveConteudo(base)).not.toBe(chaveConteudo({ ...base, valor: 101 }));
    expect(chaveConteudo(base)).not.toBe(chaveConteudo({ ...base, tipo: "out" }));
  });
});

describe("conferirExtrato", () => {
  it("casa por FITID e por conteúdo; reporta faltam e sobram", () => {
    const ofx = [
      lanc({ dataISO: "2026-07-01", valor: 100, tipo: "in", descricao: "PIX A", fitid: "F1" }),
      lanc({ dataISO: "2026-07-02", valor: 50, tipo: "out", descricao: "BOLETO B", fitid: "F2" }),
      lanc({ dataISO: "2026-07-03", valor: 200, tipo: "in", descricao: "TED C", fitid: "F3" }),
    ];
    const app = [
      // casa por fitid
      lanc({ id: "a1", dataISO: "2026-07-01", valor: 100, tipo: "in", descricao: "PIX A", fitid: "F1" }),
      // casa por conteúdo (sem fitid gravado)
      lanc({ id: "a2", dataISO: "2026-07-02", valor: 50, tipo: "out", descricao: "boleto b", fitid: null }),
      // sobra: dentro do período do extrato, sem par no OFX
      lanc({ id: "a3", dataISO: "2026-07-02", valor: 999, tipo: "out", descricao: "MANUAL EXTRA", fitid: null }),
    ];

    const r = conferirExtrato(ofx, app);
    expect(r.batem).toBe(2);
    expect(r.faltam.map((f) => f.descricao)).toEqual(["TED C"]); // F3 não existe no app
    expect(r.sobram.map((f) => f.id)).toEqual(["a3"]);
    expect(r.divergentes).toHaveLength(0);
  });

  it("mesmo FITID com valor diferente → divergente (não conta como bate)", () => {
    const ofx = [lanc({ dataISO: "2026-07-01", valor: 100, tipo: "in", descricao: "X", fitid: "F1" })];
    const app = [lanc({ id: "a1", dataISO: "2026-07-01", valor: 130, tipo: "in", descricao: "X", fitid: "F1" })];

    const r = conferirExtrato(ofx, app);
    expect(r.batem).toBe(0);
    expect(r.divergentes).toHaveLength(1);
    expect(r.divergentes[0].ofx.valor).toBe(100);
    expect(r.divergentes[0].app.valor).toBe(130);
    expect(r.faltam).toHaveLength(0); // consumido pelo match de fitid
  });

  it("sobra ignora movimentações fora do intervalo de datas do extrato", () => {
    const ofx = [lanc({ dataISO: "2026-07-10", valor: 100, tipo: "in", descricao: "X", fitid: "F1" })];
    const app = [
      lanc({ id: "a1", dataISO: "2026-07-10", valor: 100, tipo: "in", descricao: "X", fitid: "F1" }),
      lanc({ id: "fora", dataISO: "2026-06-01", valor: 5, tipo: "out", descricao: "ANTES", fitid: null }),
    ];
    const r = conferirExtrato(ofx, app);
    expect(r.batem).toBe(1);
    expect(r.sobram).toHaveLength(0); // "fora" está fora do período [10/07, 10/07]
  });

  it("banco que renumera o FITID no dia: casa por conteúdo, não acusa divergência", () => {
    // Bancos que montam o FITID como data+posição (20260825001, ...002) o
    // renumeram quando um lançamento entra ou sai daquele dia. Ao reconferir,
    // o FITID de cada linha passa a apontar para o vizinho — e a coluna "no
    // app" da tela aparecia inteira deslocada em uma posição.
    const ofx = [
      lanc({ dataISO: "2026-08-25", valor: 1500, tipo: "out", descricao: "PIX JAQUELINE", fitid: "20260825001" }),
      lanc({ dataISO: "2026-08-25", valor: 518, tipo: "out", descricao: "PAG IKATEC", fitid: "20260825002" }),
      lanc({ dataISO: "2026-08-25", valor: 8275.1, tipo: "out", descricao: "BOLETO MARIA IGNEZ", fitid: "20260825003" }),
    ];
    // Mesmas três transações no app, mas com os fitids andados uma casa.
    const app = [
      lanc({ id: "a1", dataISO: "2026-08-25", valor: 1500, tipo: "out", descricao: "PIX JAQUELINE", fitid: "20260825002" }),
      lanc({ id: "a2", dataISO: "2026-08-25", valor: 518, tipo: "out", descricao: "PAG IKATEC", fitid: "20260825003" }),
      lanc({ id: "a3", dataISO: "2026-08-25", valor: 8275.1, tipo: "out", descricao: "BOLETO MARIA IGNEZ", fitid: "20260825004" }),
    ];

    const r = conferirExtrato(ofx, app);
    expect(r.batem).toBe(3);
    expect(r.divergentes).toHaveLength(0); // nada aqui é edição à mão
    expect(r.faltam).toHaveLength(0);
    expect(r.sobram).toHaveLength(0);
  });

  it("o par forte (fitid + valor) é resolvido antes do conteúdo", () => {
    // Duas linhas iguais em tudo menos no fitid. Se o passo do conteúdo
    // rodasse primeiro, ele poderia consumir a movimentação que pertence à
    // outra linha e sobrar uma falsa divergência.
    const ofx = [
      lanc({ dataISO: "2026-08-25", valor: 100, tipo: "out", descricao: "MESMO", fitid: "F2" }),
      lanc({ dataISO: "2026-08-25", valor: 100, tipo: "out", descricao: "MESMO", fitid: "F1" }),
    ];
    const app = [
      lanc({ id: "a1", dataISO: "2026-08-25", valor: 100, tipo: "out", descricao: "MESMO", fitid: "F1" }),
      lanc({ id: "a2", dataISO: "2026-08-25", valor: 100, tipo: "out", descricao: "MESMO", fitid: "F2" }),
    ];
    const r = conferirExtrato(ofx, app);
    expect(r.batem).toBe(2);
    expect(r.divergentes).toHaveLength(0);
    expect(r.sobram).toHaveLength(0);
  });

  it("caso LAPORTEC: FITIDs embaralhados no reimport viram divergentes", () => {
    // O extrato traz MARCOS (450) e FLAVIO (172,80) com seus fitids reais.
    const ofx = [
      lanc({ dataISO: "2026-07-15", valor: 450, tipo: "in", descricao: "MARCOS", fitid: "FIT_MARCOS" }),
      lanc({ dataISO: "2026-07-15", valor: 172.8, tipo: "in", descricao: "FLAVIO", fitid: "FIT_FLAVIO" }),
    ];
    // No app, a reimportação gravou BARTE/CYNTIA carregando os fitids de MARCOS/FLAVIO.
    const app = [
      lanc({ id: "barte", dataISO: "2026-07-15", valor: 5025.09, tipo: "in", descricao: "BARTE", fitid: "FIT_MARCOS" }),
      lanc({ id: "cyntia", dataISO: "2026-07-15", valor: 1500, tipo: "in", descricao: "CYNTIA", fitid: "FIT_FLAVIO" }),
    ];

    const r = conferirExtrato(ofx, app);
    // Ambos casam por fitid mas o valor não bate → sinalizados para auditoria.
    expect(r.batem).toBe(0);
    expect(r.divergentes).toHaveLength(2);
    const appVals = r.divergentes.map((d) => d.app.valor).sort((a, b) => a - b);
    expect(appVals).toEqual([1500, 5025.09]);
    expect(r.faltam).toHaveLength(0);
    expect(r.sobram).toHaveLength(0);
  });
});
