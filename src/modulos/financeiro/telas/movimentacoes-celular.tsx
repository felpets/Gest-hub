// ─── Movimentações, no celular ──────────────────────────────────────────────
// A mesma aba Caixa › Movimentações, no desenho de app: a tabela vira lista de
// cartões, os filtros viram uma folha que sobe, e recategorizar em lote se faz
// com o polegar. Entra quando a janela é estreita (ver src/lib/tela.ts) — no APK
// Android e no site aberto num celular. A tela de computador continua em
// movimentacoes.tsx.
//
// NADA de regra vive aqui. Os filtros são lib/filtros-movimentacoes (função
// pura, com teste), a lista de categorias é a mesma da tela de computador
// (opcoesDeCategoria) e o formulário é o MESMO diálogo — o que é um lançamento
// válido não pode ter duas versões.
//
// Cores, raios e espaçamentos saíram do arquivo do Figma (Make); os tokens
// próprios do desenho estão em styles.css, presos a .app-celular.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeftRight,
  Download,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { brl } from "@/lib/format";
import { ddMM } from "@/lib/datas";
import { useEmpresa } from "@/lib/empresa";
import { temCap } from "@/lib/permissoes";
import { SeletorConta } from "@/components/seletor-conta";
import {
  useMovimentacoes,
  usePlanoContas,
  useDeleteMovimentacoesBatch,
  useUpdateMovimentacoesCategoria,
  type Movimentacao,
} from "@/lib/queries";
import {
  aplicaFiltros,
  filtrosAtivos,
  opcoesDeCategoria,
  mesmoRange,
  rangePreset,
  FILTROS_VAZIO,
  PRESETS,
  SEM_CATEGORIA,
  type Filtros,
  type GrupoCat,
} from "@/lib/filtros-movimentacoes";
import { MovimentacaoDialog } from "@/modulos/financeiro/telas/movimentacoes";

// Quantos cartões a lista mostra antes do "carregar mais". Rolar mil cartões no
// celular trava; a tela de computador pagina pelo mesmo motivo.
const PAGINA = 40;

// Abaixo disto a categoria veio de um palpite fraco da classificação: o cartão
// pede conferência em vez de fingir certeza (é a faixa âmbar da tela grande).
const CONFIANCA_BAIXA = 0.9;

type Tipo = "todas" | "in" | "out";

