import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { brl, fmtK } from "@/lib/format";
import { useChartColors } from "@/lib/theme";
import type { PontoFluxo } from "@/lib/lancamentos";
import type { SaldoPoint } from "@/lib/saldo";

// Os dois gráficos do caixa, lado a lado: **Saldo acumulado** e
// **Entradas vs Saídas**. Mora aqui porque o Dashboard da Gestão e o Caixa ›
// Fluxo realizado mostram exatamente a mesma coisa — e precisam mostrar os
// MESMOS números. Quem chama passa a série já calculada (serieFluxo /
// saldoFromContas), então não existe uma segunda conta escondida numa tela.
// O desenho é o de sempre: área para o saldo, linhas para entradas e saídas.

export const COR_IN = "#1F7A3A";
export const COR_OUT = "#D63B0F";
const COR_SALDO = "#FF4D1C";

const yDomainComZero: [(min: number) => number, (max: number) => number] = [
  (min) => Math.min(0, min),
  (max) => Math.max(0, max),
];

export function GraficosFluxo({
  saldoPorDia, fluxo, contaLabel, rotulo, fechado = false, carregando = false, altura = 280,
}: {
  saldoPorDia: SaldoPoint[];
  fluxo: PontoFluxo[];
  contaLabel: string;
  rotulo: string;
  fechado?: boolean;
  carregando?: boolean;
  altura?: number;
}) {
  const ct = useChartColors();
  const tick = { fill: ct.label, fontSize: 12.5, fontWeight: 500 };
  const tooltipStyle = { ...ct.tooltip, borderRadius: 12, fontSize: 12 };

  return (
    <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="card-elevated border-border/70 p-6">
        <div className="mb-4">
          <h3 className="font-display text-lg font-semibold">Saldo acumulado</h3>
          <p className="text-sm text-muted-foreground">{rotulo} · {contaLabel} · só o que já passou pelo extrato</p>
        </div>
        <div style={{ height: altura }}>
          {carregando ? (
            <Skeleton className="h-full w-full rounded-xl" />
          ) : saldoPorDia.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Sem movimentação no período.
            </div>
          ) : (
            <ResponsiveContainer>
              <AreaChart data={saldoPorDia} margin={{ left: -10, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gradSaldoDia" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COR_SALDO} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={COR_SALDO} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={ct.grid} vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tick={tick} minTickGap={22} />
                <YAxis tickLine={false} axisLine={false} tick={tick} domain={yDomainComZero} tickFormatter={(v) => fmtK(v)} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [brl(v), "Saldo"]} />
                <ReferenceLine y={0} stroke={ct.axis} strokeOpacity={0.5} />
                <Area type="monotone" dataKey="saldo" stroke={COR_SALDO} strokeWidth={2} fill="url(#gradSaldoDia)" baseValue={0} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card className="card-elevated border-border/70 p-6">
        <div className="mb-4">
          <h3 className="font-display text-lg font-semibold">Entradas vs Saídas</h3>
          <p className="text-sm text-muted-foreground">
            {rotulo}{fechado ? " · período fechado" : " · a linha tracejada é o previsto"}
          </p>
        </div>
        <div style={{ height: altura }}>
          {carregando ? (
            <Skeleton className="h-full w-full rounded-xl" />
          ) : fluxo.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Sem movimentação nem compromisso no período.
            </div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={fluxo} margin={{ left: -10, right: 8, top: 8 }}>
                <CartesianGrid stroke={ct.grid} vertical={false} />
                <XAxis dataKey="rotulo" tickLine={false} axisLine={false} tick={tick} minTickGap={18} />
                <YAxis tickLine={false} axisLine={false} tick={tick} tickFormatter={(v) => fmtK(v)} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n) => [brl(v), n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="entradas" stroke={COR_IN} strokeWidth={2} dot={false} name="Entradas" />
                <Line type="monotone" dataKey="saidas" stroke={COR_OUT} strokeWidth={2} dot={false} name="Saídas" />
                {/* Período fechado não projeta: as séries de previsto somem do
                    gráfico e da legenda, em vez de aparecerem zeradas. */}
                {!fechado && (
                  <Line type="monotone" dataKey="entradasPrevistas" stroke={COR_IN} strokeWidth={2} strokeDasharray="4 4" dot={false} name="Entradas previstas" />
                )}
                {!fechado && (
                  <Line type="monotone" dataKey="saidasPrevistas" stroke={COR_OUT} strokeWidth={2} strokeDasharray="4 4" dot={false} name="Saídas previstas" />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}
