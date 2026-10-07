import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Loader2, X } from "lucide-react";
import { brl } from "@/lib/format";
import { fmtBR } from "@/lib/datas";
import { cn } from "@/lib/utils";
import type { Movimentacao } from "@/lib/queries";

// Histórico do período: as movimentações que JÁ passaram pelo extrato, na data
// real em que o dinheiro andou. É a mesma lista que soma no cartão do topo e
// nos gráficos por categoria — por isso os três números sempre batem.
//
// Nada de previsto aqui: conta a pagar, Pix do dia e recorrência só aparecem
// quando entram no extrato (e são a projeção do Caixa até lá).
export function ListaExtrato({
  tipo, movimentos, rotulo, carregando, nomeConta, filtro, onLimparFiltro, rolagem = 340,
}: {
  tipo: "in" | "out";
  movimentos: Movimentacao[];
  rotulo: string;
  carregando?: boolean;
  nomeConta?: (id: string | null) => string;
  // Categoria escolhida no gráfico de cima (a lista já vem filtrada).
  filtro?: string | null;
  onLimparFiltro?: () => void;
  rolagem?: number;
}) {
  const entrada = tipo === "in";
  const linhas = movimentos
    .filter((m) => m.tipo === tipo)
    .sort((a, b) => b.dataISO.localeCompare(a.dataISO) || a.ia.localeCompare(b.ia, "pt-BR"));
  const total = Math.round(linhas.reduce((s, m) => s + m.valor, 0) * 100) / 100;

  return (
    <Card className="card-elevated border-border/70 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", entrada ? "bg-success/10 text-success" : "bg-secondary text-foreground")}>
            {entrada ? <ArrowDownLeft className="h-[18px] w-[18px]" /> : <ArrowUpRight className="h-[18px] w-[18px]" />}
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold">{entrada ? "Entradas do extrato" : "Saídas do extrato"}</h3>
            <p className="text-xs text-muted-foreground">
              {rotulo} · {brl(total)} em {linhas.length} {linhas.length === 1 ? "lançamento" : "lançamentos"}
            </p>
            {filtro && (
              <button onClick={onLimparFiltro}
                className="mt-1 inline-flex max-w-full items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium hover:bg-secondary/70"
                title="Mostrar tudo de novo">
                <span className="truncate">{filtro}</span>
                <X className="h-3 w-3 shrink-0" />
              </button>
            )}
          </div>
        </div>
        <Link to="/financeiro/caixa" search={{ aba: "movimentacoes" }}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Ver no Caixa <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {carregando ? (
        <div className="flex items-center justify-center py-14 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : linhas.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {filtro
            ? `Nenhum lançamento de ${filtro} neste período.`
            : `Nenhuma ${entrada ? "entrada" : "saída"} no extrato neste período.`}
        </p>
      ) : (
        <div className="overflow-x-auto" style={{ maxHeight: rolagem, overflowY: "auto" }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-secondary text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Data</th>
                <th className="px-5 py-3 text-left font-medium">Descrição</th>
                <th className="px-5 py-3 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {linhas.map((m) => (
                <tr key={m.id} className="hover:bg-secondary/30">
                  <td className="whitespace-nowrap px-5 py-3 font-medium">{fmtBR(m.dataISO)}</td>
                  <td className="px-5 py-3">
                    <div className="font-medium">{m.ia || m.desc}</div>
                    <div className="text-xs text-muted-foreground">
                      {[m.cat || "sem categoria", nomeConta?.(m.contaId)].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className={cn("whitespace-nowrap px-5 py-3 text-right font-numeric font-semibold tabular-nums", entrada && "text-success")}>
                    {brl(m.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-secondary/30 text-sm font-semibold">
              <tr>
                <td className="px-5 py-3" colSpan={2}>
                  {linhas.length} {linhas.length === 1 ? "lançamento" : "lançamentos"}
                </td>
                <td className="px-5 py-3 text-right font-numeric tabular-nums">{brl(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
