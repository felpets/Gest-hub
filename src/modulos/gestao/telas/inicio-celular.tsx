// ─── Início, no celular ─────────────────────────────────────────────────────
// O Dashboard da Gestão no desenho de app: o resumo do período num bloco só,
// os gastos por categoria em barras, o extrato agrupado por dia — e as outras
// duas abas (Projeção de caixa e Pessoas) na mesma linguagem. Entra quando a
// janela é estreita (ver src/lib/tela.ts): no APK Android e no site aberto num
// celular. As telas de computador continuam como estão, em painel-financeiro.tsx
// e fluxo-caixa.tsx.
//
// NADA de regra vive aqui. Os números do período vêm de dados-periodo.ts — o
// MESMO gancho da tela de computador —, a projeção vem de useProjecaoCaixa e os
// indicadores de pessoas, de useKpisPessoas. Se a conta mudar lá, muda aqui.
//
// Cores, raios e espaçamentos saíram do arquivo do Figma (Make), como no Pix do
// dia. O tamanho do texto é a única liberdade: o desenho usa 7-9px numa tela de
// 360, ilegível no aparelho de verdade, então o texto pequeno sobe para 11-12px
// mantendo a mesma hierarquia.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import {
  AlertTriangle,
  BarChart3,
  ChevronRight,
  FileText,
  History,
  TrendingDown,
  Upload,
} from "lucide-react";
import { brl } from "@/lib/format";
import { ddMM, fmtBR, hojeISO, pad } from "@/lib/datas";
import { periodoPadrao, rotuloPeriodo, type ModoPeriodo, type Periodo } from "@/lib/periodo";
import { useEmpresa } from "@/lib/empresa";
import { temCap } from "@/lib/permissoes";
import { useChartColors } from "@/lib/theme";
import { useClientes, type Movimentacao } from "@/lib/queries";
import type { ItemProjecao } from "@/lib/projecao";
import { SeletorConta } from "@/components/seletor-conta";
import { useDadosDoPeriodo, useSaldoDaConta } from "@/modulos/gestao/dashboard/dados-periodo";
import {
  comOutras,
  porCategoria,
  type FatiaCategoria,
} from "@/modulos/gestao/dashboard/categorias";
import { OPCOES_PERIODO, aplicarModoPeriodo } from "@/modulos/gestao/dashboard/seletor-periodo";
import { useKpisPessoas } from "@/modulos/gestao/ResumoPessoas";
import {
  HORIZONTES,
  HORIZONTE_PADRAO,
  fimHorizonte,
  useProjecaoCaixa,
  type HorizonteId,
} from "@/modulos/financeiro/previsao-caixa";

// O laranja do desenho. O recharts grava a cor como atributo SVG, que não
// resolve var(--…) — por isso o hex, como nos outros gráficos do Hub.
const COR_LINHA = "#F84F2F";
const COR_FALTA = "#D63B0F";

const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// Datas em ISO tratadas como texto: `new Date(iso)` no fuso do Brasil volta um
// dia, e o dia da semana sairia errado.
const daISO = (iso: string) => {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
};
const paraISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const domingoDe = (iso: string) => {
  const d = daISO(iso);
  d.setDate(d.getDate() - d.getDay());
  return paraISO(d);
};
const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;

