import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Search, Sparkles, RefreshCw, ArrowRight, Wallet, Loader2, CalendarClock, Link2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { brl, numFromInput } from "@/lib/format";
import { hojeISO, fmtBR } from "@/lib/datas";
import { useEmpresa } from "@/lib/empresa";
import {
  useRegrasCategorizacao, useToggleRegraCategorizacao, useSaveRegraCategorizacao,
  useDeleteRegraCategorizacao, usePlanoContas,
  useContasBancarias, useSaveContaBancaria, useDeleteContaBancaria,
  useFeriados, useAddFeriado, useDeleteFeriado, useReajustarDiaUtil,
  useInterStatus, useSalvarInter, useToggleInter, useRemoverInter,
  type RegraCategorizacao, type ContaBancaria, type InterStatus,
} from "@/lib/queries";

const emptyContaForm = { nome: "", banco: "", saldoInicial: 0, saldoInicialData: "", ativo: true };

export function Ajustes() {
  const { data: regras = [] } = useRegrasCategorizacao();
  const toggleRegra = useToggleRegraCategorizacao();
  const saveRegra = useSaveRegraCategorizacao();
  const delRegra = useDeleteRegraCategorizacao();

  const [busca, setBusca] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RegraCategorizacao | null>(null);
  const [form, setForm] = useState<{ padrao: string; categoriaId: string; ativo: boolean }>({ padrao: "", categoriaId: "", ativo: true });
  const [formErr, setFormErr] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RegraCategorizacao | null>(null);

  // Categorias reais do plano de contas (raízes + contagem de subcategorias).
  const { data: contas = [] } = usePlanoContas();
  const categorias = useMemo(
    () =>
      contas
        .filter((c) => !c.parentId)
        .map((r) => ({
          nome: r.nome,
          cor: r.tipo === "receita" ? "bg-success" : "bg-foreground/60",
          count: contas.filter((c) => c.parentId === r.id).length,
        })),
    [contas]
  );

  // Resolve categoria_id -> "Pai / Filho" e monta o select de categoria por id.
  const byId = useMemo(() => new Map(contas.map((c) => [c.id, c])), [contas]);
  const caminhoPorId = (id: string): string => {
    const c = byId.get(id);
    if (!c) return "—";
    if (!c.parentId) return c.nome;
    const p = byId.get(c.parentId);
    return p ? `${p.nome} / ${c.nome}` : c.nome;
  };
  const catGroups = useMemo(() => {
    const roots = contas.filter((c) => !c.parentId);
    return roots.map((root) => ({
      label: root.nome,
      options: [
        { value: root.id, label: root.nome },
        ...contas.filter((c) => c.parentId === root.id).map((c) => ({ value: c.id, label: c.nome })),
      ],
    }));
  }, [contas]);

  const ativas = regras.filter((r) => r.ativo).length;
  const regrasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return regras;
    return regras.filter(
      (r) => r.padrao.toLowerCase().includes(q) || caminhoPorId(r.categoriaId).toLowerCase().includes(q)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regras, busca, byId]);

  const openNovaRegra = () => { setEditing(null); setForm({ padrao: "", categoriaId: "", ativo: true }); setFormErr(null); setEditorOpen(true); };
  const openEditarRegra = (r: RegraCategorizacao) => { setEditing(r); setForm({ padrao: r.padrao, categoriaId: r.categoriaId, ativo: r.ativo }); setFormErr(null); setEditorOpen(true); };
  const handleSaveRegra = async () => {
    if (!form.padrao.trim()) { setFormErr("Informe o padrão (palavra-chave)."); return; }
    if (!form.categoriaId) { setFormErr("Escolha uma categoria."); return; }
    setFormErr(null);
    try {
      await saveRegra.mutateAsync({ id: editing?.id, input: form });
      setEditorOpen(false);
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : "Erro ao salvar a regra.");
    }
  };
  const confirmDeleteRegra = async () => {
    if (!deleteTarget) return;
    await delRegra.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  };

  // Contas bancárias (cada uma com seu saldo inicial)
  const { data: contasBancarias = [] } = useContasBancarias();
  const saveConta = useSaveContaBancaria();
  const delConta = useDeleteContaBancaria();
  // Integração Banco Inter: status por conta (sem segredos)
  const { isMaster } = useEmpresa();
  const { data: interStatus = [] } = useInterStatus();
  const interByConta = useMemo(() => new Map(interStatus.map((s) => [s.contaId, s])), [interStatus]);
  const [contaOpen, setContaOpen] = useState(false);
  const [contaEditing, setContaEditing] = useState<ContaBancaria | null>(null);
  const [contaForm, setContaForm] = useState(emptyContaForm);
  const [contaErr, setContaErr] = useState<string | null>(null);
  const [contaDelete, setContaDelete] = useState<ContaBancaria | null>(null);

  const openNovaConta = () => {
    setContaEditing(null);
    setContaForm({ ...emptyContaForm, saldoInicialData: hojeISO() });
    setContaErr(null);
    setContaOpen(true);
  };
  const openEditConta = (c: ContaBancaria) => {
    setContaEditing(c);
    setContaForm({
      nome: c.nome,
      banco: c.banco,
      saldoInicial: c.saldoInicial,
      saldoInicialData: c.saldoInicialData === "1970-01-01" ? hojeISO() : c.saldoInicialData,
      ativo: c.ativo,
    });
    setContaErr(null);
    setContaOpen(true);
  };
  const handleSaveConta = async () => {
    if (!contaForm.nome.trim()) { setContaErr("Informe o nome da conta."); return; }
    if (!contaForm.saldoInicialData) { setContaErr("Informe a data do saldo."); return; }
    setContaErr(null);
    try {
      await saveConta.mutateAsync({
        id: contaEditing?.id,
        input: {
          nome: contaForm.nome,
          banco: contaForm.banco,
          saldoInicial: contaForm.saldoInicial,
          saldoInicialData: contaForm.saldoInicialData,
          ativo: contaForm.ativo,
          // preserva o fingerprint detectado do OFX ao editar
          bankId: contaEditing?.bankId ?? null,
          acctId: contaEditing?.acctId ?? null,
          acctType: contaEditing?.acctType ?? null,
        },
      });
      setContaOpen(false);
    } catch (e) {
      setContaErr(e instanceof Error ? e.message : "Erro ao salvar a conta.");
    }
  };
  const confirmDeleteConta = async () => {
    if (!contaDelete) return;
    await delConta.mutateAsync(contaDelete.id);
    setContaDelete(null);
  };

  // Feriados da empresa + reajuste de dia útil
  const { data: feriados = [] } = useFeriados();
  const addFeriado = useAddFeriado();
  const delFeriado = useDeleteFeriado();
  const reajustar = useReajustarDiaUtil();
  const [feriadoForm, setFeriadoForm] = useState({ data: "", nome: "" });
  const [feriadoErr, setFeriadoErr] = useState<string | null>(null);
  const [reajusteMsg, setReajusteMsg] = useState<string | null>(null);

  const handleAddFeriado = async () => {
    if (!feriadoForm.data) { setFeriadoErr("Escolha a data do feriado."); return; }
    setFeriadoErr(null);
    try {
      await addFeriado.mutateAsync({ data: feriadoForm.data, nome: feriadoForm.nome });
      setFeriadoForm({ data: "", nome: "" });
    } catch (e) {
      setFeriadoErr(e instanceof Error ? e.message : "Erro ao adicionar o feriado.");
    }
  };
  const handleReajustar = async () => {
    setReajusteMsg(null);
    try {
      const n = await reajustar.mutateAsync();
      setReajusteMsg(n > 0 ? `${n} lançamento(s) ajustado(s) para dia útil.` : "Nada a ajustar — tudo já em dia útil.");
    } catch (e) {
      setReajusteMsg(e instanceof Error ? e.message : "Erro ao reajustar.");
    }
  };

  return (
    <AppShell
      title="Ajustes"
      subtitle="Contas bancárias, categorias, regras automáticas da IA e processamento de extratos"
    >
      {/* Contas bancárias */}
      <Card className="p-6 card-elevated border-border/70 mb-6">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold">Contas bancárias</h3>
              <p className="text-sm text-muted-foreground">
                Cada conta tem seu próprio saldo inicial. O painel soma as movimentações a partir da data informada.
              </p>
            </div>
          </div>
          <Button onClick={openNovaConta} size="sm" className="h-9 bg-foreground text-background hover:bg-foreground/90 shrink-0">
            <Plus className="h-4 w-4 mr-1.5" />Nova conta
          </Button>
        </div>
        <div className="divide-y divide-border">
          {contasBancarias.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Nenhuma conta cadastrada.</p>
          ) : (
            contasBancarias.map((c) => (
              <div key={c.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate">{c.nome}</p>
                    {c.banco && <span className="text-xs text-muted-foreground">· {c.banco}</span>}
                    {!c.ativo && <Badge variant="outline" className="text-muted-foreground">Inativa</Badge>}
                    {c.bankId && c.acctId && (
                      <span className="text-[11px] text-muted-foreground font-numeric tabular-nums">({c.bankId}/{c.acctId})</span>
                    )}
                    {(() => {
                      const s = interByConta.get(c.id);
                      if (!s) return null;
                      if (s.ultimoErro) {
                        return (
                          <Badge variant="outline" className="text-destructive border-destructive/40" title={s.ultimoErro}>
                            Inter · erro na sincronização
                          </Badge>
                        );
                      }
                      return (
                        <Badge variant="outline" className={s.ativo ? "text-primary border-primary/40" : "text-muted-foreground"}>
                          {s.ativo ? "Inter conectado" : "Inter pausado"}
                        </Badge>
                      );
                    })()}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Saldo inicial <span className="font-numeric tabular-nums text-foreground">{brl(c.saldoInicial)}</span>
                    {c.saldoInicialData && c.saldoInicialData !== "1970-01-01" ? ` · desde ${fmtBR(c.saldoInicialData)}` : ""}
                    {(() => {
                      const s = interByConta.get(c.id);
                      if (!s || s.ultimoSaldo == null) return null;
                      return (
                        <>
                          {" · "}Saldo no Inter <span className="font-numeric tabular-nums text-foreground">{brl(s.ultimoSaldo)}</span>
                          {s.ultimaSync ? ` (sync ${new Date(s.ultimaSync).toLocaleDateString("pt-BR")})` : ""}
                        </>
                      );
                    })()}
                  </p>
                </div>
                <button onClick={() => openEditConta(c)} title="Editar" className="h-8 w-8 grid place-items-center rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground">
                  <Pencil className="h-4 w-4" />
                </button>
                {c.ativo && (
                  <button onClick={() => setContaDelete(c)} title="Desativar" className="h-8 w-8 grid place-items-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
        {/* Categorias */}
        <Card className="p-6 card-elevated border-border/70">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-display text-lg font-semibold">Categorias</h3>
              <p className="text-sm text-muted-foreground">
                {categorias.length} {categorias.length === 1 ? "categoria" : "categorias"} no plano de contas
              </p>
            </div>
            <Button asChild size="sm" className="h-8 bg-foreground text-background hover:bg-foreground/90">
              <Link to="/financeiro/plano-de-contas"><Plus className="h-3.5 w-3.5 mr-1" />Gerenciar</Link>
            </Button>
          </div>
          {categorias.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma categoria. Cadastre no{" "}
              <Link to="/financeiro/plano-de-contas" className="underline">Plano de Contas</Link>.
            </p>
          ) : (
            <div className="space-y-1">
              {categorias.map((c) => (
                <div
                  key={c.nome}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/60 transition-colors"
                >
                  <span className={`h-2.5 w-2.5 rounded-sm ${c.cor}`} />
                  <span className="text-sm font-medium flex-1">{c.nome}</span>
                  <Badge variant="outline" className="text-[10px] border-0 bg-secondary text-muted-foreground">
                    {c.count} {c.count === 1 ? "subcategoria" : "subcategorias"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Regras de categorização */}
        <Card className="p-6 card-elevated border-border/70">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-lg font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Regras de categorização
              </h3>
              <p className="text-sm text-muted-foreground">{ativas} ativas · {regras.length} total</p>
            </div>
            <Button size="sm" className="h-8 bg-foreground text-background hover:bg-foreground/90 shrink-0" onClick={openNovaRegra}>
              <Plus className="h-3.5 w-3.5 mr-1" />Nova regra
            </Button>
          </div>

          {regras.length > 6 && (
            <div className="relative mb-3">
              <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por padrão ou categoria..." className="h-9 pl-8" />
            </div>
          )}

          {regras.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma regra ainda. Elas surgem quando você aprova importações na{" "}
              <Link to="/financeiro/extratos" search={{ aba: "revisar" }} className="underline">Revisão</Link>, ou clique em <strong>Nova regra</strong>.
            </p>
          ) : (
            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {regrasFiltradas.map((r) => (
                <div key={r.id} className="p-3 rounded-xl border border-border bg-background">
                  <div className="flex items-center gap-3">
                    <Switch checked={r.ativo} onCheckedChange={(v) => toggleRegra.mutate({ id: r.id, ativo: v })} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        <span className="font-mono text-xs bg-secondary/60 px-2 py-0.5 rounded">{r.padrao}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="font-medium text-xs">{caminhoPorId(r.categoriaId)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className={`text-[10px] border-0 ${r.origem === "manual" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
                          {r.origem === "manual" ? "manual" : "aprendida"}
                        </Badge>
                        {r.acertos > 0 && <span className="text-[10px] text-muted-foreground">{r.acertos} {r.acertos === 1 ? "acerto" : "acertos"}</span>}
                      </div>
                    </div>
                    <button onClick={() => openEditarRegra(r)} className="h-7 w-7 grid place-items-center rounded-md hover:bg-secondary shrink-0" title="Editar">
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => setDeleteTarget(r)} className="h-7 w-7 grid place-items-center rounded-md hover:bg-secondary text-destructive shrink-0" title="Excluir">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {regrasFiltradas.length === 0 && (
                <p className="text-xs text-muted-foreground py-4 text-center">Nenhuma regra encontrada para “{busca}”.</p>
              )}
            </div>
          )}

          <div className="mt-4 p-4 rounded-xl bg-gradient-to-br from-primary/[0.06] to-transparent border border-primary/10">
            <p className="text-xs text-foreground/80 leading-relaxed">
              <Sparkles className="h-3.5 w-3.5 text-primary inline mr-1" />
              O sistema aprende uma regra a cada aprovação na Revisão (palavra-chave do estabelecimento → categoria).
              Aqui você edita, desativa ou exclui — isso afeta só as sugestões futuras.
            </p>
          </div>
        </Card>
      </div>

      {/* Feriados e dia útil */}
      <Card className="mt-6 p-6 card-elevated border-border/70">
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
              <CalendarClock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold">Feriados e dia útil</h3>
              <p className="text-sm text-muted-foreground max-w-xl">
                Vencimentos de recorrentes e cobranças que caem em sábado, domingo ou feriado
                são antecipados automaticamente para o dia útil anterior. Os feriados nacionais
                já são considerados — cadastre aqui os municipais/estaduais da empresa.
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Button onClick={handleReajustar} variant="outline" size="sm" className="h-9" disabled={reajustar.isPending}>
              {reajustar.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
              Reajustar existentes
            </Button>
            {reajusteMsg && <span className="text-[11px] text-muted-foreground text-right max-w-[220px]">{reajusteMsg}</span>}
          </div>
        </div>

        {/* Adicionar feriado */}
        <div className="flex items-end gap-2 flex-wrap mb-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Data</Label>
            <Input
              type="date" className="h-9 w-40" value={feriadoForm.data}
              onChange={(e) => setFeriadoForm({ ...feriadoForm, data: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5 flex-1 min-w-[180px]">
            <Label className="text-xs">Nome (opcional)</Label>
            <Input
              className="h-9" placeholder="Ex: Aniversário da cidade" value={feriadoForm.nome}
              onChange={(e) => setFeriadoForm({ ...feriadoForm, nome: e.target.value })}
            />
          </div>
          <Button onClick={handleAddFeriado} size="sm" className="h-9 bg-foreground text-background hover:bg-foreground/90" disabled={addFeriado.isPending}>
            {addFeriado.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
            Adicionar
          </Button>
        </div>
        {feriadoErr && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2 mb-3">{feriadoErr}</p>}

        <div className="divide-y divide-border">
          {feriados.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">
              Nenhum feriado da empresa cadastrado — os nacionais já valem automaticamente.
            </p>
          ) : (
            feriados.map((f) => (
              <div key={f.id} className="flex items-center gap-3 py-2.5">
                <span className="font-numeric tabular-nums text-sm w-24 shrink-0">{fmtBR(f.data)}</span>
                <span className="text-sm flex-1 min-w-0 truncate">
                  {f.nome || <span className="text-muted-foreground">—</span>}
                </span>
                <button
                  onClick={() => delFeriado.mutate(f.id)} title="Remover"
                  className="h-8 w-8 grid place-items-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Depois de cadastrar um feriado, clique em <strong>Reajustar existentes</strong> para
          aplicar aos previstos e cobranças futuros já gerados.
        </p>
      </Card>

      {/* Editor de regra (criar/editar) */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar regra" : "Nova regra"}</DialogTitle>
            <DialogDescription>
              Quando a descrição da transação <strong>contém</strong> o padrão, o sistema sugere a categoria escolhida.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">Padrão (palavra-chave do estabelecimento)</Label>
              <Input value={form.padrao} onChange={(e) => setForm({ ...form, padrao: e.target.value })} placeholder="Ex: UBER" className="font-mono" autoFocus />
              <p className="text-[11px] text-muted-foreground">Normalizado ao salvar (maiúsculas, sem acento, sem dígitos). O casamento ignora maiúsculas/minúsculas.</p>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Categoria</Label>
              <Select value={form.categoriaId || undefined} onValueChange={(v) => setForm({ ...form, categoriaId: v })}>
                <SelectTrigger><SelectValue placeholder="Selecionar categoria..." /></SelectTrigger>
                <SelectContent>
                  {catGroups.map((g) => (
                    <SelectGroup key={g.label}>
                      <SelectLabel>{g.label}</SelectLabel>
                      {g.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label className="text-xs">Ativa</Label>
              <Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} />
            </div>
            {editing && editing.origem === "aprendida" && (
              <p className="text-[11px] text-muted-foreground">Regra aprendida do histórico · {editing.acertos} {editing.acertos === 1 ? "acerto" : "acertos"}.</p>
            )}
            {formErr && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{formErr}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={saveRegra.isPending}>Cancelar</Button>
            <Button onClick={handleSaveRegra} disabled={saveRegra.isPending} className="bg-foreground text-background hover:bg-foreground/90">
              {saveRegra.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excluir regra */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir regra?</AlertDialogTitle>
            <AlertDialogDescription>
              A regra <strong>{deleteTarget?.padrao}</strong> → <strong>{deleteTarget && caminhoPorId(deleteTarget.categoriaId)}</strong> será removida.
              Isso afeta só as sugestões futuras — transações já confirmadas não mudam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delRegra.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDeleteRegra(); }} disabled={delRegra.isPending} className="bg-destructive hover:bg-destructive/90">
              {delRegra.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Criar/editar conta bancária */}
      <Dialog open={contaOpen} onOpenChange={setContaOpen}>
        <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{contaEditing ? "Editar conta" : "Nova conta"}</DialogTitle>
            <DialogDescription>
              Cada conta bancária tem seu próprio saldo inicial e histórico de movimentações.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">Nome / apelido</Label>
              <Input value={contaForm.nome} onChange={(e) => setContaForm({ ...contaForm, nome: e.target.value })} placeholder="Ex: Itaú PJ" autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Banco (opcional)</Label>
              <Input value={contaForm.banco} onChange={(e) => setContaForm({ ...contaForm, banco: e.target.value })} placeholder="Ex: Itaú Unibanco" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Saldo inicial (R$)</Label>
                <Input
                  type="number" step="0.01" inputMode="decimal"
                  value={Number.isFinite(contaForm.saldoInicial) ? contaForm.saldoInicial : 0}
                  onChange={(e) => setContaForm({ ...contaForm, saldoInicial: numFromInput(e.target.valueAsNumber) })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Data do saldo</Label>
                <Input type="date" value={contaForm.saldoInicialData} onChange={(e) => setContaForm({ ...contaForm, saldoInicialData: e.target.value })} />
              </div>
            </div>
            {contaEditing?.bankId && contaEditing?.acctId && (
              <p className="text-[11px] text-muted-foreground">
                Detectada do OFX · banco {contaEditing.bankId} · conta {contaEditing.acctId}
                {contaEditing.acctType ? ` · ${contaEditing.acctType}` : ""}
              </p>
            )}
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <Label className="text-xs">Ativa</Label>
                <p className="text-[11px] text-muted-foreground">Contas inativas somem do seletor, mas seguem no consolidado.</p>
              </div>
              <Switch checked={contaForm.ativo} onCheckedChange={(v) => setContaForm({ ...contaForm, ativo: v })} />
            </div>
            {isMaster && contaEditing && (
              <IntegracaoInterSection conta={contaEditing} status={interByConta.get(contaEditing.id) ?? null} />
            )}
            {contaErr && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{contaErr}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContaOpen(false)} disabled={saveConta.isPending}>Cancelar</Button>
            <Button onClick={handleSaveConta} disabled={saveConta.isPending} className="bg-foreground text-background hover:bg-foreground/90">
              {saveConta.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{contaEditing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Desativar conta */}
      <AlertDialog open={!!contaDelete} onOpenChange={(v) => !v && setContaDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar conta?</AlertDialogTitle>
            <AlertDialogDescription>
              A conta <strong>{contaDelete?.nome}</strong> sairá do seletor e de novos lançamentos. O histórico é preservado e continua somando no consolidado. Você pode reativá-la depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delConta.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDeleteConta(); }} disabled={delConta.isPending} className="bg-destructive hover:bg-destructive/90">
              {delConta.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

// ─── Integração Banco Inter (só master; dentro do dialog da conta) ──
// Grava credenciais via RPC só-master. Os segredos nunca voltam do banco:
// o formulário abre sempre vazio; o status mostra apenas o client_id mascarado.
const emptyInterForm = { clientId: "", clientSecret: "", certPem: "", keyPem: "", contaCorrente: "" };

function IntegracaoInterSection({ conta, status }: { conta: ContaBancaria; status: InterStatus | null }) {
  const salvar = useSalvarInter();
  const toggle = useToggleInter();
  const remover = useRemoverInter();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState(emptyInterForm);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const handleSalvar = async () => {
    if (!form.clientId.trim() || !form.clientSecret.trim() || !form.certPem.trim() || !form.keyPem.trim()) {
      setErr("Preencha client_id, client_secret, certificado e chave privada.");
      return;
    }
    setErr(null);
    setMsg(null);
    try {
      await salvar.mutateAsync({
        contaId: conta.id,
        clientId: form.clientId,
        clientSecret: form.clientSecret,
        certPem: form.certPem,
        keyPem: form.keyPem,
        contaCorrente: form.contaCorrente.trim() || undefined,
      });
      setForm(emptyInterForm);
      setAberto(false);
      setMsg("Credenciais salvas. Use “Buscar extrato” na tela Importar para testar.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar a integração.");
    }
  };

  return (
    <div className="rounded-md border border-border px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Link2 className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <Label className="text-xs">Integração Banco Inter</Label>
            <p className="text-[11px] text-muted-foreground truncate">
              {status
                ? `Conectada (${status.clientIdMask ?? "credenciais salvas"})${status.ultimaSync ? ` · última sync ${new Date(status.ultimaSync).toLocaleString("pt-BR")}` : " · nunca sincronizada"}`
                : "Busca saldo e extrato direto da API (sem upload de arquivo)."}
            </p>
          </div>
        </div>
        {status && (
          <Switch
            checked={status.ativo}
            disabled={toggle.isPending}
            onCheckedChange={(v) => toggle.mutate({ contaId: conta.id, ativo: v })}
            title={status.ativo ? "Pausar sincronização" : "Reativar sincronização"}
          />
        )}
      </div>

      {status?.ultimoErro && (
        <p className="text-[12px] text-destructive bg-destructive/10 rounded-md px-2.5 py-1.5">
          Última sync falhou: {status.ultimoErro}
        </p>
      )}

      {!aberto ? (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => { setAberto(true); setErr(null); setMsg(null); }}>
            {status ? "Trocar credenciais" : "Conectar ao Inter"}
          </Button>
          {status && (
            <Button
              type="button" variant="ghost" size="sm"
              className="h-8 text-destructive hover:text-destructive"
              disabled={remover.isPending}
              onClick={() => remover.mutate(conta.id)}
            >
              {remover.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Remover
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-2">
          <p className="text-[11px] text-muted-foreground">
            Gere no Internet Banking PJ do Inter (Aplicações → escopo de extrato/saldo) e cole aqui.
            Os dados ficam guardados no servidor e não podem ser lidos de volta pelo navegador.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">client_id</Label>
              <Input value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">client_secret</Label>
              <Input type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Certificado (.crt — conteúdo PEM)</Label>
            <Textarea
              rows={3} className="font-mono text-[11px]"
              placeholder="-----BEGIN CERTIFICATE-----&#10;..."
              value={form.certPem} onChange={(e) => setForm({ ...form, certPem: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Chave privada (.key — conteúdo PEM)</Label>
            <Textarea
              rows={3} className="font-mono text-[11px]"
              placeholder="-----BEGIN PRIVATE KEY-----&#10;..."
              value={form.keyPem} onChange={(e) => setForm({ ...form, keyPem: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Conta corrente (opcional — só se a aplicação tiver 2+ contas)</Label>
            <Input value={form.contaCorrente} onChange={(e) => setForm({ ...form, contaCorrente: e.target.value })} placeholder="Ex.: 12345678" />
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" className="h-8 bg-foreground text-background hover:bg-foreground/90" disabled={salvar.isPending} onClick={handleSalvar}>
              {salvar.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Salvar integração
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8" disabled={salvar.isPending} onClick={() => { setAberto(false); setErr(null); }}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {err && <p className="text-[12px] font-medium text-destructive bg-destructive/10 rounded-md px-2.5 py-1.5">{err}</p>}
      {msg && <p className="text-[12px] text-muted-foreground">{msg}</p>}
    </div>
  );
}
