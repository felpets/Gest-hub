import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  Plus, Trash2, Pencil, Loader2, AlertCircle, ArrowDownLeft, ArrowUpRight, Repeat, Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { brl, numFromInput } from "@/lib/format";
import { pad as pad2, fmtBR, nthDiaUtil, diaUtilAnterior, isoDiaDoMes } from "@/lib/datas";
import {
  useRecorrentes, useCreateRecorrente, useUpdateRecorrente, useDeleteRecorrente, useReconciliarRecorrentes,
  usePlanoContas, useTotaisRH, useCartoes, mesesEntre, fetchFeriadosEfetivos,
  type Recorrente, type RecorrenteInput, type Boleto, type ModoDia,
} from "@/lib/queries";
import { ModoFields, descreveVencimento, DIA_ULTIMO } from "@/components/ModoFields";
import { FONTES_RH, nomeFonteRH, valorDaFonte, type FonteRH } from "@/lib/fontes-rh";
import { BoletosEditor, BoletosCell } from "@/components/BoletosEditor";

import { useEmpresa } from "@/lib/empresa";

const NONE = "__none__";
const SEM_FONTE = "__fixo__";
const ymOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const fimDoMes = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad2(new Date(y, m, 0).getDate())}`;
};
const fmtMesAno = (iso: string) => {
  const [y, m] = iso.split("-");
  return `${m}/${y}`;
};

type FormState = {
  descricao: string;
  categoria: string;
  valor: number;
  fonteRH: FonteRH | null;
  cartaoId: string | null;
  tipo: "in" | "out";
  dia: number;
  modoDia: ModoDia;   // fixo | dia_util | quinzenal
  diaUtilN: number;   // N-ésimo dia útil (modo dia_util)
  dia2: number;       // 2º vencimento (modo quinzenal)
  semPrazo: boolean;
  inicioMes: string; // YYYY-MM
  fimMes: string; // YYYY-MM
  boletos: Boleto[];
  modoBoletos: "todos" | "carne";
};

const emptyForm = (): FormState => {
  const now = new Date();
  const fim = new Date(now.getFullYear(), now.getMonth() + 11, 1);
  return {
    descricao: "", categoria: "", valor: 0, fonteRH: null, cartaoId: null, tipo: "out", dia: 5, modoDia: "fixo", diaUtilN: 5, dia2: 20, semPrazo: false,
    inicioMes: ymOf(now), fimMes: ymOf(fim), boletos: [], modoBoletos: "todos",
  };
};

// Moldura: a tela inteira (endereço próprio, hoje só usado por link antigo) ou
// uma seção dentro de Contas do mês — que é onde as recorrências vivem agora.
function Moldura({
  embutida, actions, children,
}: {
  embutida: boolean; actions: React.ReactNode; children: React.ReactNode;
}) {
  if (!embutida) {
    return (
      <AppShell
        title="Pagamentos recorrentes"
        subtitle="Regras mensais que geram os pagamentos previstos automaticamente"
        actions={actions}
      >
        {children}
      </AppShell>
    );
  }
  return (
    <section className="mt-10 border-t border-border/60 pt-8" aria-labelledby="titulo-recorrencias">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="titulo-recorrencias" className="font-display text-lg font-semibold flex items-center gap-2">
            <Repeat className="h-4 w-4 text-muted-foreground" />Recorrências
          </h2>
          <p className="text-sm text-muted-foreground">
            As regras que geram sozinhas as contas da lista acima — aluguel, sistema, internet, contratos, assinaturas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {children}
    </section>
  );
}

export function Recorrentes({ embutida = false }: { embutida?: boolean } = {}) {
  const { data: recorrentes = [], isLoading, error } = useRecorrentes();
  const { data: contas = [] } = usePlanoContas();
  const create = useCreateRecorrente();
  const update = useUpdateRecorrente();
  const del = useDeleteRecorrente();
  const reconciliar = useReconciliarRecorrentes();

  // Reconcilia as recorrências ao abrir a tela (top-up das sem prazo + correção
  // de datas quando a regra mudou) — e de novo ao trocar de empresa. Só com a empresa ativa resolvida:
  // antes disso getEmpresaId() lançava "Nenhuma empresa ativa selecionada".
  const { empresaId } = useEmpresa();
  const extFor = useRef<string | null>(null);
  useEffect(() => {
    if (!empresaId || extFor.current === empresaId) return;
    extFor.current = empresaId;
    reconciliar.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  // Totais do RH do mês corrente: alimentam a prévia do valor no formulário e o
  // rótulo na lista. Um mês só basta — a reconciliação é que aplica mês a mês.
  const mesCorrente = ymOf(new Date());
  const rhQuery = useTotaisRH(`${mesCorrente}-01`, fimDoMes(mesCorrente));
  const { data: cartoes = [] } = useCartoes();
  const totaisMes = rhQuery.data?.itens?.[0];
  const rhDisponivel = rhQuery.data?.disponivel ?? false;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formErr, setFormErr] = useState<string | null>(null);
  // Quanto a fonte escolhida vale neste mês — só prévia; quem aplica mês a mês
  // é a reconciliação.
  const valorDoRH = form.fonteRH ? valorDaFonte(totaisMes, form.fonteRH) : null;
  const [deleteTarget, setDeleteTarget] = useState<Recorrente | null>(null);
  // Recorrência em edição (null = criando). O mesmo formulário serve aos dois.
  const [editing, setEditing] = useState<Recorrente | null>(null);
  // Feriados (nacionais + da empresa) deste mês e do próximo, para a prévia do
  // vencimento no formulário refletir o ajuste de dia útil de verdade.
  const [feriados, setFeriados] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!dialogOpen) return;
    const now = new Date();
    const de = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
    const fimProx = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    const ate = `${fimProx.getFullYear()}-${pad2(fimProx.getMonth() + 1)}-${pad2(fimProx.getDate())}`;
    fetchFeriadosEfetivos(de, ate).then(setFeriados).catch(() => setFeriados(new Set()));
  }, [dialogOpen]);

  // Datas que a regra atual gera NESTE mês (já com o ajuste de dia útil).
  const previaVencimentos = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth() + 1;
    if (form.modoDia === "dia_util") return [nthDiaUtil(y, m, form.diaUtilN || 1, feriados)];
    const d1 = diaUtilAnterior(isoDiaDoMes(y, m, form.dia), feriados);
    if (form.modoDia === "quinzenal") {
      const d2 = diaUtilAnterior(isoDiaDoMes(y, m, form.dia2), feriados);
      return [...new Set([d1, d2])];
    }
    return [d1];
  }, [form.modoDia, form.dia, form.dia2, form.diaUtilN, feriados]);

  const catGroups = useMemo(() => {
    const roots = contas.filter((c) => !c.parentId);
    return roots.map((root) => ({
      label: root.nome,
      options: [
        { value: root.nome, label: root.nome },
        ...contas.filter((c) => c.parentId === root.id).map((c) => ({ value: `${root.nome} / ${c.nome}`, label: c.nome })),
      ],
    }));
  }, [contas]);

  // Quantos pagamentos a recorrência vai gerar (prévia).
  const qtdPreview = useMemo(() => {
    if (!form.inicioMes || !form.fimMes) return 0;
    if (form.fimMes < form.inicioMes) return 0;
    return mesesEntre(`${form.inicioMes}-01`, `${form.fimMes}-01`).length;
  }, [form.inicioMes, form.fimMes]);

  const openNew = () => { setEditing(null); setForm(emptyForm()); setFormErr(null); setDialogOpen(true); };
  const openEdit = (r: Recorrente) => {
    setEditing(r);
    setForm({
      descricao: r.descricao,
      categoria: r.categoria,
      valor: r.valor,
      fonteRH: r.fonteRH ?? null,
      cartaoId: r.cartaoId ?? null,
      tipo: r.tipo,
      dia: r.dia,
      modoDia: r.modoDia,
      diaUtilN: r.diaUtilN ?? 5,
      dia2: r.dia2 ?? 20,
      semPrazo: !r.fim,
      inicioMes: r.inicio.slice(0, 7),
      fimMes: r.fim ? r.fim.slice(0, 7) : emptyForm().fimMes,
      boletos: r.boletos,
      modoBoletos: "todos", // o modo não fica gravado; 'todos' não mexe nos boletos por mês
    });
    setFormErr(null);
    setDialogOpen(true);
  };

  const handleCreate = async () => {
    if (!form.descricao.trim()) { setFormErr("Informe a descrição."); return; }
    // Com o valor vindo do RH, o campo é só a referência do mês atual — não faz
    // sentido exigir que alguém digite.
    if (!form.fonteRH && (!form.valor || form.valor <= 0)) { setFormErr("Informe um valor maior que zero."); return; }
    if (!form.inicioMes) { setFormErr("Informe o mês inicial."); return; }
    if (!form.semPrazo && !form.fimMes) { setFormErr("Informe o mês final (ou marque 'sem prazo')."); return; }
    if (!form.semPrazo && form.fimMes < form.inicioMes) { setFormErr("O mês final deve ser igual ou depois do inicial."); return; }
    setFormErr(null);
    const input: RecorrenteInput = {
      descricao: form.descricao.trim(),
      categoria: form.categoria,
      valor: form.valor,
      fonteRH: form.fonteRH,
      cartaoId: form.cartaoId,
      tipo: form.tipo,
      // 'dia' só vale em fixo/quinzenal; no modo dia útil fica 1 (ignorado).
      dia: form.modoDia === "dia_util" ? 1 : form.dia,
      modoDia: form.modoDia,
      diaUtilN: form.modoDia === "dia_util" ? form.diaUtilN : null,
      dia2: form.modoDia === "quinzenal" ? form.dia2 : null,
      inicio: `${form.inicioMes}-01`,
      fim: form.semPrazo ? null : `${form.fimMes}-01`,
      boletos: form.boletos.filter((b) => b.codigo.trim()),
      // 'carne' só faz sentido em período fixo; sem prazo é sempre 'todos'.
      modoBoletos: form.semPrazo ? "todos" : form.modoBoletos,
    };
    try {
      if (editing) {
        const r = await update.mutateAsync({ id: editing.id, input });
        toast.success(
          r.regerados > 0
            ? `Recorrência atualizada — ${r.regerados} pagamento(s) em aberto regerado(s) com as novas datas.`
            : `Recorrência atualizada — ${r.atualizados} pagamento(s) em aberto atualizado(s).`
        );
      } else {
        await create.mutateAsync(input);
      }
      setDialogOpen(false);
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : editing ? "Erro ao salvar a recorrência." : "Erro ao criar a recorrência.");
    }
  };
  const salvando = create.isPending || update.isPending;

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await del.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <Moldura
      embutida={embutida}
      actions={
        <>
          {!embutida && (
            <Button asChild variant="outline" className="h-9">
              <Link to="/financeiro/pagamentos" search={{ aba: "contas" }}><Receipt className="h-4 w-4 mr-1.5" />Contas do mês</Link>
            </Button>
          )}
          <Button onClick={openNew} variant={embutida ? "outline" : "default"}
            className={embutida ? "h-9" : "h-9 bg-foreground text-background hover:bg-foreground/90"}>
            <Plus className="h-4 w-4 mr-1.5" />Nova recorrência
          </Button>
        </>
      }
    >
      {isLoading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando recorrências...
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center gap-2 py-20 text-destructive">
          <AlertCircle className="h-5 w-5" /> Erro ao carregar. Confirme que rodou o SQL (06_recorrentes.sql).
        </div>
      )}
      {!isLoading && !error && recorrentes.length === 0 && (
        <div className={`text-center text-muted-foreground ${embutida ? "rounded-xl border border-dashed border-border/70 py-10 text-sm" : "py-20"}`}>
          Nenhuma recorrência. Clique em <strong>Nova recorrência</strong> para criar (ex.: mensalidade, aluguel, SaaS).
        </div>
      )}

      {!isLoading && !error && recorrentes.length > 0 && (
        <Card className="card-elevated border-border/70 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Descrição</th>
                  <th className="text-left px-5 py-3 font-medium">Categoria</th>
                  <th className="text-left px-5 py-3 font-medium">Vencimento</th>
                  <th className="text-left px-5 py-3 font-medium">Período</th>
                  <th className="text-left px-5 py-3 font-medium">Pagamentos</th>
                  <th className="text-left px-5 py-3 font-medium">Boletos / PIX</th>
                  <th className="text-right px-5 py-3 font-medium">Valor</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recorrentes.map((r) => {
                  const qtd = r.fim ? mesesEntre(r.inicio, r.fim).length : null;
                  return (
                    <tr key={r.id} className="hover:bg-secondary/30 group">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`h-7 w-7 rounded-md grid place-items-center ${r.tipo === "in" ? "bg-success/10 text-success" : "bg-secondary text-foreground"}`}>
                            {r.tipo === "in" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                          </div>
                          <span className="font-medium">{r.descricao}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        {r.categoria ? <Badge variant="outline" className="bg-secondary border-0 font-medium text-[11px]">{r.categoria}</Badge> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">{descreveVencimento(r)}</td>
                      <td className="px-5 py-3 font-numeric tabular-nums text-muted-foreground">{fmtMesAno(r.inicio)} — {r.fim ? fmtMesAno(r.fim) : "sem prazo"}</td>
                      <td className="px-5 py-3">
                        {qtd === null ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-primary"><Repeat className="h-3 w-3" />Contínuo</span>
                        ) : (
                          <Badge variant="outline" className="bg-secondary border-0 text-[11px]">{qtd} {qtd === 1 ? "mês" : "meses"}</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3"><BoletosCell boletos={r.boletos} /></td>
                      <td className={`px-5 py-3 text-right font-numeric font-semibold tabular-nums ${r.tipo === "in" ? "text-success" : ""}`}>
                        {r.tipo === "in" ? "+" : "−"}{brl(r.valor)}
                        {r.fonteRH && (
                          <div className="font-sans text-[10px] font-normal text-primary" title={`O valor de cada mês vem do RH: ${nomeFonteRH(r.fonteRH)}`}>
                            do RH · {nomeFonteRH(r.fonteRH)}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)} title="Editar valor, dia ou período"
                          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(r)}
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Dialog nova / editar recorrência */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!salvando) setDialogOpen(v); }}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar recorrência" : "Nova recorrência mensal"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "As mudanças valem para os pagamentos em aberto. Os já pagos ficam como estão (histórico)."
                : "Gera um pagamento previsto por mês, no dia escolhido, durante o período. Excluir a recorrência depois remove os pagamentos gerados."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setForm({ ...form, tipo: "in" })}
                className={`h-10 rounded-md text-sm font-medium border transition-colors flex items-center justify-center gap-2 ${form.tipo === "in" ? "bg-success/10 border-success text-success" : "border-border text-muted-foreground hover:bg-secondary"}`}>
                <ArrowDownLeft className="h-4 w-4" />Entrada
              </button>
              <button type="button" onClick={() => setForm({ ...form, tipo: "out" })}
                className={`h-10 rounded-md text-sm font-medium border transition-colors flex items-center justify-center gap-2 ${form.tipo === "out" ? "bg-destructive/10 border-destructive text-destructive" : "border-border text-muted-foreground hover:bg-secondary"}`}>
                <ArrowUpRight className="h-4 w-4" />Saída
              </button>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Descrição</Label>
              <Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Ex: Mensalidade LaPortec" autoFocus />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">De onde vem o valor</Label>
              <Select
                value={form.fonteRH ?? SEM_FONTE}
                onValueChange={(v) => {
                  const fonte = v === SEM_FONTE ? null : (v as FonteRH);
                  // Escolher uma fonte já traz o total deste mês para o campo —
                  // ele fica como referência e como valor de reserva se o RH
                  // não responder em algum mês.
                  const doRH = fonte ? valorDaFonte(totaisMes, fonte) : null;
                  setForm((f) => ({ ...f, fonteRH: fonte, valor: doRH ?? f.valor }));
                }}
                disabled={!rhDisponivel && !form.fonteRH}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_FONTE}>Valor fixo (digitado aqui)</SelectItem>
                  <SelectGroup>
                    <SelectLabel>Vem do RH, mês a mês</SelectLabel>
                    {FONTES_RH.map((f) => <SelectItem key={f.chave} value={f.chave}>{f.nome}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {form.fonteRH
                  ? `${FONTES_RH.find((f) => f.chave === form.fonteRH)?.desc} Cada conta usa o total do RH do MÊS DO VENCIMENTO e é atualizada sozinha enquanto estiver em aberto; conta já paga nunca muda.`
                  : rhDisponivel
                    ? "Folha, adiantamento, vale-transporte e vale-refeição podem puxar o total direto do RH."
                    : "Os totais do RH não estão disponíveis para este acesso."}
              </p>
            </div>
            <div>
              <Label className="text-xs">Valor (R$)</Label>
              <Input type="number" min={0} step="0.01" inputMode="decimal"
                disabled={!!form.fonteRH}
                value={Number.isFinite(form.valor) ? form.valor : 0}
                onChange={(e) => setForm({ ...form, valor: numFromInput(e.target.valueAsNumber) })} />
              {form.fonteRH && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {valorDoRH == null
                    ? "O RH não devolveu o total deste mês — o valor gravado continua valendo."
                    : <>Este mês: <strong className="text-foreground">{brl(valorDoRH)}</strong>{totaisMes ? ` · ${totaisMes.pessoas} pessoa(s)` : ""}</>}
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Vencimento</Label>
              <ModoFields compact
                modoDia={form.modoDia} dia={form.dia} diaUtilN={form.diaUtilN} dia2={form.dia2}
                onChange={(patch) => setForm({ ...form, ...patch })} />
            </div>
            <div className="col-span-2 rounded-md border border-border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
              {form.modoDia === "fixo" && form.dia >= DIA_ULTIMO && "Sempre no último dia do mês (31, 30 ou 28/29, conforme o mês). Se cair em fim de semana ou feriado, o vencimento volta para o último dia útil antes."}
              {form.modoDia === "fixo" && form.dia < DIA_ULTIMO && "Todo mês no dia informado; no mês que não tem esse dia, cai no último dia dele. Se cair em fim de semana ou feriado, o vencimento volta para o último dia útil antes."}
              {form.modoDia === "dia_util" && `No ${form.diaUtilN || 1}º dia útil do mês pela contagem trabalhista: sábado conta, domingo e feriado não (ex.: 5º dia útil = salário, VT, VR). Se a data cair num sábado, antecipa para a sexta.`}
              {form.modoDia === "quinzenal" && "Dois vencimentos por mês; cada um volta para o dia útil anterior quando cai em dia não útil."}
              <span className="text-foreground font-medium"> Neste mês: {previaVencimentos.map(fmtBR).join(" e ")}.</span>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Categoria (opcional)</Label>
              <Select value={form.categoria || NONE} onValueChange={(v) => setForm({ ...form, categoria: v === NONE ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— Sem categoria</SelectItem>
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
            {/* Cartão: é o que faz esta despesa aparecer em Pagamentos ›
                Cartões e ferramentas, com a parcela e o comprometido do mês. */}
            {cartoes.length > 0 && (
              <div className="col-span-2">
                <Label className="text-xs">Cai em algum cartão? (opcional)</Label>
                <Select
                  value={form.cartaoId ?? NONE}
                  onValueChange={(v) => setForm({ ...form, cartaoId: v === NONE ? null : v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— Não passa por cartão</SelectItem>
                    {cartoes.filter((c) => c.ativo || c.id === form.cartaoId).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}{c.final ? ` ···· ${c.final}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="col-span-2 flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <Label className="text-xs">Sem prazo (todo mês)</Label>
                <p className="text-[11px] text-muted-foreground">Continua gerando automaticamente — não precisa renovar.</p>
              </div>
              <Switch checked={form.semPrazo} onCheckedChange={(v) => setForm({ ...form, semPrazo: v })} />
            </div>
            <div>
              <Label className="text-xs">Mês inicial</Label>
              <Input type="month" value={form.inicioMes} onChange={(e) => setForm({ ...form, inicioMes: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Mês final</Label>
              <Input type="month" value={form.fimMes} disabled={form.semPrazo}
                onChange={(e) => setForm({ ...form, fimMes: e.target.value })} />
            </div>
            <div className="col-span-2 grid gap-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label className="text-xs">Boletos / PIX (opcional)</Label>
                {!form.semPrazo && (
                  <div className="flex items-center gap-1 text-[11px]">
                    <button type="button" onClick={() => setForm({ ...form, modoBoletos: "todos" })}
                      className={`px-2 py-1 rounded-md font-medium transition-colors ${form.modoBoletos === "todos" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary"}`}>
                      Mesmos todo mês
                    </button>
                    <button type="button" onClick={() => setForm({ ...form, modoBoletos: "carne" })}
                      className={`px-2 py-1 rounded-md font-medium transition-colors ${form.modoBoletos === "carne" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary"}`}>
                      Um por mês (carnê)
                    </button>
                  </div>
                )}
              </div>
              <BoletosEditor
                value={form.boletos}
                onChange={(boletos) => setForm({ ...form, boletos })}
                carne={!form.semPrazo && form.modoBoletos === "carne"}
              />
              <p className="text-[11px] text-muted-foreground">
                {!form.semPrazo && form.modoBoletos === "carne"
                  ? "Carnê: cada código vai para um mês, na ordem (1º código → 1º mês)."
                  : "Os códigos valem para todos os meses gerados (ex.: PIX fixo)."}
              </p>
            </div>
          </div>
          {form.semPrazo ? (
            <p className="text-[13px] text-muted-foreground flex items-center gap-1.5">
              <Repeat className="h-3.5 w-3.5 text-primary" />
              Recorrência contínua · gera todo mês automaticamente, sem precisar renovar
            </p>
          ) : qtdPreview > 0 ? (
            <p className="text-[13px] text-muted-foreground flex items-center gap-1.5">
              <Repeat className="h-3.5 w-3.5 text-primary" />
              Serão gerados <strong>{qtdPreview}</strong> pagamentos · total {brl(qtdPreview * Math.abs(form.valor || 0))}
            </p>
          ) : null}
          {formErr && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{formErr}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={salvando}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={salvando} className="bg-foreground text-background hover:bg-foreground/90">
              {salvando && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{editing ? "Salvar alterações" : "Criar recorrência"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excluir */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir recorrência?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.descricao}</strong> e <strong>todos os pagamentos previstos{deleteTarget?.fim ? ` (${mesesEntre(deleteTarget.inicio, deleteTarget.fim).length})` : ""}</strong> gerados por ela serão removidos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDelete(); }} disabled={del.isPending} className="bg-destructive hover:bg-destructive/90">
              {del.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Excluir tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Moldura>
  );
}