// ─── 1) Histórico: o que já passou pelo extrato ─────────────────────────────
export function HistoricoCelular() {
  const hoje = hojeISO();
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoPadrao(hoje));
  // Categoria tocada nas barras: filtra a lista de baixo (o "toque para
  // filtrar" do desenho).
  const [cat, setCat] = useState<string | null>(null);
  const { caps } = useEmpresa();
  const {
    saldoExibido,
    mostrarAgora,
    contaLabel,
    nomeConta,
    realizado,
    extrato,
    flags,
    carregando,
  } = useDadosDoPeriodo(periodo, hoje);

  // Nas barras as categorias compensadas não aparecem: o líquido delas já está
  // no bloco de resumo (é a mesma regra da tela de computador).
  const paraGrafico = useMemo(
    () => extrato.filter((m) => !flags.compensaDe(m.cat)),
    [extrato, flags],
  );
  const saidas = useMemo(() => comOutras(porCategoria(paraGrafico, "out"), 4), [paraGrafico]);
  const totalSaidas = saidas.reduce((s, f) => s + f.value, 0);
  const nomeadas = useMemo(
    () => new Set(saidas.filter((f) => !f.name.startsWith("outras ")).map((f) => f.name)),
    [saidas],
  );

  const lista = useMemo(() => {
    if (!cat) return extrato;
    // A barra "outras N categorias" filtra por tudo o que ela resume.
    if (cat.startsWith("outras ")) {
      return extrato.filter(
        (m) => m.tipo === "out" && !nomeadas.has(m.cat?.trim() || "(sem categoria)"),
      );
    }
    return extrato.filter((m) => (m.cat?.trim() || "(sem categoria)") === cat);
  }, [extrato, cat, nomeadas]);

  const dias = useMemo(() => porDia(lista), [lista]);
  const diferenca = Math.round((realizado.entrou - realizado.saiu) * 100) / 100;

  return (
    <div className="space-y-3.5">
      <ChipsPeriodo
        periodo={periodo}
        hoje={hoje}
        onChange={(p) => {
          setPeriodo(p);
          setCat(null);
        }}
      />

      {carregando ? (
        <Esqueleto />
      ) : (
        <>
          <BlocoResumo
            rotulo={mostrarAgora ? "Saldo em conta" : "Saldo no fim do período"}
            valor={saldoExibido}
            nota={`${contaLabel} · ${mostrarAgora ? "hoje" : `em ${fmtBR(periodo.ate)}`}`}
            itens={[
              {
                rotulo: "Receita recebida",
                valor: realizado.entrou,
                nota: plural(realizado.qtdEntrou, "entrada no período", "entradas no período"),
                tom: "in",
              },
              {
                rotulo: "Já saiu",
                valor: realizado.saiu,
                nota: plural(realizado.qtdSaiu, "saída no período", "saídas no período"),
                tom: "out",
              },
            ]}
            fecho={{
              rotulo: "Diferença",
              valor: diferenca,
              nota: diferenca >= 0 ? "entrou mais do que saiu" : "saiu mais do que entrou",
              ruim: diferenca < 0,
            }}
          />

          {saidas.length > 0 && (
            <BarrasCategoria
              fatias={saidas}
              total={totalSaidas}
              selecionada={cat}
              onSelecionar={setCat}
            />
          )}

          {extrato.length === 0 ? (
            <Painel
              icone={History}
              titulo={`Nenhum lançamento em ${rotuloPeriodo(periodo)}`}
              texto="Importe o extrato para ver o histórico aqui."
              acao={
                temCap(caps, "mov_gerir") ? (
                  <Link
                    to="/financeiro/extratos"
                    search={{ aba: "importar" }}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-primary px-3.5 text-[12.5px] font-bold text-primary"
                  >
                    <Upload className="h-4 w-4" /> Importar extrato
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              <TituloDaLista
                titulo="Extrato do período"
                nota={plural(lista.length, "lançamento", "lançamentos")}
                filtro={cat}
                onLimpar={() => setCat(null)}
              />
              <ListaPorDia dias={dias} nomeConta={nomeConta} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── 2) Projeção de caixa: o que vem pela frente ────────────────────────────
const LISTA_INICIAL = 12;

export function ProjecaoCelular() {
  const hoje = hojeISO();
  const [horizonte, setHorizonte] = useState<HorizonteId>(HORIZONTE_PADRAO);
  const [verTudo, setVerTudo] = useState(false);
  const ct = useChartColors();
  const { saldoAtual, contaLabel, porConta, carregando } = useSaldoDaConta();
  const dados = useProjecaoCaixa(saldoAtual, fimHorizonte(hoje, horizonte));
  const { projecao, itens, entra, sai, qtdEntra, qtdSai, fim } = dados;

  const { data: clientes = [] } = useClientes();
  const nomeCliente = useMemo(() => new Map(clientes.map((c) => [c.id, c.nome])), [clientes]);
  const descricaoDe = (i: ItemProjecao) => {
    if (i.origem !== "cobranca") return i.descricao || "Sem descrição";
    const cliente = nomeCliente.get(i.clienteId ?? "");
    return cliente ? `${i.descricao || "Mensalidade"} · ${cliente}` : i.descricao || "Mensalidade";
  };

  const visiveis = verTudo ? itens : itens.slice(0, LISTA_INICIAL);
  const semanas = useMemo(() => porSemana(visiveis), [visiveis]);
  const minimo = projecao.saldoMinimo;

  return (
    <div className="space-y-3.5">
      {/* Até quando olhar */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {HORIZONTES.map((h) => (
          <Pastilha key={h.id} ativa={h.id === horizonte} onClick={() => setHorizonte(h.id)}>
            {h.dias ? `Próximos ${h.titulo}` : h.titulo}
          </Pastilha>
        ))}
      </div>

      {carregando ? (
        <Esqueleto />
      ) : (
        <>
          <BlocoResumo
            rotulo="Tenho hoje"
            valor={saldoAtual}
            nota={contaLabel}
            itens={[
              {
                rotulo: "Vai entrar",
                valor: entra,
                nota: plural(qtdEntra, "recebimento", "recebimentos"),
                tom: "in",
              },
              {
                rotulo: "Vai sair",
                valor: sai,
                nota: plural(qtdSai, "conta a pagar", "contas a pagar"),
                tom: "out",
              },
            ]}
            fecho={{
              rotulo: "Termino com",
              valor: projecao.saldoFinal,
              nota: `em ${fmtBR(fim)}`,
              ruim: projecao.saldoFinal < 0,
            }}
          />

          {porConta && (
            <p className="rounded-lg bg-secondary px-3 py-2.5 text-[11.5px] leading-snug text-muted-foreground">
              O saldo de partida é de {contaLabel}; as contas e as cobranças são da empresa inteira.
            </p>
          )}

          {/* Como o saldo deve ficar */}
          <section className="rounded-xl border border-border/70 bg-card p-3.5">
            <h2 className="text-[12.5px] font-bold">Como o saldo deve ficar</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              De hoje até {fmtBR(fim)} · cada degrau é uma conta paga ou um recebimento
            </p>
            {projecao.series.length <= 1 ? (
              <p className="py-8 text-center text-[12px] text-muted-foreground">
                Nada em aberto neste período — o saldo fica em {brl(saldoAtual)}.
              </p>
            ) : (
              <>
                <div className="mt-2.5 h-[140px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={projecao.series}
                      margin={{ top: 6, right: 2, bottom: 0, left: 2 }}
                    >
                      <defs>
                        <linearGradient id="projecaoCelular" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor={projecao.ficaNegativo ? COR_FALTA : COR_LINHA}
                            stopOpacity={0.22}
                          />
                          <stop
                            offset="100%"
                            stopColor={projecao.ficaNegativo ? COR_FALTA : COR_LINHA}
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="date"
                        tickFormatter={ddMM}
                        tick={{ fill: ct.label, fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={44}
                        interval="preserveStartEnd"
                      />
                      <YAxis hide domain={["auto", "auto"]} />
                      <ReferenceLine y={0} stroke={ct.axis} strokeDasharray="4 3" />
                      <Area
                        type="monotone"
                        dataKey="saldo"
                        stroke={projecao.ficaNegativo ? COR_FALTA : COR_LINHA}
                        strokeWidth={1.8}
                        fill="url(#projecaoCelular)"
                        dot={false}
                        isAnimationActive={false}
                      />
                      {minimo && (
                        <ReferenceDot
                          x={minimo.date}
                          y={minimo.saldo}
                          r={4}
                          fill={projecao.ficaNegativo ? COR_FALTA : COR_LINHA}
                          stroke="none"
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {minimo && (
                  <p
                    className={`mt-1.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${
                      projecao.ficaNegativo
                        ? "bg-destructive/10 text-destructive"
                        : "bg-[var(--primary-tint)] text-primary"
                    }`}
                  >
                    {projecao.ficaNegativo ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5" />
                    )}
                    {projecao.ficaNegativo
                      ? `falta dinheiro a partir de ${fmtBR(projecao.primeiroDiaNegativo!)}`
                      : `saldo mais baixo em ${fmtBR(minimo.date)} · ${brl(minimo.saldo)}`}
                  </p>
                )}
              </>
            )}
          </section>

          {itens.length === 0 ? (
            <Painel
              icone={History}
              titulo="Nada em aberto pela frente"
              texto="Contas a pagar e cobranças em aberto aparecem aqui assim que forem lançadas."
            />
          ) : (
            <>
              <TituloDaLista titulo="Projeção detalhada" nota="semana a semana" />
              <section className="overflow-hidden rounded-xl border border-border/70">
                {semanas.map((s) => (
                  <div key={s.iso}>
                    <CabecalhoDeGrupo titulo={`Semana de ${ddMM(s.iso)}`} liquido={s.liquido} />
                    {s.itens.map((i, n) => (
                      <div
                        key={`${i.dataISO}-${i.descricao}-${n}`}
                        className="flex items-center gap-2.5 border-t border-border/60 bg-card px-3 py-2.5"
                      >
                        <span className="w-[38px] shrink-0 text-[11px] font-bold text-muted-foreground">
                          {ddMM(i.dataISO)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-semibold">
                            {descricaoDe(i)}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {i.origem === "cobranca"
                              ? "Cobrança"
                              : i.tipo === "in"
                                ? "Receita prevista"
                                : "Conta a pagar"}
                          </span>
                        </span>
                        <Valor tipo={i.tipo} valor={i.valor} />
                      </div>
                    ))}
                  </div>
                ))}
              </section>
              {!verTudo && itens.length > LISTA_INICIAL && (
                <button
                  type="button"
                  onClick={() => setVerTudo(true)}
                  className="w-full rounded-xl border border-border/70 py-2.5 text-[12.5px] font-bold text-primary"
                >
                  Ver os {itens.length} lançamentos
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── 3) Pessoas (RH): os indicadores e as duas portas ───────────────────────
export function PessoasCelular({ onAbrir }: { onAbrir: (visao: string) => void }) {
  const { kpis, empresa, comp } = useKpisPessoas();
  // A folha fecha a grade ocupando a linha inteira: é o único valor em reais.
  const [grade, folha] = [kpis.slice(0, 4), kpis[4]];

  return (
    <div className="space-y-3.5">
      <TituloDaLista
        titulo="Pessoas"
        nota={`${empresa || "todas as empresas"} · ${comp.split("-").reverse().join("/")}`}
      />
      <section className="grid grid-cols-2 gap-2">
        {grade.map((k) => (
          <div key={k.label} className="rounded-xl border border-border/70 bg-card p-3">
            <p className="flex items-start gap-1.5 text-[11px] font-semibold leading-snug text-muted-foreground">
              <k.icon className="mt-px h-3.5 w-3.5 shrink-0" /> {k.label}
            </p>
            <p className="mt-1.5 text-[22px] font-bold leading-none tracking-tight">{k.valor}</p>
            {k.meta && <p className="mt-1 text-[11px] font-semibold text-warning-ink">{k.meta}</p>}
          </div>
        ))}
        <div className="col-span-2 flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3">
          <p className="flex flex-1 items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <folha.icon className="h-3.5 w-3.5 shrink-0" /> {folha.label}
          </p>
          <p className="text-[16px] font-bold tracking-tight">{folha.valor}</p>
        </div>
      </section>

      <TituloDaLista titulo="Atalhos" />
      <section className="overflow-hidden rounded-xl border border-border/70 bg-card">
        {[
          {
            id: "indicadores",
            titulo: "Indicadores",
            nota: "Números de pessoas no período",
            icon: BarChart3,
          },
          {
            id: "relatorios",
            titulo: "Relatórios",
            nota: "Listas e exportações do RH",
            icon: FileText,
          },
        ].map((a, n) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onAbrir(a.id)}
            className={`flex w-full items-center gap-3 px-3.5 py-3 text-left ${n > 0 ? "border-t border-border/60" : ""}`}
          >
            <a.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-bold">{a.titulo}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{a.nota}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </section>
    </div>
  );
}

// ─── Peças ──────────────────────────────────────────────────────────────────

// Período em pastilhas. Quem decide o que cada opção faz é a tela de
// computador (aplicarModoPeriodo): aqui é só a roupa.
function ChipsPeriodo({
  periodo,
  hoje,
  onChange,
}: {
  periodo: Periodo;
  hoje: string;
  onChange: (p: Periodo) => void;
}) {
  const trocar = (modo: ModoPeriodo) => onChange(aplicarModoPeriodo(modo, periodo, hoje));
  const campo =
    "h-9 min-w-0 flex-1 rounded-lg border border-border/70 bg-card px-2.5 text-[12.5px]";

  return (
    <div className="space-y-2">
      <div
        role="tablist"
        aria-label="Período do Início"
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {OPCOES_PERIODO.map((o) => (
          <Pastilha
            key={o.modo}
            ativa={periodo.modo === o.modo}
            onClick={() => trocar(o.modo)}
            role="tab"
          >
            {o.label}
          </Pastilha>
        ))}
        <SeletorConta variant="celular" />
      </div>

      {periodo.modo === "mes" && (
        <input
          type="month"
          aria-label="Mês do Início"
          className={campo}
          value={periodo.mes || hoje.slice(0, 7)}
          onChange={(e) =>
            e.target.value &&
            onChange(aplicarModoPeriodo("mes", { ...periodo, mes: e.target.value }, hoje))
          }
        />
      )}

      {periodo.modo === "personalizado" && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="Início do período"
            className={campo}
            value={periodo.de}
            onChange={(e) =>
              e.target.value &&
              onChange(
                aplicarModoPeriodo("personalizado", { ...periodo, de: e.target.value }, hoje),
              )
            }
          />
          <span className="shrink-0 text-[12px] text-muted-foreground">até</span>
          <input
            type="date"
            aria-label="Fim do período"
            className={campo}
            value={periodo.ate}
            onChange={(e) =>
              e.target.value &&
              onChange(
                aplicarModoPeriodo("personalizado", { ...periodo, ate: e.target.value }, hoje),
              )
            }
          />
        </div>
      )}
    </div>
  );
}

function Pastilha({
  ativa,
  onClick,
  role,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  role?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-selected={role === "tab" ? ativa : undefined}
      onClick={onClick}
      className={`h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-[12px] font-semibold transition-colors ${
        ativa
          ? "border-primary bg-[var(--primary-soft)] text-foreground"
          : "border-border/70 bg-card text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// O resumo em um bloco só: o número grande em cima (é de outra natureza — o
// saldo é de hoje, não do período), os dois do meio lado a lado e o fecho numa
// faixa colorida. Serve ao Histórico e à Projeção.
function BlocoResumo({
  rotulo,
  valor,
  nota,
  itens,
  fecho,
}: {
  rotulo: string;
  valor: number;
  nota: string;
  itens: { rotulo: string; valor: number; nota: string; tom: "in" | "out" }[];
  fecho: { rotulo: string; valor: number; nota: string; ruim: boolean };
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className="px-3.5 pb-3 pt-3.5">
        <p className="text-[11px] font-semibold text-muted-foreground">{rotulo}</p>
        <p className="mt-1.5 text-[22px] font-bold leading-none tracking-tight tabular-nums">
          {brl(valor)}
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">{nota}</p>
      </div>
      <div className="grid grid-cols-2 border-t border-border/70">
        {itens.map((i, n) => (
          <div
            key={i.rotulo}
            className={`px-3.5 py-2.5 ${n === 0 ? "border-r border-border/70" : ""}`}
          >
            <p className="text-[11px] font-semibold text-muted-foreground">{i.rotulo}</p>
            <p
              className={`mt-1 text-[13.5px] font-bold leading-none tabular-nums ${
                i.tom === "in" ? "text-success" : "text-destructive"
              }`}
            >
              {brl(i.valor)}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{i.nota}</p>
          </div>
        ))}
      </div>
      <div
        className={`border-t px-3.5 py-2.5 ${fecho.ruim ? "border-destructive/20 bg-destructive/10" : "border-success/20 bg-success/10"}`}
      >
        <p
          className={`text-[11px] font-semibold ${fecho.ruim ? "text-destructive" : "text-success"}`}
        >
          {fecho.rotulo}
        </p>
        <p
          className={`mt-1 text-[15px] font-bold leading-none tabular-nums ${fecho.ruim ? "text-destructive" : "text-success"}`}
        >
          {brl(fecho.valor)}
        </p>
        <p className={`mt-1 text-[11px] ${fecho.ruim ? "text-destructive/80" : "text-success/80"}`}>
          {fecho.nota}
        </p>
      </div>
    </section>
  );
}

function BarrasCategoria({
  fatias,
  total,
  selecionada,
  onSelecionar,
}: {
  fatias: FatiaCategoria[];
  total: number;
  selecionada: string | null;
  onSelecionar: (cat: string | null) => void;
}) {
  const cores = ["bg-primary", "bg-primary/70", "bg-primary/40", "bg-border"];
  return (
    <section className="rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[12.5px] font-bold">Gastos por categoria</h2>
        <span className="shrink-0 text-[11px] text-muted-foreground">toque para filtrar</span>
      </div>
      <div className="mt-2.5 space-y-2.5">
        {fatias.map((f, i) => {
          const pct = total > 0 ? Math.round((f.value / total) * 100) : 0;
          const on = selecionada === f.name;
          return (
            <button
              key={f.name}
              type="button"
              onClick={() => onSelecionar(on ? null : f.name)}
              className="block w-full text-left"
            >
              <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
                <span className={`truncate ${on ? "font-bold text-primary" : "font-medium"}`}>
                  {f.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {brl(f.value)} · <b className="text-foreground">{pct}%</b>
                </span>
              </div>
              <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full rounded-full ${cores[i] ?? "bg-border"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ListaPorDia({
  dias,
  nomeConta,
}: {
  dias: { iso: string; itens: Movimentacao[]; liquido: number }[];
  nomeConta: (id: string | null) => string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/70">
      {dias.map((d) => (
        <div key={d.iso}>
          <CabecalhoDeGrupo
            titulo={`${ddMM(d.iso)} · ${DIAS_CURTOS[daISO(d.iso).getDay()]}`}
            liquido={d.liquido}
          />
          {d.itens.map((m) => (
            <div key={m.id} className="border-t border-border/60 bg-card px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[12.5px] font-semibold">{m.ia || m.desc}</span>
                <Valor tipo={m.tipo} valor={m.valor} />
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="truncate rounded-md bg-[var(--primary-tint)] px-1.5 py-0.5 text-[10.5px] font-semibold text-primary">
                  {m.cat || "sem categoria"}
                </span>
                {nomeConta(m.contaId) && (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {nomeConta(m.contaId)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function CabecalhoDeGrupo({ titulo, liquido }: { titulo: string; liquido: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 bg-secondary px-3 py-1.5">
      <span className="text-[11px] font-bold text-muted-foreground">{titulo}</span>
      <span
        className={`text-[11px] font-bold tabular-nums ${liquido >= 0 ? "text-success" : "text-destructive"}`}
      >
        {liquido >= 0 ? "+" : "−"}
        {brl(Math.abs(liquido))}
      </span>
    </div>
  );
}

function Valor({ tipo, valor }: { tipo: "in" | "out"; valor: number }) {
  return (
    <span
      className={`shrink-0 whitespace-nowrap text-[13px] font-bold tabular-nums ${
        tipo === "in" ? "text-success" : "text-destructive"
      }`}
    >
      {tipo === "in" ? "+" : "−"}
      {brl(valor)}
    </span>
  );
}

function TituloDaLista({
  titulo,
  nota,
  filtro,
  onLimpar,
}: {
  titulo: string;
  nota?: string;
  filtro?: string | null;
  onLimpar?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 px-1">
      <h2 className="text-[12.5px] font-bold">{titulo}</h2>
      {filtro ? (
        <button
          type="button"
          onClick={onLimpar}
          className="inline-flex max-w-full items-center gap-1 rounded-md bg-[var(--primary-tint)] px-2 py-0.5 text-[11px] font-semibold text-primary"
        >
          <span className="truncate">{filtro}</span> ✕
        </button>
      ) : (
        nota && <span className="text-[11px] text-muted-foreground">{nota}</span>
      )}
    </div>
  );
}

function Painel({
  icone: Icone,
  titulo,
  texto,
  acao,
}: {
  icone: typeof History;
  titulo: string;
  texto: string;
  acao?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 px-3 py-8 text-center">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--primary-tint)]">
        <Icone className="h-5 w-5 text-primary" />
      </div>
      <p className="mt-2.5 text-[13px] font-bold">{titulo}</p>
      <p className="mx-auto mt-1 max-w-[260px] text-[12px] leading-snug text-muted-foreground">
        {texto}
      </p>
      {acao && <div className="mt-3">{acao}</div>}
    </div>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-2.5">
      <div className="h-[168px] animate-pulse rounded-xl bg-secondary" />
      <div className="h-[132px] animate-pulse rounded-xl bg-secondary" />
      <div className="h-[92px] animate-pulse rounded-xl bg-secondary" />
    </div>
  );
}

// ─── Agrupamentos ───────────────────────────────────────────────────────────

// O extrato por dia, do mais recente para o mais antigo. O líquido do dia é o
// que entrou menos o que saiu — é o número que o cabeçalho mostra.
function porDia(movs: Movimentacao[]) {
  const mapa = new Map<string, Movimentacao[]>();
  for (const m of movs) {
    const lista = mapa.get(m.dataISO);
    if (lista) lista.push(m);
    else mapa.set(m.dataISO, [m]);
  }
  return [...mapa.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([iso, itens]) => ({
      iso,
      itens: [...itens].sort((a, b) => b.valor - a.valor),
      liquido:
        Math.round(itens.reduce((s, m) => s + (m.tipo === "in" ? m.valor : -m.valor), 0) * 100) /
        100,
    }));
}

// A projeção por semana (domingo a sábado), do mais próximo para o mais longe.
function porSemana(itens: ItemProjecao[]) {
  const mapa = new Map<string, ItemProjecao[]>();
  for (const i of itens) {
    const semana = domingoDe(i.dataISO);
    const lista = mapa.get(semana);
    if (lista) lista.push(i);
    else mapa.set(semana, [i]);
  }
  return [...mapa.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([iso, doGrupo]) => ({
      iso,
      itens: doGrupo,
      liquido:
        Math.round(doGrupo.reduce((s, i) => s + (i.tipo === "in" ? i.valor : -i.valor), 0) * 100) /
        100,
    }));
}
