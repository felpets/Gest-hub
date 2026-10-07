// ─── Conferir o extrato do banco com o que o app tem ────────────────────────
// Ler o arquivo, casar os lançamentos e comparar os saldos é UMA regra, usada
// pela tela de computador (telas/conferir-extrato) e pela de celular
// (telas/extratos-celular). O casamento em si é puro e já tem teste
// (lib/conciliacao); o que mora aqui é o caminho: arquivo → lançamentos do
// banco → lançamentos do app no mesmo período → resultado + saldos.
//
// Não escreve nada: conferir é só olhar.
import { useRef, useState } from "react";
import { fetchMovimentacoesConta, type ContaBancaria } from "@/lib/queries";
import { parseFile } from "@/lib/import-parsers";
import { conferirExtrato, type Lancamento, type ConfResultado } from "@/lib/conciliacao";

export type Analise = {
  fileName: string;
  contaNome: string;
  resultado: ConfResultado;
  // Saldo que o próprio extrato informa, quando o formato traz (OFX/PDF).
  banco: { saldo: number; data: string } | null;
  // Saldo do app na MESMA data, para a comparação valer.
  appSaldo: number | null;
};

export const ACEITA_EXTRATO =
  ".ofx,.pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Os saldos divergem quando a diferença passa de um centavo — abaixo disso é
// arredondamento, não erro.
export function saldosDivergem(a: Analise | null): boolean {
  return !!a?.banco && a.appSaldo != null && Math.abs(a.banco.saldo - a.appSaldo) > 0.01;
}

export function useAnaliseExtrato() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [analise, setAnalise] = useState<Analise | null>(null);

  const analisar = async (files: FileList | null | undefined, conta: ContaBancaria | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!conta) {
      setErro("Cadastre ou selecione uma conta bancária antes de conferir.");
      return;
    }
    setErro(null);
    setCarregando(true);
    setAnalise(null);
    try {
      const fp = await parseFile(file);
      const ofx: Lancamento[] = fp.rows
        .filter((r) => r.ok && r.data && r.valor != null && r.tipo)
        .map((r) => ({
          dataISO: r.data!,
          valor: r.valor!,
          tipo: r.tipo!,
          descricao: r.descricao ?? "",
          fitid: r.fitid ?? null,
        }));
      if (ofx.length === 0) {
        setErro("Nenhuma transação encontrada no arquivo.");
        return;
      }

      // Só o período do arquivo: comparar o extrato de setembro com o ano
      // inteiro acusaria "sobra" em tudo o que está fora dele.
      const datas = ofx.map((o) => o.dataISO).sort();
      const movs = await fetchMovimentacoesConta(conta.id, datas[0], datas[datas.length - 1]);
      const app: Lancamento[] = movs.map((m) => ({
        id: m.id,
        dataISO: m.dataISO,
        valor: m.valor,
        tipo: m.tipo,
        descricao: m.descricao,
        fitid: m.fitid,
      }));
      const resultado = conferirExtrato(ofx, app);

      // Saldo: só quando o arquivo informa o do banco. O do app é somado desde
      // o saldo inicial da conta até a mesma data — senão a comparação é entre
      // dois recortes diferentes.
      let banco: Analise["banco"] = null;
      let appSaldo: number | null = null;
      if (fp.ledger) {
        banco = { saldo: fp.ledger.amount, data: fp.ledger.asOfISO };
        const ate = await fetchMovimentacoesConta(
          conta.id,
          conta.saldoInicialData,
          fp.ledger.asOfISO,
        );
        const soma = ate.reduce((s, m) => s + (m.tipo === "in" ? m.valor : -m.valor), 0);
        appSaldo = Math.round((conta.saldoInicial + soma) * 100) / 100;
      }

      setAnalise({ fileName: fp.fileName, contaNome: conta.nome, resultado, banco, appSaldo });
    } catch {
      setErro("Não consegui ler o arquivo. Use um OFX, PDF do extrato do C6, CSV ou Excel válido.");
    } finally {
      setCarregando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return { inputRef, analise, carregando, erro, analisar, diverge: saldosDivergem(analise) };
}