export function MovimentacoesCelular() {
  const { data: movimentos = [], isLoading, error } = useMovimentacoes();
  const { data: plano = [] } = usePlanoContas();
  const { caps } = useEmpresa();
  const podeGerir = temCap(caps, "mov_gerir");
  const recategorizar = useUpdateMovimentacoesCategoria();
  const excluirLote = useDeleteMovimentacoesBatch();

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIO);
  const [tipo, setTipo] = useState<Tipo>("todas");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [folha, setFolha] = useState<"filtros" | "categoria" | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<Movimentacao | null>(null);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [visiveis, setVisiveis] = useState(PAGINA);

  // Mudou o filtro ou a aba: a paginação volta ao começo e a seleção some —
  // manter selecionado o que saiu da tela é como apagar às cegas.
  useEffect(() => {
    setVisiveis(PAGINA);
    setSel(new Set());
  }, [filtros, tipo]);

  const filtradas = useMemo(() => aplicaFiltros(movimentos, filtros), [movimentos, filtros]);
  const contagem = useMemo(
    () => ({
      todas: filtradas.length,
      in: filtradas.filter((m) => m.tipo === "in").length,
      out: filtradas.filter((m) => m.tipo === "out").length,
    }),
    [filtradas],
  );
  const lista = useMemo(
    () => (tipo === "todas" ? filtradas : filtradas.filter((m) => m.tipo === tipo)),
    [filtradas, tipo],
  );
  const { grupos, temSemCategoria } = useMemo(
    () => opcoesDeCategoria(plano, movimentos),
    [plano, movimentos],
  );

  const alternar = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selecionadas = useMemo(() => lista.filter((m) => sel.has(m.id)), [lista, sel]);

  const aplicarCategoria = async (categoria: string) => {
    await recategorizar.mutateAsync({ ids: [...sel], categoria });
    setSel(new Set());
    setFolha(null);
  };
  const confirmarExcluir = async () => {
    await excluirLote.mutateAsync([...sel]);
    setSel(new Set());
    setConfirmarExclusao(false);
  };

  return (
    <div className="space-y-3">
      {/* ── Ações da aba ── */}
      {podeGerir && (
        <div className="flex gap-2">
          <Link
            to="/financeiro/extratos"
            search={{ aba: "importar" }}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-border/70 px-2 text-[12.5px] font-bold"
          >
            <Download className="h-4 w-4" /> Importar extrato
          </Link>
          <button
            type="button"
            onClick={() => {
              setEditando(null);
              setFormAberto(true);
            }}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-primary px-2 text-[12.5px] font-bold text-[var(--primary-ink)]"
          >
            <Plus className="h-4 w-4" /> Nova movimentação
          </button>
        </div>
      )}

      {/* ── Busca e filtros ── */}
      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-border/70 bg-card px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={filtros.busca}
            onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
            placeholder="Buscar por descrição"
            aria-label="Buscar por descrição"
            className="h-10 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
          />
          {filtros.busca && (
            <button
              type="button"
              onClick={() => setFiltros({ ...filtros, busca: "" })}
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </label>
        <button
          type="button"
          onClick={() => setFolha("filtros")}
          aria-label="Abrir filtros"
          className="relative grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border border-border/70 bg-card"
        >
          <SlidersHorizontal className="h-[17px] w-[17px]" />
          {filtrosAtivos(filtros) && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </button>
      </div>

      {/* ── Conta e tipo ── */}
      <div className="space-y-2">
        <SeletorConta variant="celular" />
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ["todas", `Todas (${contagem.todas})`],
              ["in", `Entradas (${contagem.in})`],
              ["out", `Saídas (${contagem.out})`],
            ] as const
          ).map(([id, rotulo]) => (
            <Pastilha key={id} ativa={tipo === id} onClick={() => setTipo(id)}>
              {rotulo}
            </Pastilha>
          ))}
        </div>
      </div>

      {/* ── Lista ── */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-6 text-center">
          <AlertCircle className="mx-auto h-5 w-5 text-destructive" />
          <p className="mt-2 text-[13px] font-bold">Não foi possível carregar os dados</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {error instanceof Error ? error.message : "Verifique sua conexão e tente novamente."}
          </p>
        </div>
      ) : lista.length === 0 ? (
        <div className="rounded-xl border border-border/70 px-3 py-8 text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--primary-tint)]">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
          </div>
          <p className="mt-2.5 text-[13px] font-bold">
            {movimentos.length === 0
              ? "Nenhuma movimentação importada"
              : "Nada encontrado com estes filtros"}
          </p>
          <p className="mx-auto mt-1 max-w-[260px] text-[12px] leading-snug text-muted-foreground">
            {movimentos.length === 0
              ? "Importe o extrato bancário para começar a classificar."
              : "Limpe um filtro ou mude a busca para ver mais lançamentos."}
          </p>
          {movimentos.length > 0 && filtrosAtivos(filtros) && (
            <button
              type="button"
              onClick={() => setFiltros(FILTROS_VAZIO)}
              className="mt-3 inline-flex min-h-10 items-center rounded-[10px] border border-primary px-3.5 text-[12.5px] font-bold text-primary"
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {lista.slice(0, visiveis).map((m) => (
              <CartaoMovimentacao
                key={m.id}
                m={m}
                selecionada={sel.has(m.id)}
                podeSelecionar={podeGerir}
                onTocar={() => podeGerir && alternar(m.id)}
              />
            ))}
          </div>
          {lista.length > visiveis && (
            <button
              type="button"
              onClick={() => setVisiveis((v) => v + PAGINA)}
              className="w-full rounded-xl border border-border/70 py-2.5 text-[12.5px] font-bold text-primary"
            >
              Ver mais {Math.min(PAGINA, lista.length - visiveis)} de {lista.length}
            </button>
          )}
        </>
      )}

      {/* A barra de seleção é fixa e cobriria os últimos cartões da lista: este
          espaço devolve o que ela ocupa. */}
      {sel.size > 0 && <div aria-hidden className="h-[62px]" />}

      {/* ── Barra de seleção ── */}
      {sel.size > 0 && (
        <div
          className="fixed inset-x-2.5 bottom-[70px] z-20 flex min-h-[58px] items-center gap-2 rounded-[14px] bg-primary py-2 pl-3.5 pr-2 text-[var(--primary-ink)] shadow-xl shadow-primary/40"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-bold leading-tight">
              {sel.size} selecionada{sel.size === 1 ? "" : "s"}
            </p>
            <p className="mt-0.5 truncate text-[12px] leading-tight opacity-80">
              {brl(selecionadas.reduce((s, m) => s + m.valor, 0))}
            </p>
          </div>
          {/* Com uma só selecionada dá para abrir o lançamento: é o equivalente
              ao lápis da linha na tela de computador. */}
          {sel.size === 1 && (
            <button
              type="button"
              onClick={() => {
                setEditando(selecionadas[0] ?? null);
                setFormAberto(true);
              }}
              aria-label="Editar lançamento"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[var(--primary-tint)]"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setFolha("categoria")}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--primary-tint)] px-3 text-[12.5px] font-bold"
          >
            <Tags className="h-4 w-4" /> Recategorizar
          </button>
          <button
            type="button"
            onClick={() => setConfirmarExclusao(true)}
            aria-label="Excluir selecionadas"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[var(--primary-tint)] text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}

      <FolhaFiltros
        aberta={folha === "filtros"}
        fechar={() => setFolha(null)}
        filtros={filtros}
        onChange={setFiltros}
        grupos={grupos}
        temSemCategoria={temSemCategoria}
        resultados={lista.length}
      />

      <FolhaCategoria
        aberta={folha === "categoria"}
        fechar={() => setFolha(null)}
        grupos={grupos}
        quantas={sel.size}
        salvando={recategorizar.isPending}
        onEscolher={aplicarCategoria}
      />

      <MovimentacaoDialog open={formAberto} onOpenChange={setFormAberto} mov={editando} />

      <AlertDialog open={confirmarExclusao} onOpenChange={setConfirmarExclusao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {sel.size} movimentação(ões)?</AlertDialogTitle>
            <AlertDialogDescription>
              Some do extrato e do saldo. Se elas vieram do banco, voltam na próxima importação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirLote.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmarExcluir();
              }}
              disabled={excluirLote.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {excluirLote.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Cartão de movimentação ─────────────────────────────────
function CartaoMovimentacao({
  m,
  selecionada,
  podeSelecionar,
  onTocar,
}: {
  m: Movimentacao;
  selecionada: boolean;
  podeSelecionar: boolean;
  onTocar: () => void;
}) {
  const entrada = m.tipo === "in";
  return (
    <button
      type="button"
      onClick={onTocar}
      aria-pressed={podeSelecionar ? selecionada : undefined}
      className={`grid w-full grid-cols-[38px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
        selecionada ? "border-primary bg-[var(--primary-soft)]" : "border-border/70 bg-card"
      }`}
    >
      <span className="pt-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
        {ddMM(m.dataISO)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-bold">{m.desc}</span>
        {m.ia && m.ia !== m.desc && (
          <span className="mt-1 block truncate text-[11.5px] text-muted-foreground">{m.ia}</span>
        )}
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="max-w-full truncate rounded-md bg-[var(--primary-tint)] px-1.5 py-0.5 text-[11px] font-semibold text-primary">
            {m.cat || "sem categoria"}
          </span>
          {m.conf < CONFIANCA_BAIXA && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-warning-ink">
              <i className="h-1.5 w-1.5 rounded-full bg-warning" /> confira a categoria
            </span>
          )}
        </span>
      </span>
      <b
        className={`whitespace-nowrap pt-0.5 text-[12.5px] font-bold tabular-nums ${
          entrada ? "text-success" : "text-destructive"
        }`}
      >
        {entrada ? "+" : "−"}
        {brl(m.valor)}
      </b>
    </button>
  );
}

// ─── Folha de filtros ───────────────────────────────────────
function FolhaFiltros({
  aberta,
  fechar,
  filtros,
  onChange,
  grupos,
  temSemCategoria,
  resultados,
}: {
  aberta: boolean;
  fechar: () => void;
  filtros: Filtros;
  onChange: (f: Filtros) => void;
  grupos: GrupoCat[];
  temSemCategoria: boolean;
  resultados: number;
}) {
  const [busca, setBusca] = useState("");
  const campo =
    "h-10 w-full min-w-0 rounded-lg border border-border/70 bg-card px-2.5 text-[12.5px]";

  const alternarCat = (v: string) => {
    const n = new Set(filtros.cats ?? []);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    onChange({ ...filtros, cats: n.size === 0 ? null : n });
  };

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return grupos;
    return grupos
      .map((g) => ({ ...g, opcoes: g.opcoes.filter((o) => o.label.toLowerCase().includes(t)) }))
      .filter((g) => g.opcoes.length > 0);
  }, [grupos, busca]);

  return (
    <Sheet open={aberta} onOpenChange={(v) => (v ? undefined : fechar())}>
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle className="text-[16px]">Filtrar movimentações</SheetTitle>
          <SheetDescription className="text-[11.5px]">
            Refine os resultados do extrato
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 space-y-4">
          <section>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Período
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Pastilha
                  key={p.id}
                  ativa={mesmoRange(filtros, rangePreset(p.id))}
                  onClick={() => onChange({ ...filtros, ...rangePreset(p.id) })}
                >
                  {p.label}
                </Pastilha>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <input
                type="date"
                aria-label="De"
                className={campo}
                value={filtros.de ?? ""}
                onChange={(e) => onChange({ ...filtros, de: e.target.value || null })}
              />
              <span className="shrink-0 text-[12px] text-muted-foreground">até</span>
              <input
                type="date"
                aria-label="Até"
                className={campo}
                value={filtros.ate ?? ""}
                onChange={(e) => onChange({ ...filtros, ate: e.target.value || null })}
              />
            </div>
          </section>

          <section>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Faixa de valor
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="R$ 0,00"
                aria-label="Valor mínimo"
                className={campo}
                value={filtros.valorMin ?? ""}
                onChange={(e) =>
                  onChange({
                    ...filtros,
                    valorMin: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <span className="shrink-0 text-[12px] text-muted-foreground">até</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="sem teto"
                aria-label="Valor máximo"
                className={campo}
                value={filtros.valorMax ?? ""}
                onChange={(e) =>
                  onChange({
                    ...filtros,
                    valorMax: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </div>
          </section>

          <section>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Categoria
            </p>
            <label className="mt-2 flex items-center gap-2 rounded-[10px] border border-border/70 bg-card px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar categoria"
                aria-label="Buscar categoria"
                className="h-10 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
              />
            </label>
            <div className="mt-2 max-h-[220px] overflow-y-auto rounded-[10px] border border-border/70">
              {temSemCategoria && !busca.trim() && (
                <ItemCategoria
                  rotulo="Sem categoria"
                  marcada={filtros.cats?.has(SEM_CATEGORIA) ?? false}
                  onTocar={() => alternarCat(SEM_CATEGORIA)}
                />
              )}
              {visiveis.map((g) => (
                <div key={g.titulo}>
                  <p className="bg-secondary px-3 py-1.5 text-[11px] font-bold text-muted-foreground">
                    {g.titulo}
                  </p>
                  {g.opcoes.map((o) => (
                    <ItemCategoria
                      key={o.value}
                      rotulo={o.label}
                      filha={o.filho}
                      marcada={filtros.cats?.has(o.value) ?? false}
                      onTocar={() => alternarCat(o.value)}
                    />
                  ))}
                </div>
              ))}
              {visiveis.length === 0 && (
                <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                  Nenhuma categoria com esse nome.
                </p>
              )}
            </div>
          </section>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onChange(FILTROS_VAZIO)}
            className="min-h-11 flex-1 rounded-[10px] border border-border/70 text-[12.5px] font-bold"
          >
            Limpar
          </button>
          <button
            type="button"
            onClick={fechar}
            className="min-h-11 flex-[1.4] rounded-[10px] bg-primary text-[12.5px] font-bold text-[var(--primary-ink)]"
          >
            Ver {resultados} movimentaç{resultados === 1 ? "ão" : "ões"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ItemCategoria({
  rotulo,
  filha,
  marcada,
  onTocar,
}: {
  rotulo: string;
  filha?: boolean;
  marcada: boolean;
  onTocar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTocar}
      aria-pressed={marcada}
      className={`flex w-full items-center gap-2.5 border-t border-border/60 px-3 py-2.5 text-left first:border-t-0 ${
        marcada ? "bg-[var(--primary-tint)]" : ""
      }`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border ${
          marcada ? "border-primary bg-primary text-[var(--primary-ink)]" : "border-border"
        }`}
      >
        {marcada && <span className="text-[10px] font-bold leading-none">✓</span>}
      </span>
      <span
        className={`truncate text-[12.5px] ${filha ? "pl-2 text-muted-foreground" : "font-semibold"}`}
      >
        {rotulo}
      </span>
    </button>
  );
}

// ─── Folha de recategorizar ─────────────────────────────────
function FolhaCategoria({
  aberta,
  fechar,
  grupos,
  quantas,
  salvando,
  onEscolher,
}: {
  aberta: boolean;
  fechar: () => void;
  grupos: GrupoCat[];
  quantas: number;
  salvando: boolean;
  onEscolher: (categoria: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const opcoes = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const todas = grupos.flatMap((g) =>
      g.opcoes.map((o) => ({ value: o.value, label: o.label, grupo: g.titulo })),
    );
    return t ? todas.filter((o) => o.value.toLowerCase().includes(t)) : todas;
  }, [grupos, busca]);

  return (
    <Sheet open={aberta} onOpenChange={(v) => (v ? undefined : fechar())}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle className="text-[16px]">Recategorizar</SheetTitle>
          <SheetDescription className="text-[11.5px]">
            {quantas} movimentaç{quantas === 1 ? "ão selecionada" : "ões selecionadas"}
          </SheetDescription>
        </SheetHeader>

        <label className="mt-3 flex items-center gap-2 rounded-[10px] border border-border/70 bg-card px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar categoria"
            aria-label="Buscar categoria"
            className="h-10 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
          />
        </label>

        <div className="mt-2 divide-y divide-border/60">
          {opcoes.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={salvando}
              onClick={() => void onEscolher(o.value)}
              className="flex w-full items-center gap-2.5 py-3 text-left disabled:opacity-60"
            >
              <span className="h-7 w-7 shrink-0 rounded-[9px] bg-[var(--primary-tint)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-bold">{o.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{o.grupo}</span>
              </span>
            </button>
          ))}
          {opcoes.length === 0 && (
            <p className="py-6 text-center text-[12px] text-muted-foreground">
              Nenhuma categoria com esse nome.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
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
