import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Plus, Upload, Download, FileDown,
  ArrowUpRight, ArrowDownLeft,
  Trash2, Pencil, Loader2, Tags, X, Lock, AlertTriangle,
} from "lucide-react";
import { brl, numFromInput } from "@/lib/format";
import {
  useMovimentacoes, useSaveMovimentacao, useDeleteMovimentacao,
  usePlanoContas, useContasBancarias, fetchMovimentacoesSimilares,
  useDeleteMovimentacoesBatch, useUpdateMovimentacoesCategoria,
  type Movimentacao, type MovimentacaoInput,
} from "@/lib/queries";
import { useEmpresa } from "@/lib/empresa";
import { hojeISO, fmtBR } from "@/lib/datas";
import { FiltrosMovimentacoes } from "@/components/FiltrosMovimentacoes";
import { aplicaFiltros, FILTROS_VAZIO, type Filtros } from "@/lib/filtros-movimentacoes";
import { exportToPdf, exportToXlsx } from "@/lib/export";

function Confidence({ c }: { c: number }) {
  const pct = Math.round(c * 100);
  const color = c > 0.9 ? "bg-success" : c > 0.75 ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-numeric tabular-nums text-muted-foreground w-9 text-right">{pct}%</span>
    </div>
  );
}

const emptyMov = (contaId: string): MovimentacaoInput => ({
  data: hojeISO(),
  descricao: "",
  descricao_ia: "",
  categoria: "",
  valor: 0,
  tipo: "out",
  confianca: 1,
  contaId,
});

