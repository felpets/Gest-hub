// ─── Receitas e vendas, no celular ──────────────────────────────────────────
// As três abas no desenho de app: as tabelas viram listas de cartões, o resumo
// de três cartões enormes vira uma faixa compacta, e registrar um recebimento
// se faz com o polegar. Entram quando a janela é estreita (ver src/lib/tela.ts).
// As telas de computador continuam em clientes.tsx, cobrancas.tsx e vendas.tsx.
//
// NADA de regra vive aqui:
//   · as linhas, os filtros e os totais das cobranças → receitas/dados-cobrancas
//   · a sincronização e o saldo de cada cliente → receitas/dados-clientes
//   · registrar o recebimento → o MESMO diálogo da tela de computador
//     (ReceberDialog), com o resumo previsto × recebido que o desenho pede.
//
// Uma coisa que o desenho pedia e NÃO existe: documento, e-mail e telefone do
// cliente. O cadastro guarda nome, mensalidade, dia de vencimento e a chave do
// extrato — então o cartão mostra isso, em vez de inventar um CNPJ.
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  RotateCcw,
  Search,
  ShoppingCart,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { brl } from "@/lib/format";
import {
  ddMM,
  fmtBR,
  hojeISO,
  nomeMesLongo,
  mesAnterior,
  mesSeguinte,
  compAtual,
} from "@/lib/datas";
import { useEmpresa } from "@/lib/empresa";
import { temCap } from "@/lib/permissoes";
import {
  useReabrirCobranca,
  useCancelarCobranca,
  useVendas,
  statusCobranca,
  type Cliente,
  type Cobranca,
  type StatusCobranca,
  type Venda,
} from "@/lib/queries";
import {
  useDadosCobrancas,
  FORMAS_PAGAMENTO,
  ROTULO_STATUS,
  type FiltroCobranca,
} from "@/modulos/financeiro/receitas/dados-cobrancas";
import {
  cobrancasDoCliente,
  useClientesComSaldo,
  useSincronizacaoCobrancas,
} from "@/modulos/financeiro/receitas/dados-clientes";
import { ReceberDialog } from "@/modulos/financeiro/telas/cobrancas";

// ─────────────────────────────────────────────────────────────
// Clientes
// ─────────────────────────────────────────────────────────────

