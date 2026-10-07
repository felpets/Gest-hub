import { useMemo, useState } from "react";
import {
  HORIZONTES, HORIZONTE_PADRAO, fimHorizonte, useProjecaoCaixa, type HorizonteId, type PrevisaoCaixa,
} from "@/modulos/financeiro/previsao-caixa";
import { Link } from "@tanstack/react-router";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot,
} from "recharts";
import { AlertTriangle, CheckCircle2, ArrowDownLeft, ArrowUpRight, Wallet, Flag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { brl, fmtK } from "@/lib/format";
import { ddMM, fmtBR, hojeISO } from "@/lib/datas";
import { useChartColors } from "@/lib/theme";
import { useClientes } from "@/lib/queries";
import type { ItemProjecao } from "@/lib/projecao";
import { COR_IN, COR_OUT } from "@/modulos/financeiro/graficos-fluxo";

// Financeiro › Caixa › Projeção. A tela responde, de cima para baixo, a quatro
// perguntas: quanto tenho hoje, quanto vai entrar, quanto vai sair e com
// quanto termino — e depois mostra o porquê (mês a mês e conta a conta).
// Os números vêm de lib/projecao: só contas e cobranças EM ABERTO, nada que
// já tenha passado pelo extrato.

export function SeletorHorizonte({ valor, onChange }: { valor: HorizonteId; onChange: (h: HorizonteId) => void }) {
  return (
    <div role="tablist" aria-label="Horizonte da projeção" className="flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-card p-1 text-[13px]">
      {HORIZONTES.map((h) => (
        <button key={h.id} role="tab" aria-selected={h.id === valor} onClick={() => onChange(h.id)}
          className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
            h.id === valor ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary/60"
          }`}>
          {h.dias ? `Próximos ${h.titulo}` : h.titulo}
        </button>
      ))}
    </div>
  );
}

// A conta, em uma linha: hoje + entra − sai = termina.
export function ResumoProjecao({ saldoAtual, contaLabel, dados, className = "mb-5" }: {
  saldoAtual: number;
  contaLabel: string;
  dados: PrevisaoCaixa;
  className?: string;
}) {
  const { projecao, entra, sai, qtdEntra, qtdSai, fim } = dados;
  return (
    <Card className={`card-elevated border-border/70 p-5 sm:p-6 ${className}`}>
      <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1.15fr]">
        <Parcela icone={Wallet} rotulo="Tenho hoje" valor={saldoAtual} detalhe={contaLabel} />
        <Sinal>+</Sinal>
        <Parcela icone={ArrowDownLeft} rotulo="Vai entrar" valor={entra} cor="text-success" detalhe={`${qtdEntra} recebimentos`} />
        <Sinal>−</Sinal>
        <Parcela icone={ArrowUpRight} rotulo="Vai sair" valor={sai} cor="text-destructive" detalhe={`${qtdSai} contas a pagar`} />
        <Sinal>=</Sinal>
        <div className={`rounded-xl px-4 py-3 ${projecao.saldoFinal < 0 ? "bg-destructive/10" : "bg-success/10"}`}>
          <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <Flag className="h-4 w-4" /> Termino com
          </div>
          <div className={`mt-1 whitespace-nowrap font-numeric text-[26px] font-semibold tabular-nums ${projecao.saldoFinal < 0 ? "text-destructive" : "text-success"}`}>
            {brl(projecao.saldoFinal)}
          </div>
          <div className="text-[12px] text-muted-foreground">em {fmtBR(fim)}</div>
        </div>
      </div>
    </Card>
  );
}

// A mesma conta em uma linha, para um período que JÁ PASSOU: com quanto
// começou + o que entrou − o que saiu = com quanto terminou (tudo do extrato).
export function ResumoRealizado({ inicio, entrou, saiu, fim, deISO, ateISO, contaLabel, qtdEntrou, qtdSaiu, className = "" }: {
  inicio: number;
  entrou: number;
  saiu: number;
  fim: number;
  deISO: string;
  ateISO: string;
  contaLabel: string;
  qtdEntrou: number;
  qtdSaiu: number;
  className?: string;
}) {
  return (
    <Card className={`card-elevated border-border/70 p-5 sm:p-6 ${className}`}>
      <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1.15fr]">
        <Parcela icone={Wallet} rotulo="Comecei com" valor={inicio} detalhe={`${contaLabel} · em ${fmtBR(deISO)}`} />
        <Sinal>+</Sinal>
        <Parcela icone={ArrowDownLeft} rotulo="Entrou" valor={entrou} cor="text-success" detalhe={`${qtdEntrou} lançamentos`} />
        <Sinal>−</Sinal>
        <Parcela icone={ArrowUpRight} rotulo="Saiu" valor={saiu} cor="text-destructive" detalhe={`${qtdSaiu} lançamentos`} />
        <Sinal>=</Sinal>
        <div className={`rounded-xl px-4 py-3 ${fim < 0 ? "bg-destructive/10" : "bg-secondary/60"}`}>
          <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <Flag className="h-4 w-4" /> Terminei com
          </div>
          <div className={`mt-1 whitespace-nowrap font-numeric text-[26px] font-semibold tabular-nums ${fim < 0 ? "text-destructive" : ""}`}>
            {brl(fim)}
          </div>
          <div className="text-[12px] text-muted-foreground">em {fmtBR(ateISO)}</div>
        </div>
      </div>
    </Card>
  );
}

// O veredito, em português.
// `noPeriodo` completa a frase "O dinheiro dá para tudo …" (ex.: "nos próximos 90 dias").
export function VereditoProjecao({ dados, noPeriodo, className = "mb-5", dica = "Veja abaixo quais contas levam o saldo ao vermelho." }: {
  dados: PrevisaoCaixa;
  noPeriodo: string;
  className?: string;
  dica?: string;
}) {
  const { projecao } = dados;
  const minimo = projecao.saldoMinimo;
  const falta = projecao.ficaNegativo;
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 text-[14px] ${
      falta ? "border-destructive/40 bg-destructive/5" : "border-success/40 bg-success/5"
    } ${className}`}>
      {falta
        ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />}
      <p>
        {falta ? (
          <>
            <strong className="text-destructive">Vai faltar dinheiro a partir de {fmtBR(projecao.primeiroDiaNegativo!)}.</strong>{" "}
            {minimo && <>O pior momento é {fmtBR(minimo.date)}, com <strong className="font-numeric">{brl(minimo.saldo)}</strong>. </>}
            {dica}
          </>
        ) : (
          <>
            <strong className="text-success">O dinheiro dá para tudo {noPeriodo}.</strong>{" "}
            {minimo && <>O saldo mais baixo será {brl(minimo.saldo)}, em {fmtBR(minimo.date)}.</>}
          </>
        )}
      </p>
    </div>
  );
}

const nomeMes = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const nome = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long" });
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} ${y}`;
};

const LISTA_INICIAL = 10;

export function ProjecaoCaixa({ saldoAtual, contaLabel, porConta }: {
  saldoAtual: number;
  contaLabel: string;
  porConta: boolean;
}) {
  const { data: clientes = [] } = useClientes();
  const ct = useChartColors();
  const [horizonte, setHorizonte] = useState<HorizonteId>(HORIZONTE_PADRAO);
  const [verTudo, setVerTudo] = useState(false);

  const dados = useProjecaoCaixa(saldoAtual, fimHorizonte(hojeISO(), horizonte));
  const noPeriodo = HORIZONTES.find((x) => x.id === horizonte)!.frase;
  const { projecao, meses, itens, fim } = dados;
  const nomeCliente = useMemo(() => new Map(clientes.map((c) => [c.id, c.nome])), [clientes]);
  const descricao = (i: ItemProjecao) => {
    if (i.origem !== "cobranca") return i.descricao || "Sem descrição";
    const cliente = nomeCliente.get(i.clienteId ?? "");
    return cliente ? `${i.descricao || "Mensalidade"} · ${cliente}` : i.descricao || "Mensalidade";
  };

  // Degradê que troca de cor exatamente no zero: acima é verde, abaixo é vermelho.
  const valores = projecao.series.map((p) => p.saldo);
  const max = Math.max(0, ...valores);
  const min = Math.min(0, ...valores);
  const corte = max === min ? 1 : max / (max - min);
  const minimo = projecao.saldoMinimo;
  const visiveis = verTudo ? itens : itens.slice(0, LISTA_INICIAL);

  return (
    <>
      {/* Até quando olhar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SeletorHorizonte valor={horizonte} onChange={setHorizonte} />
      </div>

      {porConta && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-[13px]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
          <p className="text-muted-foreground">
            As contas e cobranças são da empresa, não de uma conta bancária: a previsão parte do saldo de {contaLabel} e soma tudo o que a empresa tem em aberto.
          </p>
        </div>
      )}

      <ResumoProjecao saldoAtual={saldoAtual} contaLabel={contaLabel} dados={dados} />
      <VereditoProjecao dados={dados} noPeriodo={noPeriodo} />

      {/* Gráfico: só o futuro, verde acima do zero e vermelho abaixo */}
      <Card className="card-elevated mb-5 border-border/70 p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-display text-lg font-semibold">Como o saldo deve ficar</h3>
            <p className="text-sm text-muted-foreground">De hoje até {fmtBR(fim)} · cada degrau é uma conta paga ou um recebimento</p>
          </div>
          <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR_IN }} /> Saldo positivo</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR_OUT }} /> Saldo negativo</span>
          </div>
        </div>
        <div className="h-[300px]">
          {projecao.series.length <= 1 ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Nenhuma conta ou cobrança em aberto neste período — o saldo fica em {brl(saldoAtual)}.
            </div>
          ) : (
            <ResponsiveContainer>
              <AreaChart data={projecao.series} margin={{ left: 4, right: 16, top: 16, bottom: 4 }}>
                <defs>
                  <linearGradient id="projFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset={0} stopColor={COR_IN} stopOpacity={0.28} />
                    <stop offset={corte} stopColor={COR_IN} stopOpacity={0.04} />
                    <stop offset={corte} stopColor={COR_OUT} stopOpacity={0.04} />
                    <stop offset={1} stopColor={COR_OUT} stopOpacity={0.28} />
                  </linearGradient>
                  <linearGradient id="projLinha" x1="0" y1="0" x2="0" y2="1">
                    <stop offset={corte} stopColor={COR_IN} />
                    <stop offset={corte} stopColor={COR_OUT} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={ct.grid} vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: ct.label, fontSize: 12 }} minTickGap={28} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: ct.label, fontSize: 12 }} domain={[min, max]} tickFormatter={(v) => fmtK(v)} />
                <Tooltip contentStyle={{ ...ct.tooltip, borderRadius: 12, fontSize: 12 }}
                  labelFormatter={(_, p) => (p?.[0]?.payload?.date ? fmtBR(p[0].payload.date) : "")}
                  formatter={(v: number) => [brl(v), "Saldo previsto"]} />
                <ReferenceLine y={0} stroke={ct.axis} strokeDasharray="3 3"
                  label={{ value: "R$ 0", position: "insideTopLeft", fill: ct.axis, fontSize: 11 }} />
                <Area type="stepAfter" dataKey="saldo" stroke="url(#projLinha)" strokeWidth={2} fill="url(#projFill)" baseValue={0} />
                {minimo && minimo.saldo < projecao.saldoInicial && (
                  <ReferenceDot x={projecao.series.find((p) => p.date === minimo.date)?.day} y={minimo.saldo} r={5}
                    fill={minimo.saldo < 0 ? COR_OUT : COR_IN} stroke="#fff" strokeWidth={2}
                    label={{ value: "ponto mais baixo", position: "left", offset: 10, fill: ct.label, fontSize: 11 }} />
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Mês a mês */}
        <Card className="card-elevated self-start border-border/70 p-6">
          <h3 className="font-display text-lg font-semibold">Mês a mês</h3>
          <p className="mb-4 text-sm text-muted-foreground">Com quanto o caixa termina cada mês</p>
          {meses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada em aberto neste período.</p>
          ) : (
            <div className="space-y-3">
              {meses.map((m) => (
                <div key={m.mes} className="rounded-xl border border-border/70 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{nomeMes(m.mes)}</span>
                    <span className={`whitespace-nowrap font-numeric text-[17px] font-semibold tabular-nums ${m.saldoFinal < 0 ? "text-destructive" : ""}`}>
                      {brl(m.saldoFinal)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
                    <span>entra <span className="font-numeric text-success">{brl(m.entradas)}</span></span>
                    <span>sai <span className="font-numeric text-destructive">{brl(m.saidas)}</span></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Conta a conta */}
        <Card className="card-elevated border-border/70 p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-display text-lg font-semibold">O que vem por aí</h3>
              <p className="text-sm text-muted-foreground">Em ordem de data, com o saldo depois de cada uma</p>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/financeiro/pagamentos" search={{ aba: "contas" }}>Contas a pagar</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/financeiro/receitas" search={{ aba: "cobrancas" }}>Cobranças</Link>
              </Button>
            </div>
          </div>
          {itens.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma conta ou cobrança em aberto neste período.</p>
          ) : (
            <>
              <ul className="divide-y divide-border/70">
                {visiveis.map((i, n) => {
                  const virou = i.saldoDepois < 0 && (n === 0 ? saldoAtual >= 0 : visiveis[n - 1].saldoDepois >= 0);
                  return (
                    <li key={`${i.origem}-${i.dataISO}-${n}`}
                      className={`flex items-center gap-3 py-2.5 ${i.saldoDepois < 0 ? "bg-destructive/[0.03]" : ""}`}>
                      <span className="w-12 shrink-0 font-numeric text-[13px] text-muted-foreground">{ddMM(i.dataISO)}</span>
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${i.tipo === "in" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                        {i.tipo === "in" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px]">{descricao(i)}</span>
                        <span className="block text-[12px] text-muted-foreground">
                          {i.origem === "cobranca" ? "Cobrança de cliente" : i.tipo === "in" ? "Entrada prevista" : "Conta a pagar"}
                          {virou && <span className="ml-2 font-medium text-destructive">· aqui o saldo fica negativo</span>}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className={`block whitespace-nowrap font-numeric text-[14px] font-semibold tabular-nums ${i.tipo === "in" ? "text-success" : "text-destructive"}`}>
                          {i.tipo === "in" ? "+" : "−"} {brl(i.valor)}
                        </span>
                        <span className={`block whitespace-nowrap font-numeric text-[12px] tabular-nums ${i.saldoDepois < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          saldo {brl(i.saldoDepois)}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {itens.length > LISTA_INICIAL && (
                <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => setVerTudo((v) => !v)}>
                  {verTudo ? "Mostrar menos" : `Ver todos os ${itens.length} lançamentos`}
                </Button>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}

export function Parcela({ icone: Icone, rotulo, valor, detalhe, cor = "" }: {
  icone: React.ComponentType<{ className?: string }>;
  rotulo: string;
  valor: number;
  detalhe: string;
  cor?: string;
}) {
  return (
    <div className="px-1">
      <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <Icone className="h-4 w-4" /> {rotulo}
      </div>
      <div className={`mt-1 whitespace-nowrap font-numeric text-[24px] font-semibold tabular-nums ${cor}`}>{brl(valor)}</div>
      <div className="truncate text-[12px] text-muted-foreground">{detalhe}</div>
    </div>
  );
}

export function Sinal({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden className="hidden text-center font-display text-2xl font-light text-muted-foreground xl:block">
      {children}
    </span>
  );
}