// ─── Diálogo de criar/editar transação ──────────────────────
// A tela de celular (movimentacoes-celular.tsx) abre ESTE mesmo diálogo: o que
// é um lançamento válido (duplicata, valor, conta, o que trava quando veio do
// extrato) é regra, e regra não se escreve duas vezes.
export function MovimentacaoDialog({
  open, onOpenChange, mov,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mov: Movimentacao | null;
}) {
  const save = useSaveMovimentacao();
  const { data: contas = [] } = usePlanoContas();
  const { data: contasBancarias = [] } = useContasBancarias();
  const { contaId: contaAtivaId } = useEmpresa();
  const ativas = contasBancarias.filter((c) => c.ativo);
  const [form, setForm] = useState<MovimentacaoInput>(emptyMov(""));
  const [err, setErr] = useState<string | null>(null);
  // Aviso de possível duplicata ao lançar à mão (lista dos parecidos já existentes).
  const [dupAviso, setDupAviso] = useState<{ id: string; descricao: string }[] | null>(null);
  // Editar um lançamento que veio do extrato (com fitid) trava valor/tipo; este
  // destrava sob confirmação do usuário.
  const [destravado, setDestravado] = useState(false);
  const veioDoBanco = !!mov?.fitid;
  const travado = veioDoBanco && !destravado;

  // Opções de categoria do plano de contas (caminho "Pai / Filho"), agrupadas.
  const catGroups = useMemo(() => {
    const roots = contas.filter((c) => !c.parentId);
    return roots.map((root) => ({
      label: root.nome,
      options: [
        { value: root.nome, label: root.nome },
        ...contas
          .filter((c) => c.parentId === root.id)
          .map((c) => ({ value: `${root.nome} / ${c.nome}`, label: c.nome })),
      ],
    }));
  }, [contas]);
  const catKnown = useMemo(
    () => new Set(catGroups.flatMap((g) => g.options.map((o) => o.value))),
    [catGroups]
  );
  // Categoria atual fora do plano de contas (ex.: importada como texto livre): preserva como opção.
  const categoriaForaDoPlano = form.categoria.trim() !== "" && !catKnown.has(form.categoria);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setDupAviso(null);
    setDestravado(false);
    // Conta padrão do novo lançamento: a conta ativa, ou a 1ª conta ativa.
    const dc = contaAtivaId ?? ativas[0]?.id ?? "";
    setForm(
      mov
        ? { data: mov.dataISO, descricao: mov.desc, descricao_ia: mov.ia, categoria: mov.cat, valor: mov.valor, tipo: mov.tipo, confianca: mov.conf, contaId: mov.contaId ?? dc, fitid: mov.fitid }
        : emptyMov(dc)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mov]);

  // `ignorarDup` = já confirmou o aviso de duplicata e quer salvar mesmo assim.
  const handleSave = async (ignorarDup = false) => {
    if (!form.descricao.trim()) { setErr("Informe a descrição."); return; }
    if (!form.data) { setErr("Informe a data."); return; }
    if (!form.valor || form.valor <= 0) { setErr("Informe um valor maior que zero."); return; }
    const contaId = form.contaId || ativas[0]?.id || "";
    if (!contaId) { setErr("Cadastre uma conta bancária em Ajustes antes de lançar."); return; }
    setErr(null);

    // Só em lançamento NOVO: avisa se já existe um parecido (mesma conta+data+valor+tipo).
    if (!mov?.id && !ignorarDup) {
      try {
        const similares = await fetchMovimentacoesSimilares(contaId, form.data, form.valor, form.tipo);
        if (similares.length > 0) { setDupAviso(similares); return; }
      } catch {
        // se a checagem falhar, não bloqueia o lançamento
      }
    }

    try {
      await save.mutateAsync({ id: mov?.id, input: { ...form, contaId, descricao: form.descricao.trim() } });
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar a transação.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{mov ? "Editar transação" : "Nova transação"}</DialogTitle>
          <DialogDescription>
            Lançamento do extrato bancário. O valor é sempre positivo; o tipo define entrada ou saída.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={travado}
              onClick={() => setForm({ ...form, tipo: "in" })}
              className={`h-10 rounded-md text-sm font-medium border transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                form.tipo === "in" ? "bg-success/10 border-success text-success" : "border-border text-muted-foreground hover:bg-secondary"
              }`}
            >
              <ArrowDownLeft className="h-4 w-4" />Entrada
            </button>
            <button
              type="button"
              disabled={travado}
              onClick={() => setForm({ ...form, tipo: "out" })}
              className={`h-10 rounded-md text-sm font-medium border transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                form.tipo === "out" ? "bg-destructive/10 border-destructive text-destructive" : "border-border text-muted-foreground hover:bg-secondary"
              }`}
            >
              <ArrowUpRight className="h-4 w-4" />Saída
            </button>
          </div>
          {ativas.length >= 2 && (
            <div className="col-span-2">
              <Label className="text-xs">Conta</Label>
              <Select value={form.contaId || undefined} onValueChange={(v) => setForm({ ...form, contaId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a conta" />
                </SelectTrigger>
                <SelectContent>
                  {ativas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="col-span-2">
            <Label className="text-xs">Descrição (extrato)</Label>
            <Input
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Ex: PIX RECEBIDO CLIENTE X"
              autoFocus
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Descrição amigável (opcional)</Label>
            <Input
              value={form.descricao_ia}
              onChange={(e) => setForm({ ...form, descricao_ia: e.target.value })}
              placeholder="Ex: Cliente X — mensalidade Junho"
            />
          </div>
          <div>
            <Label className="text-xs">Categoria</Label>
            <Select value={form.categoria || undefined} onValueChange={(v) => setForm({ ...form, categoria: v })}>
              <SelectTrigger>
                <SelectValue placeholder={contas.length === 0 ? "Cadastre o plano de contas" : "Selecione..."} />
              </SelectTrigger>
              <SelectContent>
                {categoriaForaDoPlano && (
                  <SelectGroup>
                    <SelectLabel>Atual</SelectLabel>
                    <SelectItem value={form.categoria}>{form.categoria}</SelectItem>
                  </SelectGroup>
                )}
                {catGroups.map((g) => (
                  <SelectGroup key={g.label}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {g.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {contas.length === 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Sem categorias. <Link to="/financeiro/plano-de-contas" className="underline">Cadastrar no Plano de Contas</Link>
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1">Valor (R$) {travado && <Lock className="h-3 w-3 text-muted-foreground" />}</Label>
            <Input
              type="number" min={0} step="0.01" inputMode="decimal"
              disabled={travado}
              value={Number.isFinite(form.valor) ? form.valor : 0}
              onChange={(e) => { setForm({ ...form, valor: numFromInput(e.target.valueAsNumber) }); setDupAviso(null); }}
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Data</Label>
            <Input
              type="date"
              value={form.data}
              onChange={(e) => { setForm({ ...form, data: e.target.value }); setDupAviso(null); }}
            />
          </div>
        </div>

        {veioDoBanco && (
          <div className="flex items-start gap-2.5 rounded-md border border-border bg-secondary/40 px-3 py-2 text-[13px]">
            <Lock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-muted-foreground">
                Este lançamento veio do <strong className="text-foreground">extrato do banco</strong>. O valor e o tipo ficam travados para o app não deixar de bater com o banco.
              </p>
              {travado && (
                <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={() => setDestravado(true)}>
                  Editar mesmo assim
                </button>
              )}
            </div>
          </div>
        )}

        {dupAviso && (
          <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5 text-[13px]">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-warning-foreground mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">Já existe um lançamento parecido</p>
                <p className="text-muted-foreground mt-0.5">
                  Nesta conta, no dia {fmtBR(form.data)}, com {brl(form.valor)} ({form.tipo === "in" ? "entrada" : "saída"}):
                </p>
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {dupAviso.slice(0, 3).map((m) => <li key={m.id} className="truncate">{m.descricao || "(sem descrição)"}</li>)}
                </ul>
                <p className="text-muted-foreground mt-1">Pode ser duplicata. Confira antes de salvar.</p>
              </div>
            </div>
          </div>
        )}

        {err && (
          <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancelar</Button>
          {dupAviso ? (
            <Button onClick={() => handleSave(true)} disabled={save.isPending} className="bg-warning text-[#0D0C0C] hover:bg-warning/90">
              {save.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Salvar mesmo assim
            </Button>
          ) : (
            <Button onClick={() => handleSave()} disabled={save.isPending} className="bg-foreground text-background hover:bg-foreground/90">
              {save.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {mov ? "Salvar" : "Cadastrar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// Quantas linhas do extrato renderizar por vez (paginação client-side). O fetch
// continua trazendo tudo p/ o cálculo de saldo; isto só limita o DOM.
const PAGINA_EXTRATO = 100;

export function Movimentacoes() {
  const { data: movimentos = [], isLoading: movLoading } = useMovimentacoes();
  const delMov = useDeleteMovimentacao();
  const delBatch = useDeleteMovimentacoesBatch();
  const updateCat = useUpdateMovimentacoesCategoria();
  const { data: contas = [] } = usePlanoContas();
  const { data: contasBancarias = [] } = useContasBancarias();
  const { contaId } = useEmpresa();
  const ativasBanco = contasBancarias.filter((c) => c.ativo);
  const contaLabel = contaId
    ? contasBancarias.find((c) => c.id === contaId)?.nome ?? "conta"
    : ativasBanco.length <= 1
      ? ativasBanco[0]?.nome ?? "todas as contas"
      : "todas as contas";

  // CRUD de transações
  const [movDialogOpen, setMovDialogOpen] = useState(false);
  const [editingMov, setEditingMov] = useState<Movimentacao | null>(null);
  const [deleteMovTarget, setDeleteMovTarget] = useState<Movimentacao | null>(null);
  const openNewMov = () => { setEditingMov(null); setMovDialogOpen(true); };
  const openEditMov = (m: Movimentacao) => { setEditingMov(m); setMovDialogOpen(true); };
  const confirmDeleteMov = async () => {
    if (!deleteMovTarget) return;
    await delMov.mutateAsync(deleteMovTarget.id);
    setDeleteMovTarget(null);
  };

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIO);
  const [tab, setTab] = useState<string>("todas");
  // Paginação da tabela; reinicia ao mudar filtro ou aba.
  const [visiveis, setVisiveis] = useState(PAGINA_EXTRATO);
  useEffect(() => setVisiveis(PAGINA_EXTRATO), [filtros, tab]);

  // ─── Seleção em lote (extrato) ──────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recatOpen, setRecatOpen] = useState(false);
  const [recatValue, setRecatValue] = useState<string>("");
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const setManySel = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (on) ids.forEach((i) => n.add(i)); else ids.forEach((i) => n.delete(i));
      return n;
    });
  const clearSel = () => setSelected(new Set());

  // Opções de categoria do plano de contas (caminho "Pai / Filho"), agrupadas.
  const catGroups = useMemo(() => {
    const roots = contas.filter((c) => !c.parentId);
    return roots.map((root) => ({
      label: root.nome,
      options: [
        { value: root.nome, label: root.nome },
        ...contas
          .filter((c) => c.parentId === root.id)
          .map((c) => ({ value: `${root.nome} / ${c.nome}`, label: c.nome })),
      ],
    }));
  }, [contas]);

  const confirmBatchDelete = async () => {
    try {
      await delBatch.mutateAsync([...selected]);
      clearSel();
      setBatchDeleteOpen(false);
    } catch { /* erro exibido no diálogo via delBatch.isError; mantém aberto */ }
  };
  const confirmRecat = async () => {
    if (!recatValue) return;
    try {
      await updateCat.mutateAsync({ ids: [...selected], categoria: recatValue });
      clearSel();
      setRecatValue("");
      setRecatOpen(false);
    } catch { /* erro exibido no diálogo via updateCat.isError; mantém aberto */ }
  };


  // Filtros (período, categorias, valor, busca) — lógica em lib/filtros-movimentacoes.
  const movFiltered = useMemo(() => aplicaFiltros(movimentos, filtros), [movimentos, filtros]);

  // Contagem visível na aba ativa (contador "N de M" da barra de filtros).
  const visiveisAba = useMemo(
    () => movFiltered.filter((m) => tab === "todas" || m.tipo === tab).length,
    [movFiltered, tab]
  );

  // Exporta exatamente o que está na tela (filtros + aba ativa).
  const linhasExport = () =>
    movFiltered
      .filter((m) => tab === "todas" || m.tipo === tab)
      .map((m) => [fmtBR(m.dataISO), m.desc, m.ia, m.cat || "—", m.tipo === "in" ? "Entrada" : "Saída", m.valor]);
  const handleExport = () => {
    exportToXlsx({
      filename: "movimentacoes",
      sheets: [{ name: "Extrato", columns: ["Data", "Descrição", "Descrição IA", "Categoria", "Tipo", "Valor"], rows: linhasExport() }],
    });
  };
  // PDF da lista (antes só existia no Fluxo de Caixa, sem filtros). Mesmas linhas do Excel.
  const { empresaId, empresas } = useEmpresa();
  const handlePdf = () => {
    exportToPdf({
      title: "Movimentações",
      company: empresas.find((e) => e.id === empresaId)?.nome,
      subtitle: `${contaLabel} · ${visiveisAba} lançamento(s) conforme os filtros da tela`,
      orientation: "landscape",
      columns: ["Data", "Descrição", "Descrição IA", "Categoria", "Tipo", "Valor"],
      rows: linhasExport().map((r) => [...r.slice(0, 5), brl(Number(r[5]))]),
      filename: "movimentacoes.pdf",
    });
  };

  return (
    <AppShell
      title="Movimentações financeiras"
      subtitle={`Extrato bancário de ${contaLabel}`}
      actions={
        <>
          <Button variant="outline" className="h-9" onClick={handleExport} disabled={movFiltered.length === 0}>
            <Download className="h-4 w-4 mr-1.5" />Excel
          </Button>
          <Button variant="outline" className="h-9" onClick={handlePdf} disabled={movFiltered.length === 0}>
            <FileDown className="h-4 w-4 mr-1.5" />PDF
          </Button>
          <Button asChild className="h-9 bg-foreground text-background hover:bg-foreground/90">
            <Link to="/financeiro/extratos" search={{ aba: "importar" }}><Upload className="h-4 w-4 mr-1.5" />Importar extrato</Link>
          </Button>
        </>
      }
    >

      {/* ═════════════ EXTRATO UNIFICADO ═════════════ */}
      <Card className="card-elevated border-border/70 overflow-hidden">
        <Tabs value={tab} onValueChange={(v) => { setTab(v); clearSel(); }}>
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <h3 className="font-display text-base font-semibold">Extrato bancário</h3>
                <p className="text-xs text-muted-foreground">Fonte de verdade: importação completa do extrato a cada ciclo</p>
              </div>
              <TabsList className="bg-secondary ml-4">
                <TabsTrigger value="todas" className="data-[state=active]:bg-background">Todas</TabsTrigger>
                <TabsTrigger value="in" className="data-[state=active]:bg-background">
                  <ArrowDownLeft className="h-3 w-3 mr-1 text-success" />Entradas
                </TabsTrigger>
                <TabsTrigger value="out" className="data-[state=active]:bg-background">
                  <ArrowUpRight className="h-3 w-3 mr-1" />Saídas
                </TabsTrigger>
              </TabsList>
              <Button onClick={openNewMov} className="h-9 ml-auto bg-foreground text-background hover:bg-foreground/90">
                <Plus className="h-4 w-4 mr-1.5" />Nova transação
              </Button>
            </div>
            <FiltrosMovimentacoes
              value={filtros}
              onChange={(f) => { setFiltros(f); clearSel(); }}
              planoContas={contas}
              movimentos={movimentos}
              visiveis={visiveisAba}
            />
          </div>

          {/* Barra de ações em lote — aparece quando há transações selecionadas */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border bg-primary/5">
              <span className="text-sm font-medium">{selected.size} selecionada{selected.size > 1 ? "s" : ""}</span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  className="h-9"
                  onClick={() => { setRecatValue(""); updateCat.reset(); setRecatOpen(true); }}
                  disabled={updateCat.isPending || delBatch.isPending}
                >
                  <Tags className="h-4 w-4 mr-1.5" />Recategorizar
                </Button>
                <Button
                  variant="outline"
                  className="h-9 text-destructive hover:text-destructive"
                  onClick={() => { delBatch.reset(); setBatchDeleteOpen(true); }}
                  disabled={updateCat.isPending || delBatch.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />Excluir
                </Button>
                <Button variant="ghost" className="h-9" onClick={clearSel}>
                  <X className="h-4 w-4 mr-1.5" />Limpar
                </Button>
              </div>
            </div>
          )}

          {(["todas", "in", "out"] as const).map((key) => {
            const tabRows = movFiltered.filter((m) => (key === "todas" ? true : m.tipo === key));
            const tabRowsVis = tabRows.slice(0, visiveis);
            const allSelected = tabRows.length > 0 && tabRows.every((m) => selected.has(m.id));
            return (
            <TabsContent key={key} value={key} className="m-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="font-medium pl-5 pr-2 py-3 w-0">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={(v) => setManySel(tabRows.map((m) => m.id), v === true)}
                          aria-label="Selecionar todas as visíveis"
                          disabled={tabRows.length === 0}
                        />
                      </th>
                      <th className="font-medium px-5 py-3">Data</th>
                      <th className="font-medium px-5 py-3">Descrição (extrato) / categorização IA</th>
                      <th className="font-medium px-5 py-3">Categoria</th>
                      <th className="font-medium px-5 py-3">Confiança</th>
                      <th className="font-medium px-5 py-3 text-right">Valor</th>
                      <th className="font-medium px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {movLoading && (
                      <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground">Carregando extrato...</td></tr>
                    )}
                    {!movLoading && tabRows.length === 0 && (
                      <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground">Nenhuma movimentação encontrada.</td></tr>
                    )}
                    {tabRowsVis.map((m) => (
                      <tr key={m.id} className={`border-b border-border/60 hover:bg-secondary/40 transition-colors group ${selected.has(m.id) ? "bg-primary/5" : ""}`}>
                        <td className="pl-5 pr-2 py-3.5 align-top">
                          <Checkbox
                            checked={selected.has(m.id)}
                            onCheckedChange={() => toggleSel(m.id)}
                            aria-label="Selecionar transação"
                          />
                        </td>
                        <td className="px-5 py-3.5 font-numeric text-muted-foreground tabular-nums align-top">{m.date}</td>
                        <td className="px-5 py-3.5 align-top">
                          <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-wide">{m.desc}</p>
                          <p className="mt-0.5 text-[13px] font-medium">{m.ia}</p>
                        </td>
                        <td className="px-5 py-3.5 align-top">
                          <Badge variant="outline" className="bg-secondary border-0 font-medium text-[11px]">{m.cat}</Badge>
                        </td>
                        <td className="px-5 py-3.5 align-top"><Confidence c={m.conf} /></td>
                        <td className={`px-5 py-3.5 align-top text-right font-numeric font-semibold tabular-nums ${m.tipo === "in" ? "text-success" : ""}`}>
                          {m.tipo === "in" ? "+" : "−"}{brl(m.valor)}
                        </td>
                        <td className="px-5 py-3.5 align-top">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button size="sm" variant="ghost" onClick={() => openEditMov(m)} className="h-7 text-xs">
                              <Pencil className="h-3.5 w-3.5 mr-1" />Ajustar
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => setDeleteMovTarget(m)}
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {tabRows.length > tabRowsVis.length && (
                <div className="flex items-center justify-center gap-3 py-4 text-sm">
                  <span className="text-muted-foreground">
                    Mostrando {tabRowsVis.length} de {tabRows.length}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setVisiveis((v) => v + PAGINA_EXTRATO)}>
                    Carregar mais
                  </Button>
                </div>
              )}
            </TabsContent>
            );
          })}
        </Tabs>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Toda importação substitui o extrato anterior — o sistema sempre opera sobre a versão completa mais recente para garantir consistência absoluta.
      </p>

      <MovimentacaoDialog open={movDialogOpen} onOpenChange={setMovDialogOpen} mov={editingMov} />

      {/* Recategorização em lote */}
      <Dialog open={recatOpen} onOpenChange={(v) => { if (!updateCat.isPending) setRecatOpen(v); }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Recategorizar {selected.size} transaç{selected.size > 1 ? "ões" : "ão"}</DialogTitle>
            <DialogDescription>
              Escolha a categoria do plano de contas que será aplicada a todas as transações selecionadas.
            </DialogDescription>
          </DialogHeader>
          {catGroups.length === 0 ? (
            <p className="text-[13px] text-muted-foreground py-2">
              Seu plano de contas está vazio. Cadastre categorias em{" "}
              <Link to="/financeiro/plano-de-contas" className="font-medium underline">Plano de Contas</Link> primeiro.
            </p>
          ) : (
            <div className="py-2">
              <Label className="text-xs">Nova categoria</Label>
              <Select value={recatValue} onValueChange={setRecatValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a categoria..." />
                </SelectTrigger>
                <SelectContent>
                  {catGroups.map((g) => (
                    <SelectGroup key={g.label}>
                      <SelectLabel>{g.label}</SelectLabel>
                      {g.options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {updateCat.isError && (
            <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {updateCat.error instanceof Error ? updateCat.error.message : "Erro ao recategorizar."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecatOpen(false)} disabled={updateCat.isPending}>Cancelar</Button>
            <Button
              onClick={confirmRecat}
              disabled={!recatValue || updateCat.isPending}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {updateCat.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exclusão em lote */}
      <AlertDialog open={batchDeleteOpen} onOpenChange={(v) => { if (!delBatch.isPending) setBatchDeleteOpen(v); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selected.size} transaç{selected.size > 1 ? "ões" : "ão"}?</AlertDialogTitle>
            <AlertDialogDescription>
              As {selected.size} transações selecionadas serão removidas permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {delBatch.isError && (
            <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {delBatch.error instanceof Error ? delBatch.error.message : "Erro ao excluir."}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delBatch.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmBatchDelete(); }}
              disabled={delBatch.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {delBatch.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Excluir {selected.size}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteMovTarget} onOpenChange={(v) => !v && setDeleteMovTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir transação?</AlertDialogTitle>
            <AlertDialogDescription>
              A transação <strong>{deleteMovTarget?.ia || deleteMovTarget?.desc}</strong> ({deleteMovTarget && brl(deleteMovTarget.valor)}) será removida permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delMov.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDeleteMov(); }}
              disabled={delMov.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {delMov.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
