import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Pencil, ChevronRight, ChevronDown, FolderTree, Loader2, Copy } from "lucide-react";
import { usePlanoContas, useSaveConta, useDeleteConta, useCopiarPlanoContas } from "@/lib/queries";
import { useEmpresa } from "@/lib/empresa";
import { clampDia } from "@/lib/format";
import type { CompetenciaModo } from "@/lib/datas";

type Tipo = "receita" | "despesa";
type Categoria = {
  id: string;
  nome: string;
  tipo: Tipo;
  codigo: string;
  parentId: string | null;
  ocultoRelatorios: boolean;
  investimentoAnuncios: boolean;
  compensar: boolean;
  competenciaModo: CompetenciaModo;
  competenciaDiaCorte: number | null;
};

// Rótulos amigáveis dos modos de competência (com exemplo concreto).
const MODO_COMPETENCIA: { valor: CompetenciaModo; label: string }[] = [
  { valor: "pagamento", label: "Mês do pagamento (padrão)" },
  { valor: "anterior", label: "Sempre o mês anterior (pago em agosto → conta em julho)" },
  { valor: "seguinte", label: "Sempre o mês seguinte (pago em agosto → conta em setembro)" },
  { valor: "corte_seguinte", label: "A partir do dia… → conta no mês seguinte" },
  { valor: "corte_anterior", label: "Até o dia… → conta no mês anterior" },
];
const modoLabelCurto: Record<CompetenciaModo, string> = {
  pagamento: "",
  anterior: "mês anterior",
  seguinte: "mês seguinte",
  corte_seguinte: "corte → seguinte",
  corte_anterior: "corte → anterior",
};