export function ClientesCelular() {
  useSincronizacaoCobrancas();
  const hoje = hojeISO();
  const [busca, setBusca] = useState("");
  const [abertoId, setAbertoId] = useState<string | null>(null);

  const { clientes, cobrancas, lista, emAbertoDe, carregando, erro } = useClientesComSaldo(
    hoje,
    busca,
  );
  const aberto = useMemo(
    () => clientes.find((c) => c.id === abertoId) ?? null,
    [clientes, abertoId],
  );

  if (aberto) {
    return (
      <DetalheCliente
        cliente={aberto}
        cobrancas={cobrancas}
        hoje={hoje}
        voltar={() => setAbertoId(null)}
      />
    );
  }

  const devendo = lista.filter((c) => emAbertoDe(c.id).total > 0).length;

  return (
    <div className="space-y-3">
      <Busca valor={busca} onChange={setBusca} placeholder="Buscar cliente" />

      <div className="flex items-end justify-between gap-2 px-1">
        <b className="text-[12.5px] font-bold">Clientes</b>
        <span className="text-[11.5px] text-muted-foreground">
          {clientes.length} cadastrado{clientes.length === 1 ? "" : "s"}
          {devendo > 0 && ` · ${devendo} com saldo`}
        </span>
      </div>

      {carregando ? (
        <Esqueleto altura={74} />
      ) : erro ? (
        <Erro erro={erro} />
      ) : lista.length === 0 ? (
        <Vazio
          icone={Users}
          titulo={clientes.length === 0 ? "Nenhum cliente cadastrado" : "Nada encontrado"}
          texto={
            clientes.length === 0
              ? "O cliente com mensalidade gera as cobranças do mês sozinho."
              : "Mude a busca para ver outros clientes."
          }
        />
      ) : (
        <div className="space-y-2">
          {lista.map((c) => {
            const e = emAbertoDe(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setAbertoId(c.id)}
                className="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-card p-3 text-left"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--primary-tint)] text-[13px] font-bold text-primary">
                  {c.nome.trim().charAt(0).toUpperCase() || "?"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-bold">{c.nome}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {c.mens > 0
                      ? `${brl(c.mens)}/mês · vence dia ${c.diaVencimento}`
                      : "sem mensalidade"}
                    {!c.ativo && " · inativo"}
                  </span>
                  <span
                    className={`mt-0.5 block truncate text-[11.5px] font-semibold ${
                      e.vencido > 0
                        ? "text-destructive"
                        : e.total > 0
                          ? "text-warning-ink"
                          : "text-success"
                    }`}
                  >
                    {e.total > 0
                      ? `${brl(e.total)} em aberto · ${e.qtd} cobrança${e.qtd === 1 ? "" : "s"}`
                      : "sem valores em aberto"}
                  </span>
                </span>
                <ChevronRight className="h-[17px] w-[17px] shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DetalheCliente({
  cliente,
  cobrancas,
  hoje,
  voltar,
}: {
  cliente: Cliente;
  cobrancas: Cobranca[];
  hoje: string;
  voltar: () => void;
}) {
  const { caps } = useEmpresa();
  const podeGerir = temCap(caps, "clientes_gerir");
  const [receber, setReceber] = useState<Cobranca | null>(null);

  const { emAberto, recebidas, canceladas } = useMemo(
    () => cobrancasDoCliente(cobrancas, cliente.id, hoje),
    [cobrancas, cliente.id, hoje],
  );
  const totalAberto = emAberto.reduce((s, c) => s + c.valor, 0);

  const dados: [string, string][] = [
    ["Mensalidade", cliente.mens > 0 ? brl(cliente.mens) : "—"],
    ["Dia do vencimento", `dia ${cliente.diaVencimento}`],
    ["Cliente desde", cliente.clienteDesde ? fmtBR(cliente.clienteDesde) : "—"],
    ["Situação", cliente.ativo ? "Ativo" : "Inativo"],
    ["Chave no extrato", cliente.chaveOfx || cliente.nome],
  ];

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={voltar}
        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-border/70 px-2.5 text-[12.5px] font-bold"
      >
        <ArrowLeft className="h-4 w-4" /> Clientes
      </button>

      <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3.5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--primary-tint)] text-[17px] font-bold text-primary">
          {cliente.nome.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold">{cliente.nome}</p>
          <p
            className={`text-[12px] font-semibold ${totalAberto > 0 ? "text-destructive" : "text-success"}`}
          >
            {totalAberto > 0 ? `${brl(totalAberto)} em aberto` : "em dia"}
          </p>
        </div>
      </div>

      <Painel titulo="Cadastro" linhas={dados} />

      <GrupoCobrancas
        titulo="Em aberto"
        itens={emAberto}
        hoje={hoje}
        onReceber={podeGerir ? setReceber : undefined}
      />
      <GrupoCobrancas titulo="Recebidas" itens={recebidas} hoje={hoje} />
      <GrupoCobrancas titulo="Canceladas" itens={canceladas} hoje={hoje} />

      <ReceberDialog alvo={receber} onFechar={() => setReceber(null)} />
    </div>
  );
}

function GrupoCobrancas({
  titulo,
  itens,
  hoje,
  onReceber,
}: {
  titulo: string;
  itens: Cobranca[];
  hoje: string;
  onReceber?: (c: Cobranca) => void;
}) {
  if (itens.length === 0) return null;
  const total = itens.reduce(
    (s, c) => s + (c.status === "pago" ? (c.pagoValor ?? c.valor) : c.valor),
    0,
  );
  return (
    <>
      <div className="flex items-end justify-between gap-2 px-1">
        <b className="text-[12.5px] font-bold">{titulo}</b>
        <span className="text-[11.5px] text-muted-foreground">
          {itens.length} · {brl(total)}
        </span>
      </div>
      <div className="space-y-2">
        {itens.slice(0, 12).map((c) => (
          <CartaoCobranca key={c.id} c={c} hoje={hoje} onReceber={onReceber} />
        ))}
        {itens.length > 12 && (
          <p className="px-1 text-[11px] text-muted-foreground">
            e mais {itens.length - 12} — a lista inteira está na aba Cobranças.
          </p>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Cobranças
// ─────────────────────────────────────────────────────────────

const TOM_STATUS: Record<StatusCobranca, { tarja: string; texto: string; selo: string }> = {
  pendente: {
    tarja: "bg-warning",
    texto: "text-warning-ink",
    selo: "bg-warning/20 text-warning-ink",
  },
  vencido: {
    tarja: "bg-destructive",
    texto: "text-destructive",
    selo: "bg-destructive/15 text-destructive",
  },
  pago: { tarja: "bg-success", texto: "text-success", selo: "bg-success/15 text-success" },
  cancelado: {
    tarja: "bg-muted-foreground/40",
    texto: "text-muted-foreground",
    selo: "bg-secondary text-muted-foreground",
  },
};

export function CobrancasCelular() {
  const hoje = hojeISO();
  const { caps } = useEmpresa();
  const podeGerir = temCap(caps, "clientes_gerir");

  const [filtro, setFiltro] = useState<FiltroCobranca>("todas");
  const [busca, setBusca] = useState("");
  const [mes, setMes] = useState("");
  const [receber, setReceber] = useState<Cobranca | null>(null);
  const [cancelarAlvo, setCancelarAlvo] = useState<Cobranca | null>(null);
  const [visiveis, setVisiveis] = useState(30);

  const reabrir = useReabrirCobranca();
  const cancelar = useCancelarCobranca();
  const { linhas, totais, contagem, carregando } = useDadosCobrancas(hoje, { filtro, busca, mes });

  return (
    <div className="space-y-3">
      {/* ── Resumo ── */}
      <div className="grid grid-cols-3 gap-2">
        <Resumo
          rotulo="A receber"
          valor={totais.aReceber}
          nota={`${totais.qtdPendentes} no prazo`}
        />
        <Resumo
          rotulo="Vencido"
          valor={totais.vencido}
          nota={`${totais.qtdVencidas} cobrança${totais.qtdVencidas === 1 ? "" : "s"}`}
          tom="ruim"
        />
        <Resumo
          rotulo="Recebido"
          valor={totais.recebido}
          nota={`${totais.qtdRecebidas} registrado${totais.qtdRecebidas === 1 ? "" : "s"}`}
          tom="bom"
        />
      </div>

      {/* ── Mês e busca ── */}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center justify-between rounded-[12px] border border-border/70 bg-card pl-1 pr-1">
          <button
            type="button"
            onClick={() => setMes((m) => mesAnterior(m || compAtual()))}
            aria-label="Mês anterior"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-muted-foreground"
          >
            <ChevronLeft className="h-[18px] w-[18px]" />
          </button>
          <b className="truncate text-[12px] font-bold">
            {mes ? nomeMesLongo(mes) : "Todo o período"}
          </b>
          <button
            type="button"
            onClick={() => setMes((m) => mesSeguinte(m || compAtual()))}
            aria-label="Próximo mês"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-muted-foreground"
          >
            <ChevronRight className="h-[18px] w-[18px]" />
          </button>
        </div>
        {mes && (
          <button
            type="button"
            onClick={() => setMes("")}
            className="h-[42px] shrink-0 rounded-[12px] border border-border/70 px-3 text-[12px] font-bold text-primary"
          >
            Tudo
          </button>
        )}
      </div>

      <Busca valor={busca} onChange={setBusca} placeholder="Buscar cliente ou descrição" />

      {/* ── Situação ── */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {(
          [
            ["todas", `Todas (${contagem.todas})`],
            ["pendente", `A receber (${contagem.pendente})`],
            ["vencido", `Vencidas (${contagem.vencido})`],
            ["pago", `Recebidas (${contagem.pago})`],
          ] as const
        ).map(([id, rotulo]) => (
          <Pastilha key={id} ativa={filtro === id} onClick={() => setFiltro(id)}>
            {rotulo}
          </Pastilha>
        ))}
      </div>

      {carregando ? (
        <Esqueleto altura={82} />
      ) : linhas.length === 0 ? (
        <Vazio
          icone={HandCoins}
          titulo="Nenhuma cobrança aqui"
          texto="As cobranças nascem da mensalidade do cliente ou de uma venda parcelada."
        />
      ) : (
        <>
          <div className="space-y-2">
            {linhas.slice(0, visiveis).map((l) => (
              <CartaoCobranca
                key={l.c.id}
                c={l.c}
                hoje={hoje}
                cliente={l.cliente}
                origem={l.c.vendaId ? "Venda" : "Mensalidade"}
                onReceber={
                  podeGerir && l.st !== "pago" && l.st !== "cancelado" ? setReceber : undefined
                }
                onCancelar={
                  podeGerir && l.st !== "pago" && l.st !== "cancelado" ? setCancelarAlvo : undefined
                }
                onReabrir={
                  podeGerir && (l.st === "pago" || l.st === "cancelado")
                    ? (c) => reabrir.mutate(c.id)
                    : undefined
                }
              />
            ))}
          </div>
          {linhas.length > visiveis && (
            <button
              type="button"
              onClick={() => setVisiveis((v) => v + 30)}
              className="w-full rounded-xl border border-border/70 py-2.5 text-[12.5px] font-bold text-primary"
            >
              Ver mais {Math.min(30, linhas.length - visiveis)} de {linhas.length}
            </button>
          )}
        </>
      )}

      <p className="px-1 text-[11px] leading-snug text-muted-foreground">
        Cobrança em aberto é <strong className="text-foreground">entrada prevista</strong> no fluxo
        de caixa. Registrar o recebimento tira ela da projeção — o saldo continua vindo do extrato.
      </p>

      <ReceberDialog alvo={receber} onFechar={() => setReceber(null)} />

      {cancelarAlvo && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/50 p-3">
          <div className="w-full rounded-2xl bg-background p-4">
            <p className="text-[14px] font-bold">Cancelar esta cobrança?</p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              {brl(cancelarAlvo.valor)} com vencimento em {fmtBR(cancelarAlvo.vencimento)}. Ela sai
              dos totais e da projeção, mas continua na lista como cancelada — e dá para reabrir.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setCancelarAlvo(null)}
                disabled={cancelar.isPending}
                className="min-h-11 flex-1 rounded-[12px] border border-border/70 text-[12.5px] font-bold"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() =>
                  cancelar.mutate(cancelarAlvo.id, { onSuccess: () => setCancelarAlvo(null) })
                }
                disabled={cancelar.isPending}
                className="min-h-11 flex-1 rounded-[12px] bg-destructive text-[12.5px] font-bold text-white disabled:opacity-60"
              >
                {cancelar.isPending ? "Cancelando…" : "Cancelar cobrança"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CartaoCobranca({
  c,
  hoje,
  cliente,
  origem,
  onReceber,
  onCancelar,
  onReabrir,
}: {
  c: Cobranca;
  hoje: string;
  cliente?: string;
  origem?: string;
  onReceber?: (c: Cobranca) => void;
  onCancelar?: (c: Cobranca) => void;
  onReabrir?: (c: Cobranca) => void;
}) {
  const st = statusCobranca(c, hoje);
  const tom = TOM_STATUS[st];
  const quando =
    st === "pago"
      ? `Recebido em ${ddMM(c.pagoEm ?? c.vencimento)}`
      : st === "vencido"
        ? `Venceu em ${ddMM(c.vencimento)}`
        : st === "cancelado"
          ? "Cancelada"
          : `Vence em ${ddMM(c.vencimento)}`;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/70 bg-card p-3 pl-4">
      <span className={`absolute inset-y-0 left-0 w-1.5 ${tom.tarja}`} />
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          {cliente && <p className="truncate text-[12.5px] font-bold">{cliente}</p>}
          <p
            className={`truncate ${cliente ? "text-[11.5px] text-muted-foreground" : "text-[12.5px] font-bold"}`}
          >
            {c.descricao || origem || "Cobrança"}
          </p>
          <p className={`mt-0.5 text-[11.5px] font-semibold ${tom.texto}`}>{quando}</p>
        </div>
        <b className="shrink-0 text-[13px] font-bold tabular-nums">
          {brl(st === "pago" ? (c.pagoValor ?? c.valor) : c.valor)}
        </b>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tom.selo}`}>
          {ROTULO_STATUS[st]}
        </span>
        {c.parcela && (
          <span className="text-[11px] text-muted-foreground">
            parcela {c.parcela}/{c.parcelasTotal}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">
          {FORMAS_PAGAMENTO[c.formaPagamento] ?? c.formaPagamento}
        </span>
        {origem && !cliente && <span className="text-[11px] text-muted-foreground">{origem}</span>}
      </div>

      {(onReceber || onCancelar || onReabrir) && (
        <div className="mt-2 flex gap-2">
          {onReceber && (
            <button
              type="button"
              onClick={() => onReceber(c)}
              className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-success/10 text-[12px] font-bold text-success"
            >
              <Wallet className="h-4 w-4" /> Registrar recebimento
            </button>
          )}
          {onReabrir && (
            <button
              type="button"
              onClick={() => onReabrir(c)}
              className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-border/70 text-[12px] font-bold"
            >
              <RotateCcw className="h-4 w-4" /> Reabrir
            </button>
          )}
          {onCancelar && (
            <button
              type="button"
              onClick={() => onCancelar(c)}
              aria-label="Cancelar cobrança"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-border/70 text-muted-foreground"
            >
              <Ban className="h-[15px] w-[15px]" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Vendas
// ─────────────────────────────────────────────────────────────

export function VendasCelular() {
  const hoje = hojeISO();
  const { data: vendas = [], isLoading } = useVendas();
  const [busca, setBusca] = useState("");
  const [mes, setMes] = useState(() => compAtual());
  const [abertaId, setAbertaId] = useState<string | null>(null);

  const { clientes, cobrancas } = useClientesComSaldo(hoje);
  const nomeCliente = useMemo(() => new Map(clientes.map((c) => [c.id, c.nome])), [clientes]);
  const nomeDa = (v: Venda) =>
    v.clienteId ? (nomeCliente.get(v.clienteId) ?? v.cliente) : v.cliente;

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return vendas
      .filter((v) => (mes ? v.data.slice(0, 7) === mes : true))
      .filter(
        (v) =>
          !t ||
          nomeDa(v).toLowerCase().includes(t) ||
          v.descricao.toLowerCase().includes(t) ||
          v.vendedor.toLowerCase().includes(t),
      )
      .sort((a, b) => b.data.localeCompare(a.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendas, mes, busca, nomeCliente]);

  const total = lista.reduce((s, v) => s + v.valorBruto, 0);
  const aberta = useMemo(() => vendas.find((v) => v.id === abertaId) ?? null, [vendas, abertaId]);

  if (aberta) {
    return (
      <DetalheVenda
        v={aberta}
        cliente={nomeDa(aberta)}
        cobrancas={cobrancas.filter((c) => c.vendaId === aberta.id)}
        hoje={hoje}
        voltar={() => setAbertaId(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center justify-between rounded-[12px] border border-border/70 bg-card pl-1 pr-1">
          <button
            type="button"
            onClick={() => setMes((m) => mesAnterior(m || compAtual()))}
            aria-label="Mês anterior"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-muted-foreground"
          >
            <ChevronLeft className="h-[18px] w-[18px]" />
          </button>
          <b className="truncate text-[12px] font-bold">
            {mes ? nomeMesLongo(mes) : "Todo o período"}
          </b>
          <button
            type="button"
            onClick={() => setMes((m) => mesSeguinte(m || compAtual()))}
            aria-label="Próximo mês"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-muted-foreground"
          >
            <ChevronRight className="h-[18px] w-[18px]" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setMes((m) => (m ? "" : compAtual()))}
          className="h-[42px] shrink-0 rounded-[12px] border border-border/70 px-3 text-[12px] font-bold text-primary"
        >
          {mes ? "Tudo" : "Mês"}
        </button>
      </div>

      <div className="rounded-xl border border-border/70 bg-card p-3.5">
        <p className="text-[11.5px] text-muted-foreground">
          {mes ? `Vendas de ${nomeMesLongo(mes).toLowerCase()}` : "Vendas de todo o período"}
        </p>
        <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums">{brl(total)}</p>
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          {lista.length} venda{lista.length === 1 ? "" : "s"} · são controle: não entram no saldo,
          que vem do extrato
        </p>
      </div>

      <Busca valor={busca} onChange={setBusca} placeholder="Buscar cliente, item ou vendedor" />

      {isLoading ? (
        <Esqueleto altura={70} />
      ) : lista.length === 0 ? (
        <Vazio
          icone={ShoppingCart}
          titulo="Nenhuma venda neste período"
          texto="Uma venda parcelada vira cobranças — é assim que ela chega ao contas a receber."
        />
      ) : (
        <div className="space-y-2">
          {lista.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setAbertaId(v.id)}
              className="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-card p-3 text-left"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--primary-tint)]">
                <ShoppingCart className="h-[17px] w-[17px] text-primary" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-bold">
                  {nomeDa(v) || "(sem cliente)"}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {ddMM(v.data)} · {FORMAS_PAGAMENTO[v.formaPagamento] ?? v.formaPagamento}
                  {v.vendedor && ` · ${v.vendedor}`}
                </span>
                {v.descricao && (
                  <span className="mt-0.5 block truncate text-[11.5px]">{v.descricao}</span>
                )}
              </span>
              <b className="shrink-0 text-[12.5px] font-bold tabular-nums">{brl(v.valorBruto)}</b>
              <ChevronRight className="h-[17px] w-[17px] shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DetalheVenda({
  v,
  cliente,
  cobrancas,
  hoje,
  voltar,
}: {
  v: Venda;
  cliente: string;
  cobrancas: Cobranca[];
  hoje: string;
  voltar: () => void;
}) {
  const geradas = [...cobrancas].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const dados: [string, string][] = [
    ["Cliente", cliente || "—"],
    ["Data", fmtBR(v.data)],
    ["Forma", FORMAS_PAGAMENTO[v.formaPagamento] ?? v.formaPagamento],
    ["Vendedor", v.vendedor || "—"],
    ["Valor bruto", brl(v.valorBruto)],
    ["Valor líquido", brl(v.valorLiquido)],
  ];
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={voltar}
        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-border/70 px-2.5 text-[12.5px] font-bold"
      >
        <ArrowLeft className="h-4 w-4" /> Vendas
      </button>

      <div className="rounded-xl border border-border/70 bg-card p-3.5">
        <p className="truncate text-[12px] text-muted-foreground">{cliente || "(sem cliente)"}</p>
        <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums">
          {brl(v.valorBruto)}
        </p>
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          {fmtBR(v.data)}
          {geradas.length > 0 && ` · ${geradas.length} parcela${geradas.length === 1 ? "" : "s"}`}
        </p>
        {v.descricao && <p className="mt-2 text-[12.5px] font-semibold">{v.descricao}</p>}
      </div>

      <Painel titulo="Dados da venda" linhas={dados} />

      {v.observacao && (
        <div className="rounded-xl border border-border/70 bg-card p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Observação</p>
          <p className="mt-1 text-[12px] leading-snug">{v.observacao}</p>
        </div>
      )}

      <GrupoCobrancas titulo="Cobranças geradas" itens={geradas} hoje={hoje} />
      {geradas.length === 0 && (
        <p className="px-1 text-[11.5px] leading-snug text-muted-foreground">
          Esta venda não gerou cobranças — foi registrada só como controle.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Peças compartilhadas
// ─────────────────────────────────────────────────────────────

function Busca({
  valor,
  onChange,
  placeholder,
}: {
  valor: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-[12px] border border-border/70 bg-card px-3">
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
      />
      {valor && (
        <button type="button" onClick={() => onChange("")} aria-label="Limpar busca">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
    </label>
  );
}

function Painel({ titulo, linhas }: { titulo: string; linhas: [string, string][] }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card">
      <p className="border-b border-border/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </p>
      <div className="divide-y divide-border/50">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="shrink-0 text-[11.5px] text-muted-foreground">{rotulo}</span>
            <b className="min-w-0 truncate text-[12px] font-bold tabular-nums">{valor}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function Resumo({
  rotulo,
  valor,
  nota,
  tom,
}: {
  rotulo: string;
  valor: number;
  nota: string;
  tom?: "bom" | "ruim";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card p-2.5">
      <p className="truncate text-[11px] text-muted-foreground">{rotulo}</p>
      <p
        className={`mt-0.5 text-[13px] font-bold leading-tight tabular-nums ${
          tom === "bom" ? "text-success" : tom === "ruim" ? "text-destructive" : ""
        }`}
      >
        {brl(valor)}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{nota}</p>
    </div>
  );
}

function Pastilha({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
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

function Esqueleto({ altura }: { altura: number }) {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl bg-secondary"
          style={{ height: `${altura}px` }}
        />
      ))}
    </div>
  );
}

function Erro({ erro }: { erro: unknown }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-6 text-center">
      <AlertCircle className="mx-auto h-5 w-5 text-destructive" />
      <p className="mt-2 text-[13px] font-bold">Não foi possível carregar os dados</p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {erro instanceof Error ? erro.message : "Verifique sua conexão e tente novamente."}
      </p>
    </div>
  );
}

function Vazio({
  icone: Icone,
  titulo,
  texto,
}: {
  icone: typeof Users;
  titulo: string;
  texto: string;
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
    </div>
  );
}
