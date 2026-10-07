import { describe, it, expect } from "vitest";
import { paginarTudo } from "@/lib/paginacao";

// Simula a API: uma tabela com N linhas que NUNCA devolve mais de 1000 por
// requisição — mesmo que você peça mais. É esse silêncio que quebrou o saldo.
const apiFake = (total: number) => {
  const chamadas: [number, number][] = [];
  const linhas = Array.from({ length: total }, (_, i) => ({ id: i }));
  const pagina = (de: number, ate: number) => {
    chamadas.push([de, ate]);
    const fim = Math.min(ate + 1, de + 1000);
    return Promise.resolve({ data: linhas.slice(de, fim), error: null });
  };
  return { pagina, chamadas };
};

describe("paginarTudo", () => {
  it("traz a tabela inteira quando ela passa do teto", async () => {
    // O caso real: 1.056 lançamentos, dos quais o app via só 1.000.
    const { pagina, chamadas } = apiFake(1056);
    const linhas = await paginarTudo(pagina);
    expect(linhas).toHaveLength(1056);
    expect(linhas[1055].id).toBe(1055); // a última existe mesmo
    expect(chamadas).toEqual([[0, 999], [1000, 1999]]);
  });

  it("uma requisição só quando cabe embaixo do teto", async () => {
    const { pagina, chamadas } = apiFake(42);
    expect(await paginarTudo(pagina)).toHaveLength(42);
    expect(chamadas).toHaveLength(1);
  });

  it("tabela vazia não vira requisição extra", async () => {
    const { pagina, chamadas } = apiFake(0);
    expect(await paginarTudo(pagina)).toEqual([]);
    expect(chamadas).toHaveLength(1);
  });

  it("total múltiplo exato do teto: paga uma requisição a mais e para", async () => {
    // Com 2000 linhas a 2ª página vem cheia — não dá para saber que acabou
    // sem perguntar de novo. O que não pode é parar cedo e perder linha.
    const { pagina, chamadas } = apiFake(2000);
    const linhas = await paginarTudo(pagina);
    expect(linhas).toHaveLength(2000);
    expect(chamadas).toHaveLength(3);
  });

  it("erro em qualquer página estoura em vez de devolver lista parcial", async () => {
    // Devolver o que já veio seria pior que falhar: um saldo incompleto
    // não se distingue de um saldo certo na tela.
    let n = 0;
    const pagina = () => {
      n += 1;
      return Promise.resolve(
        n === 2
          ? { data: null, error: { message: "timeout" } }
          : { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
      );
    };
    await expect(paginarTudo(pagina)).rejects.toEqual({ message: "timeout" });
  });
});