export function PlanoContas() {
  const { data: cats = [], isLoading } = usePlanoContas();
  const saveConta = useSaveConta();
  const deleteConta = useDeleteConta();
  const { empresas, empresaId, isMaster } = useEmpresa();
  const copiar = useCopiarPlanoContas();
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyOrigem, setCopyOrigem] = useState("");
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const outrasEmpresas = empresas.filter((e) => e.id !== empresaId);
  const empresaNome = empresas.find((e) => e.id === empresaId)?.nome ?? "";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Categoria | null>(null);
  const [form, setForm] = useState({ nome: "", tipo: "despesa" as Tipo, codigo: "", parentId: "__none__", ocultoRelatorios: false, investimentoAnuncios: false, compensar: false, competenciaModo: "pagamento" as CompetenciaModo, competenciaDiaCorte: 25 });

  // Ao carregar, expande as categorias raiz (uma vez).
  const initRef = useRef(false);
  useEffect(() => {
    if (!initRef.current && cats.length) {
      initRef.current = true;
      setExpanded(new Set(cats.filter((c) => !c.parentId).map((c) => c.id)));
    }
  }, [cats]);

  const tree = useMemo(() => {
    const roots = cats.filter((c) => !c.parentId);
    return roots.map((r) => ({ ...r, children: cats.filter((c) => c.parentId === r.id) }));
  }, [cats]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };

  const openNew = (parentId: string | null = null) => {
    setEditing(null);
    setForm({ nome: "", tipo: "despesa", codigo: "", parentId: parentId ?? "__none__", ocultoRelatorios: false, investimentoAnuncios: false, compensar: false, competenciaModo: "pagamento", competenciaDiaCorte: 25 });
    setOpen(true);
  };
  const openEdit = (c: Categoria) => {
    setEditing(c);
    setForm({ nome: c.nome, tipo: c.tipo, codigo: c.codigo, parentId: c.parentId ?? "__none__", ocultoRelatorios: c.ocultoRelatorios, investimentoAnuncios: c.investimentoAnuncios, compensar: c.compensar, competenciaModo: c.competenciaModo, competenciaDiaCorte: c.competenciaDiaCorte ?? 25 });
    setOpen(true);
  };
  const save = async () => {
    if (!form.nome.trim()) return;
    const parentId = form.parentId === "__none__" ? null : form.parentId;
    const usaCorte = form.competenciaModo.startsWith("corte");
    const { movsAtualizadas } = await saveConta.mutateAsync({
      id: editing?.id,
      input: {
        nome: form.nome.trim(), tipo: form.tipo, codigo: form.codigo, parentId,
        ocultoRelatorios: form.ocultoRelatorios,
        investimentoAnuncios: form.investimentoAnuncios,
        compensar: form.compensar,
        competenciaModo: form.competenciaModo,
        competenciaDiaCorte: usaCorte ? form.competenciaDiaCorte : null,
      },
    });
    // Renomear propaga o novo nome para os lançamentos antigos — avisa quantos
    // vieram junto, para dar confiança de que o histórico não se perdeu.
    if (movsAtualizadas > 0)
      toast.success(`${movsAtualizadas} lançamento(s) atualizados para o novo nome.`);
    setOpen(false);
  };
  const remove = async (id: string) => {
    if (cats.some((c) => c.parentId === id)) {
      toast.error("Remova as subcategorias primeiro.");
      return;
    }
    await deleteConta.mutateAsync(id);
  };

  const abrirCopiar = () => {
    setCopyOrigem("");
    setCopyMsg(null);
    copiar.reset();
    setCopyOpen(true);
  };
  const handleCopiar = async () => {
    if (!copyOrigem || !empresaId) return;
    setCopyMsg(null);
    const n = await copiar.mutateAsync({ origem: copyOrigem, destino: empresaId });
    setCopyMsg(`${n} categoria(s) copiada(s) para ${empresaNome}.`);
  };

  return (
    <AppShell
      title="Plano de Contas"
      subtitle="As categorias que organizam suas receitas e despesas"
      actions={
        <div className="flex items-center gap-2">
          {isMaster && outrasEmpresas.length > 0 && (
            <Button variant="outline" className="h-9" onClick={abrirCopiar}>
              <Copy className="h-4 w-4 mr-1.5" /> Copiar de outra empresa
            </Button>
          )}
          <Button className="h-9 bg-foreground text-background hover:bg-foreground/90" onClick={() => openNew(null)}>
            <Plus className="h-4 w-4 mr-1.5" /> Nova categoria
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {[
          { l: "Categorias", v: cats.length },
          { l: "Receitas", v: cats.filter((c) => c.tipo === "receita").length },
          { l: "Despesas", v: cats.filter((c) => c.tipo === "despesa").length },
        ].map((k) => (
          <Card key={k.l} className="p-5 card-elevated border-border/70">
            <p className="text-[13px] text-muted-foreground font-medium">{k.l}</p>
            <p className="mt-2 font-numeric text-[24px] font-semibold">{k.v}</p>
          </Card>
        ))}
      </div>

      <Card className="card-elevated border-border/70 overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-display text-base font-semibold">Categorias e subcategorias</h3>
        </div>
        {isLoading && (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando categorias...
          </div>
        )}
        {!isLoading && cats.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            Nenhuma categoria ainda. Crie a primeira em “Nova categoria” — ou copie o plano de outra empresa.
          </div>
        )}
        <ul className="divide-y divide-border">
          {tree.map((root) => (
            <li key={root.id}>
              <CatRow
                cat={root}
                isExpanded={expanded.has(root.id)}
                hasChildren={root.children.length > 0}
                onToggle={() => toggle(root.id)}
                onEdit={() => openEdit(root)}
                onRemove={() => remove(root.id)}
                onAddChild={() => openNew(root.id)}
              />
              {expanded.has(root.id) && root.children.length > 0 && (
                <ul className="bg-secondary/20">
                  {root.children.map((child) => (
                    <li key={child.id}>
                      <CatRow
                        cat={child}
                        depth={1}
                        isExpanded={false}
                        hasChildren={false}
                        onToggle={() => {}}
                        onEdit={() => openEdit(child)}
                        onRemove={() => remove(child.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar categoria" : "Nova categoria"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Nome</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Anúncios" />
              {editing && (
                <span className="text-[11px] text-muted-foreground">
                  Renomear é seguro: os lançamentos já gravados passam para o novo nome automaticamente.
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Tipo</Label>
                <Select value={form.tipo} onValueChange={(v: Tipo) => setForm({ ...form, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="receita">Receita (dinheiro que entra)</SelectItem>
                    <SelectItem value="despesa">Despesa (dinheiro que sai)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Código contábil</Label>
                <Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="3.1" />
                <span className="text-[11px] text-muted-foreground">Define a ordem nos relatórios.</span>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Faz parte de</Label>
              <Select value={form.parentId} onValueChange={(v) => setForm({ ...form, parentId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhuma (é uma categoria principal)</SelectItem>
                  {cats.filter((c) => !c.parentId).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 pt-1">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox checked={form.ocultoRelatorios} onCheckedChange={(v) => setForm({ ...form, ocultoRelatorios: v === true })} className="mt-0.5" />
                <span>
                  <span className="text-sm font-medium">Não entra em relatórios</span>
                  <span className="block text-[11px] text-muted-foreground">Para transferências, aportes e afins. Continua no saldo e no extrato, mas fica fora de receitas/despesas.</span>
                </span>
              </label>
              {/* Cada empresa chama de um jeito ("Investimento em Meta Ads",
                  "Leads"), então a marca fica aqui — o Dashboard não adivinha
                  pelo nome da categoria. */}
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox checked={form.investimentoAnuncios} onCheckedChange={(v) => setForm({ ...form, investimentoAnuncios: v === true })} className="mt-0.5" />
                <span>
                  <span className="text-sm font-medium">É investimento em anúncios</span>
                  <span className="block text-[11px] text-muted-foreground">Meta Ads e afins. O Dashboard soma essas despesas à parte, sem tirá-las das saídas.</span>
                </span>
              </label>
              {/* Aporte que entra e vira anúncio: contar os dois cheios infla os
                  dois lados. Marcando as duas categorias, o Dashboard mostra só
                  a diferença do período. */}
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox checked={form.compensar} onCheckedChange={(v) => setForm({ ...form, compensar: v === true })} className="mt-0.5" />
                <span>
                  <span className="text-sm font-medium">Entra compensada no Dashboard</span>
                  <span className="block text-[11px] text-muted-foreground">
                    O que entra e o que sai nas categorias marcadas se anula: o Dashboard mostra só o líquido do período
                    (ex.: aporte recebido × investimento em anúncios). O detalhamento e o extrato seguem inteiros.
                  </span>
                </span>
              </label>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Mês nos relatórios (competência)</Label>
              <div className="flex items-center gap-2">
                <Select value={form.competenciaModo} onValueChange={(v: CompetenciaModo) => setForm({ ...form, competenciaModo: v })}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODO_COMPETENCIA.map((m) => (
                      <SelectItem key={m.valor} value={m.valor}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.competenciaModo.startsWith("corte") && (
                  <Input
                    type="number" min={1} max={28} className="w-20" title="Dia de corte (1–28)"
                    value={form.competenciaDiaCorte}
                    onChange={(e) => setForm({ ...form, competenciaDiaCorte: clampDia(e.target.valueAsNumber) })}
                  />
                )}
              </div>
              <span className="text-[11px] text-muted-foreground">
                Só afeta os relatórios (competência). O saldo e o extrato usam sempre a data real do pagamento.
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saveConta.isPending}>Cancelar</Button>
            <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={save} disabled={saveConta.isPending}>
              {saveConta.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copiar plano de contas de outra empresa (só master) */}
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Copiar plano de contas</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              Copia as categorias de outra empresa <strong>para a empresa atual</strong>
              {empresaNome ? <> (<strong className="text-foreground">{empresaNome}</strong>)</> : null}.
              As categorias que já existirem não são duplicadas.
            </p>
            <div className="grid gap-1.5">
              <Label>Copiar de</Label>
              <Select value={copyOrigem || undefined} onValueChange={setCopyOrigem}>
                <SelectTrigger><SelectValue placeholder="Selecione a empresa de origem" /></SelectTrigger>
                <SelectContent>
                  {outrasEmpresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {copiar.isError && (
              <p className="text-xs text-destructive">
                {copiar.error instanceof Error ? copiar.error.message : "Erro ao copiar."}
              </p>
            )}
            {copyMsg && <p className="text-xs text-success">{copyMsg}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyOpen(false)} disabled={copiar.isPending}>Fechar</Button>
            <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={handleCopiar} disabled={!copyOrigem || copiar.isPending}>
              {copiar.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Copiar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function CatRow({
  cat, depth = 0, isExpanded, hasChildren, onToggle, onEdit, onRemove, onAddChild,
}: {
  cat: Categoria; depth?: number; isExpanded: boolean; hasChildren: boolean;
  onToggle: () => void; onEdit: () => void; onRemove: () => void; onAddChild?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-6 py-3 hover:bg-secondary/30" style={{ paddingLeft: 24 + depth * 28 }}>
      {hasChildren ? (
        <button onClick={onToggle} className="h-6 w-6 grid place-items-center rounded hover:bg-secondary">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      ) : (
        <span className="h-6 w-6" />
      )}
      <span className="text-xs font-mono text-muted-foreground w-12">{cat.codigo}</span>
      <span className="flex-1 text-sm font-medium">{cat.nome}</span>
      <Badge variant="outline" className={cat.tipo === "receita" ? "border-success/40 text-success" : "border-border text-foreground/80"}>
        {cat.tipo === "receita" ? "Receita" : "Despesa"}
      </Badge>
      {cat.ocultoRelatorios && (
        <Badge variant="outline" className="border-border text-muted-foreground text-[10px]">fora dos relatórios</Badge>
      )}
      {cat.investimentoAnuncios && (
        <Badge variant="outline" className="border-primary/30 text-primary text-[10px]">anúncios</Badge>
      )}
      {cat.compensar && (
        <Badge variant="outline" className="border-primary/30 text-primary text-[10px]">compensada</Badge>
      )}
      {cat.competenciaModo !== "pagamento" && (
        <Badge variant="outline" className="border-border text-muted-foreground text-[10px]">
          {modoLabelCurto[cat.competenciaModo]}
          {cat.competenciaModo.startsWith("corte") && cat.competenciaDiaCorte ? ` (dia ${cat.competenciaDiaCorte})` : ""}
        </Badge>
      )}
      <div className="flex items-center gap-1">
        {onAddChild && (
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onAddChild} title="Adicionar subcategoria">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
