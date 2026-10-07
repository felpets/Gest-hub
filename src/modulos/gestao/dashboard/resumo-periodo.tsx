import { ArrowDownLeft, ArrowUpRight, Scale, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { brl } from "@/lib/format";
import { Parcela, Sinal } from "@/modulos/financeiro/telas/projecao-caixa";

// O período em uma linha, só com o que JÁ ACONTECEU: quanto tem no banco hoje,
// quanto de receita entrou, quanto saiu e a diferença entre os dois.
//
// O saldo fica separado de propósito (a barrinha, não um "+"): ele é o dinheiro
// de hoje, resultado de toda a história da conta; recebido e saiu são só deste
// período. Somar os três daria um número que não existe.
export function ResumoPeriodo({
  saldo, saldoRotulo, saldoDetalhe, recebido, qtdRecebido, saiu, qtdSaiu, className = "",
}: {
  saldo: number;
  saldoRotulo: string;
  saldoDetalhe: string;
  recebido: number;
  qtdRecebido: number;
  saiu: number;
  qtdSaiu: number;
  className?: string;
}) {
  const diferenca = Math.round((recebido - saiu) * 100) / 100;
  const sobrou = diferenca >= 0;
  return (
    <Card className={`card-elevated border-border/70 p-5 sm:p-6 ${className}`}>
      <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1.15fr]">
        <Parcela icone={Wallet} rotulo={saldoRotulo} valor={saldo} detalhe={saldoDetalhe} />
        <Sinal>│</Sinal>
        <Parcela icone={ArrowDownLeft} rotulo="Receita recebida" valor={recebido} cor="text-success"
          detalhe={`${qtdRecebido} ${qtdRecebido === 1 ? "entrada" : "entradas"} no período`} />
        <Sinal>−</Sinal>
        <Parcela icone={ArrowUpRight} rotulo="Já saiu" valor={saiu} cor="text-destructive"
          detalhe={`${qtdSaiu} ${qtdSaiu === 1 ? "saída" : "saídas"} no período`} />
        <Sinal>=</Sinal>
        <div className={`rounded-xl px-4 py-3 ${sobrou ? "bg-success/10" : "bg-destructive/10"}`}>
          <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <Scale className="h-4 w-4" /> Diferença
          </div>
          <div className={`mt-1 whitespace-nowrap font-numeric text-[26px] font-semibold tabular-nums ${sobrou ? "text-success" : "text-destructive"}`}>
            {brl(diferenca)}
          </div>
          <div className="text-[12px] text-muted-foreground">{sobrou ? "entrou mais do que saiu" : "saiu mais do que entrou"}</div>
        </div>
      </div>
    </Card>
  );
}
