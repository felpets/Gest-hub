import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Search, Loader2, AlertCircle, Pencil, Trash2, FileSpreadsheet, Info, Copy,
  CheckCircle2, ChevronLeft, ChevronRight, Lock, RotateCcw, History, ShieldAlert, Users, QrCode,
} from "lucide-react";
import { brl, nomeDoEmail, numFromInput } from "@/lib/format";
import { fmtBR, fmtDataHora, hojeISO, pad } from "@/lib/datas";
import { exportToXlsx } from "@/lib/export";
import { useEmpresa } from "@/lib/empresa";
import {
  detectarTipoChave, normalizarChavePix, formatarChavePix, erroChavePix, resumirChavePix,
  ehPixCopiaECola, lerPixCopiaECola, labelTipoChave, TIPOS_CHAVE, type TipoChavePix, type PixLido,
} from "@/lib/pix";
import { lerQrDaImagem } from "@/lib/qr-imagem";
import { useCampoChavePix, useFormularioPagamento } from "@/modulos/financeiro/pix-formulario";
import {
  usePagamentosDiarios, useSavePagamentoDiario, useDeletePagamentoDiario,
  useMarcarPagamentosDiarios, useEstornarPagamentoDiario, useHistoricoPagamentosDiarios,
  usePagamentosDiariosRH, useAutoresPagamentosDiarios,
  type PagamentoDiario, type PagamentoDiarioInput, type HistoricoPagamentoDiario, type PagamentoDiarioRH,
  type AutorPagamento,
} from "@/lib/queries";
import { usePixNaoVistos, zerarPixNaoVistos } from "@/lib/avisos-pix";

// ─── Datas e mês ────────────────────────────────────────────
const ymOf = (iso: string) => iso.slice(0, 7);
const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const fmtMes = (ym: string) => (ym ? `${MESES_PT[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}` : "todo o período");

// Soma dias sem passar por UTC (evita o clássico "voltou um dia" no fuso -03).
const somaDias = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};

const fimDoMes = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad(new Date(y, m, 0).getDate())}`;
};

const emptyForm = (data: string): PagamentoDiarioInput => ({
  data, titular: "", chavePix: "", tipoChave: "outro", valor: 0, descricao: "",
});

// Situação derivada (não existe coluna "status": pago + estornado dizem tudo).
type Situacao = "aberto" | "pago" | "estornado";
const situacaoDe = (p: PagamentoDiario): Situacao =>
  p.estornado ? "estornado" : p.pago ? "pago" : "aberto";

// ─── Quem lançou ────────────────────────────────────────────
// Vem do histórico do banco (linha 'criado'), nunca de um palpite da tela: sem
// registro, mostra "—". O nome exibido é a parte local do e-mail, e o e-mail
// inteiro (com data e hora) fica no title.
function QuemLancou({ autor, criadoEm }: { autor?: AutorPagamento; criadoEm?: string }) {
  const quando = autor?.em ?? criadoEm ?? "";
  if (!autor?.email) {
    return (
      <span className="text-muted-foreground" title={quando ? `Lançado em ${fmtDataHora(quando)} — o histórico não guardou quem` : undefined}>
        —
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col leading-tight" title={`${autor.email}${quando ? ` · ${fmtDataHora(quando)}` : ""}`}>
      <span className="text-[13px] font-medium">{nomeDoEmail(autor.email)}</span>
      {quando && <span className="text-[11px] text-muted-foreground">{fmtDataHora(quando)}</span>}
    </span>
  );
}

function BadgeSituacao({ p }: { p: PagamentoDiario }) {
  const s = situacaoDe(p);
  if (s === "estornado") {
    return (
      <Badge variant="outline" className="bg-secondary border-0 text-[11px] font-medium text-muted-foreground" title={p.estornoMotivo}>
        Estornado
      </Badge>
    );
  }
  if (s === "pago") {
    return (
      <Badge variant="outline" className="bg-success/10 border-0 text-[11px] font-medium text-success gap-1"
        title={p.pagoEm ? `Pago em ${fmtDataHora(p.pagoEm)} — registro definitivo` : "Registro definitivo"}>
        <Lock className="h-3 w-3" />Pago
      </Badge>
    );
  }
  return <Badge variant="outline" className="bg-secondary border-0 text-[11px] font-medium">Em aberto</Badge>;
}

// Traduz o erro cru do Postgres. As mensagens da trava (migração 39) já vêm
// prontas em português — o que sobra é o caso "migração ainda não rodou".
const semMigracao = (msg: string) =>
  /pagamentos_diarios/.test(msg) && /not find|does not exist|schema cache/i.test(msg);
const msgErro = (e: unknown, fallback: string) => {
  const msg = e instanceof Error ? e.message : "";
  if (!msg) return fallback;
  return semMigracao(msg)
    ? "A tabela ainda não existe: rode supabase/39_pagamentos_diarios.sql no SQL Editor."
    : msg;
};

// ─── Campo de chave Pix: detecta o tipo e mostra como vai gravar ──
// Aceita também o Pix copia e cola (texto do QR code) e a imagem do QR — colada
// no campo (Ctrl+V de um print) ou escolhida pelo botão. O código lido vai para
// `onPixLido`, que preenche o resto do formulário.
//
// A lógica (detecção do tipo, leitura do QR, prévia de como vai gravar) está em
// modulos/financeiro/pix-formulario.ts, compartilhada com a tela de celular.
function CampoChavePix({
  chave, tipo, onChange, onPixLido,
}: {
  chave: string;
  tipo: TipoChavePix;
  onChange: (chave: string, tipo: TipoChavePix) => void;
  onPixLido: (lido: PixLido) => void;
}) {
  const { erro, erroQr, previa, lendoQr, receberTexto, escolherTipo, lerImagem } = useCampoChavePix({
    chave, tipo, onChange, onPixLido,
  });

  return (
    <>
      <div className="col-span-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Chave Pix do recebedor</Label>
          <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-primary hover:underline">
            {lendoQr ? <Loader2 className="h-3 w-3 animate-spin" /> : <QrCode className="h-3 w-3" />}
            Ler QR code (imagem)
            <input type="file" accept="image/*" className="hidden" disabled={lendoQr}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void lerImagem(f); }} />
          </label>
        </div>
        <Input
          value={chave}
          onChange={(e) => receberTexto(e.target.value)}
          onPaste={(e) => {
            const img = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
            if (img) { e.preventDefault(); void lerImagem(img); }
          }}
          placeholder="Chave (CPF, CNPJ, e-mail, telefone, aleatória) ou Pix copia e cola"
        />
        {erroQr ? (
          <p className="text-[11px] text-destructive mt-1">{erroQr}</p>
        ) : erro ? (
          <p className="text-[11px] text-destructive mt-1">{erro}</p>
        ) : previa ? (
          <p className="text-[11px] text-muted-foreground mt-1">Vai ser gravada como <strong className="text-foreground break-all">{previa}</strong>.</p>
        ) : (
          <p className="text-[11px] text-muted-foreground mt-1">O tipo é reconhecido sozinho. Dá para colar o Pix copia e cola ou o print do QR code.</p>
        )}
      </div>
      <div className="col-span-2">
        <Label className="text-xs">Tipo da chave</Label>
        <Select value={tipo} onValueChange={(v) => escolherTipo(v as TipoChavePix)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIPOS_CHAVE.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

// ─── Diálogo de criar/editar ────────────────────────────────
// O estado, a validação e o que o QR preenche vivem em pix-formulario.ts: esta
// é a tela de computador do mesmo formulário que o celular desenha à sua moda.
export function PagamentoDialog({
  open, onOpenChange, pagamento, dataPadrao,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pagamento: PagamentoDiario | null;
  dataPadrao: string;
}) {
  const { form, setForm, erro: err, qrLido, aplicarPix, limparQr, salvar, salvando } =
    useFormularioPagamento({ aberto: open, pagamento, dataPadrao, aoSalvar: () => onOpenChange(false) });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!salvando) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{pagamento ? "Editar pagamento" : "Novo pagamento"}</DialogTitle>
          <DialogDescription>
            Só dá para editar enquanto está em aberto — depois de marcado como pago, o registro é definitivo.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div>
            <Label className="text-xs">Data</Label>
            <Input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Valor (R$)</Label>
            <Input type="number" min={0} step="0.01" inputMode="decimal"
              value={Number.isFinite(form.valor) ? form.valor : 0}
              onChange={(e) => setForm({ ...form, valor: numFromInput(e.target.valueAsNumber) })} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Titular recebedor</Label>
            <Input value={form.titular} onChange={(e) => setForm({ ...form, titular: e.target.value })}
              placeholder="Nome de quem recebe" autoFocus />
          </div>
          <CampoChavePix
            chave={form.chavePix}
            tipo={form.tipoChave}
            onChange={(chavePix, tipoChave) => { limparQr(); setForm((f) => ({ ...f, chavePix, tipoChave })); }}
            onPixLido={aplicarPix}
          />
          {qrLido && (
            <div className="col-span-2 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[12px]">
              <QrCode className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <p className="text-muted-foreground">
                <strong className="text-foreground">Lido do QR code</strong>
                {qrLido.nome && <> · {qrLido.nome}{qrLido.cidade ? ` (${qrLido.cidade})` : ""}</>}
                {qrLido.valor ? <> · {brl(qrLido.valor)}</> : null}
                {qrLido.chave
                  ? ". Vai gravar a chave de dentro dele."
                  : ". QR dinâmico: o código inteiro fica gravado — quem paga cola no app do banco."}
                {qrLido.valor && Math.abs(qrLido.valor - form.valor) > 0.004 ? (
                  <span className="block text-warning-ink">O valor do QR é {brl(qrLido.valor)} e o do formulário está diferente — confira.</span>
                ) : null}
              </p>
            </div>
          )}
          <div className="col-span-2">
            <Label className="text-xs">Descrição (opcional)</Label>
            <Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Ex.: diária, adiantamento, nº do pedido" />
          </div>
        </div>

        {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando} className="bg-foreground text-background hover:bg-foreground/90">
            {salvando && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{pagamento ? "Salvar" : "Adicionar à lista"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Diálogo de estorno (só master) ─────────────────────────
export function EstornoDialog({
  alvo, onClose,
}: {
  alvo: PagamentoDiario | null;
  onClose: () => void;
}) {
  const estornar = useEstornarPagamentoDiario();
  const [motivo, setMotivo] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (alvo) { setMotivo(""); setErr(null); estornar.reset(); } }, [alvo]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmar = async () => {
    if (!alvo) return;
    if (!motivo.trim()) { setErr("Escreva o motivo — ele fica gravado no histórico."); return; }
    try {
      await estornar.mutateAsync({ id: alvo.id, motivo });
      toast.success("Pagamento estornado. O registro continua na lista, fora dos totais.");
      onClose();
    } catch (e) {
      setErr(msgErro(e, "Erro ao estornar."));
    }
  };

  return (
    <Dialog open={!!alvo} onOpenChange={(v) => { if (!v && !estornar.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Estornar pagamento</DialogTitle>
          <DialogDescription>
            Um pagamento pago não é excluído nem editado — nunca. O estorno é a única correção:
            a linha continua na lista, marcada como estornada e fora dos totais, com este motivo no histórico.
          </DialogDescription>
        </DialogHeader>

        {alvo && (
          <div className="rounded-lg border border-border/70 bg-secondary/30 px-3 py-2.5 text-sm">
            <div className="font-medium">{alvo.titular}</div>
            <div className="text-muted-foreground text-xs mt-0.5">
              {fmtBR(alvo.data)} · {formatarChavePix(alvo.chavePix, alvo.tipoChave)} · <strong className="text-foreground">{brl(alvo.valor)}</strong>
            </div>
          </div>
        )}

        <div>
          <Label className="text-xs">Motivo do estorno</Label>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
            placeholder="Ex.: valor digitado errado, Pix não chegou a ser feito..." />
        </div>

        {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={estornar.isPending}>Cancelar</Button>
          <Button onClick={confirmar} disabled={estornar.isPending} variant="destructive">
            {estornar.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Estornar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Histórico mensal ───────────────────────────────────────
export const LABEL_CAMPO: Record<string, string> = {
  data: "Data", titular: "Titular", chave_pix: "Chave Pix", tipo_chave: "Tipo da chave",
  valor: "Valor", descricao: "Descrição", pago: "Pago", pago_em: "Pago em", pago_por: "Pago por",
  estornado: "Estornado", estornado_em: "Estornado em", estorno_motivo: "Motivo do estorno",
};
const CAMPOS_TECNICOS = new Set(["id", "empresa_id", "criado_em", "criado_por", "atualizado_em", "pago_por"]);

export const valorCampo = (campo: string, v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (campo === "valor") return brl(Number(v));
  if (campo === "data") return fmtBR(String(v));
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (campo.endsWith("_em")) return fmtDataHora(String(v));
  return String(v);
};

const ACOES: Record<string, { label: string; classe: string }> = {
  criado: { label: "Criado", classe: "bg-secondary text-foreground" },
  alterado: { label: "Alterado", classe: "bg-primary/10 text-primary" },
  pago: { label: "Pago", classe: "bg-success/10 text-success" },
  estornado: { label: "Estornado", classe: "bg-destructive/10 text-destructive" },
  excluido: { label: "Excluído", classe: "bg-destructive/10 text-destructive" },
};

function MudancasCell({ h }: { h: HistoricoPagamentoDiario }) {
  if (h.acao === "criado") return <span className="text-muted-foreground">Lançado na lista</span>;
  if (h.acao === "excluido") return <span className="text-muted-foreground">Removido da lista (estava em aberto)</span>;

  const campos = h.campos.filter((c) => !CAMPOS_TECNICOS.has(c));
  if (campos.length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <ul className="space-y-0.5">
      {campos.map((c) => (
        <li key={c} className="text-[12px]">
          <span className="text-muted-foreground">{LABEL_CAMPO[c] ?? c}: </span>
          <span className="line-through text-muted-foreground">{valorCampo(c, h.dadosAntes?.[c])}</span>
          <span className="mx-1 text-muted-foreground">→</span>
          <span className="font-medium">{valorCampo(c, h.dadosDepois?.[c])}</span>
        </li>
      ))}
    </ul>
  );
}

export function HistoricoMes({ competencia }: { competencia: string }) {
  const { data: itens = [], isLoading, error } = useHistoricoPagamentosDiarios(competencia);

  const handleXlsx = () => {
    exportToXlsx({
      filename: `pagamentos-diarios-historico-${competencia || "tudo"}`,
      sheets: [{
        name: "Histórico",
        columns: ["Quando", "Ação", "Titular", "Chave Pix", "Valor", "Quem", "O que mudou"],
        rows: itens.map((h) => [
          fmtDataHora(h.ocorridoEm),
          ACOES[h.acao]?.label ?? h.acao,
          h.titular,
          formatarChavePix(h.chavePix),
          h.valor,
          h.autorEmail || "—",
          h.campos.filter((c) => !CAMPOS_TECNICOS.has(c))
            .map((c) => `${LABEL_CAMPO[c] ?? c}: ${valorCampo(c, h.dadosAntes?.[c])} -> ${valorCampo(c, h.dadosDepois?.[c])}`)
            .join(" | "),
        ]),
      }],
    });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando histórico...</div>;
  }
  if (error) {
    return (
      <Card className="card-elevated border-destructive/30 bg-destructive/5 p-6 text-sm">
        <div className="flex items-start gap-2 text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>{msgErro(error, "Erro ao carregar o histórico.")}</div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Tudo que foi criado, alterado, pago, estornado ou excluído em <strong className="text-foreground">{fmtMes(competencia)}</strong>.
          O registro é do banco: ninguém edita nem apaga esta lista.
        </p>
        <Button variant="outline" size="sm" className="h-8 ml-auto" onClick={handleXlsx} disabled={itens.length === 0}>
          <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />Excel
        </Button>
      </div>

      <Card className="card-elevated border-border/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Quando</th>
                <th className="text-left px-5 py-3 font-medium">Ação</th>
                <th className="text-left px-5 py-3 font-medium">Pagamento</th>
                <th className="text-left px-5 py-3 font-medium">O que mudou</th>
                <th className="text-left px-5 py-3 font-medium">Quem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {itens.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-14 text-center text-muted-foreground">
                    Nenhum registro em {fmtMes(competencia)}.
                  </td>
                </tr>
              ) : (
                itens.map((h) => {
                  const a = ACOES[h.acao] ?? { label: h.acao, classe: "bg-secondary" };
                  return (
                    <tr key={h.id} className="hover:bg-secondary/20 align-top">
                      <td className="px-5 py-3 font-numeric tabular-nums whitespace-nowrap text-muted-foreground">{fmtDataHora(h.ocorridoEm)}</td>
                      <td className="px-5 py-3">
                        <Badge variant="outline" className={`border-0 font-medium text-[11px] ${a.classe}`}>{a.label}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium">{h.titular}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatarChavePix(h.chavePix)} · {brl(h.valor)}
                        </div>
                      </td>
                      <td className="px-5 py-3"><MudancasCell h={h} /></td>
                      <td className="px-5 py-3 text-muted-foreground text-[12px] break-all">{h.autorEmail || "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ─── Pagamentos diários do RH (só leitura) ──────────────────
// Lançados no módulo RH (Folha de pagamento › Pagamento diário). O Pix do dia
// enxerga; o RH não enxerga esta lista. Situação e edição continuam no RH.
function PagamentosDoRH({
  itens, porMes, periodo, carregando, erro,
}: {
  itens: PagamentoDiarioRH[];
  porMes: boolean;
  periodo: string;
  carregando: boolean;
  erro: unknown;
}) {
  const aberto = itens.filter((p) => !p.pago).reduce((s, p) => s + p.valor, 0);
  const pago = itens.filter((p) => p.pago).reduce((s, p) => s + p.valor, 0);

  const copiar = async (p: PagamentoDiarioRH) => {
    try {
      await navigator.clipboard.writeText(p.chavePix);
      toast.success(`Chave de ${p.pessoa} copiada.`);
    } catch {
      toast.error("O navegador não deixou copiar. Selecione a chave na tela.");
    }
  };

  return (
    <section className="mt-6" aria-labelledby="titulo-rh-diario">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h3 id="titulo-rh-diario" className="font-display text-sm font-semibold">Pagamentos diários lançados no RH</h3>
        <Badge variant="outline" className="bg-secondary border-0 text-[10px] font-medium">Somente leitura</Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Registrados pelo RH em Folha de pagamento › Pagamento diário. A situação é a do RH — editar ou dar baixa é lá.
      </p>

      {carregando ? (
        <div className="flex items-center py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando os pagamentos do RH...
        </div>
      ) : erro ? (
        <Card className="card-elevated border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Não deu para carregar os pagamentos do RH. {erro instanceof Error ? erro.message : ""}</span>
        </Card>
      ) : itens.length === 0 ? (
        <Card className="card-elevated border-border/70 px-5 py-6 text-sm text-center text-muted-foreground">
          Nenhum pagamento diário do RH em {periodo}.
        </Card>
      ) : (
        <Card className="card-elevated border-border/70 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  {porMes && <th className="text-left px-5 py-3 font-medium">Data</th>}
                  <th className="text-left px-5 py-3 font-medium">Pessoa</th>
                  <th className="text-left px-5 py-3 font-medium">Chave Pix</th>
                  <th className="text-left px-5 py-3 font-medium">Forma</th>
                  <th className="text-right px-5 py-3 font-medium">Valor</th>
                  <th className="text-left px-5 py-3 font-medium">Situação no RH</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {itens.map((p) => (
                  <tr key={p.id} className="hover:bg-secondary/30 group">
                    {porMes && <td className="px-5 py-3 font-numeric tabular-nums whitespace-nowrap">{fmtBR(p.data)}</td>}
                    <td className="px-5 py-3 font-medium">
                      {p.pessoa || "—"}
                      {p.descricao && <div className="text-[11px] text-muted-foreground font-normal">{p.descricao}</div>}
                    </td>
                    <td className="px-5 py-3">
                      {p.chavePix ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-numeric text-[13px]">{p.chavePix}</span>
                          <button onClick={() => copiar(p)} title="Copiar chave"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{p.forma}</td>
                    <td className="px-5 py-3 text-right font-numeric font-semibold tabular-nums whitespace-nowrap">{brl(p.valor)}</td>
                    <td className="px-5 py-3">
                      {p.pago ? (
                        <Badge variant="outline" className="bg-success/10 border-0 text-[11px] font-medium text-success">Pago no RH</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-secondary border-0 text-[11px] font-medium">Em aberto no RH</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-secondary/30 text-sm">
                <tr>
                  <td className="px-5 py-3 font-semibold" colSpan={porMes ? 4 : 3}>
                    {itens.length} pagamento{itens.length === 1 ? "" : "s"} do RH
                  </td>
                  <td className="px-5 py-3 text-right font-numeric font-semibold tabular-nums">{brl(aberto + pago)}</td>
                  <td className="px-5 py-3 text-[12px] text-muted-foreground whitespace-nowrap">
                    {brl(aberto)} em aberto
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </section>
  );
}

// ─── Página ─────────────────────────────────────────────────
export function PagamentosDiarios() {
  const { isMaster } = useEmpresa();
  const { data: pagamentos = [], isLoading, error } = usePagamentosDiarios();
  const del = useDeletePagamentoDiario();
  const marcar = useMarcarPagamentosDiarios();

  const hoje = hojeISO();
  const [escopo, setEscopo] = useState<"dia" | "mes">("dia");
  const [dia, setDia] = useState(hoje);
  const [mes, setMes] = useState(ymOf(hoje));
  const [search, setSearch] = useState("");
  const [aba, setAba] = useState("lista");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PagamentoDiario | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PagamentoDiario | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [estornoTarget, setEstornoTarget] = useState<PagamentoDiario | null>(null);
  const [pagarAlvos, setPagarAlvos] = useState<PagamentoDiario[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());

  // Com a tela aberta, o que chega dos colegas já aparece na lista (o ouvinte
  // da raiz invalida a query) — então o contador do menu não tem o que contar.
  const pixNaoVistos = usePixNaoVistos();
  useEffect(() => {
    if (pixNaoVistos > 0) zerarPixNaoVistos();
  }, [pixNaoVistos]);

  // O histórico é sempre mensal; no escopo "dia" ele acompanha o mês do dia.
  const competencia = escopo === "dia" ? ymOf(dia) : mes;

  // Pagamentos diários do RH no mesmo período (só leitura; migração 43).
  const periodoDe = escopo === "dia" ? dia : `${mes}-01`;
  const periodoAte = escopo === "dia" ? dia : fimDoMes(mes);
  const rhQuery = usePagamentosDiariosRH(periodoDe, periodoAte);
  const rhDisponivel = rhQuery.data?.disponivel ?? false;

  // Quem lançou cada Pix (histórico do mês em foco).
  const { data: autores = {} } = useAutoresPagamentosDiarios(competencia);

  const doPeriodo = useMemo(
    () => pagamentos.filter((p) => (escopo === "dia" ? p.data === dia : ymOf(p.data) === mes)),
    [pagamentos, escopo, dia, mes]
  );

  const filtrados = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return doPeriodo;
    return doPeriodo.filter((p) =>
      p.titular.toLowerCase().includes(s) ||
      p.chavePix.toLowerCase().includes(s) ||
      formatarChavePix(p.chavePix, p.tipoChave).toLowerCase().includes(s) ||
      p.descricao.toLowerCase().includes(s)
    );
  }, [doPeriodo, search]);

  const filtradosRH = useMemo(() => {
    const itens = rhQuery.data?.itens ?? [];
    const s = search.trim().toLowerCase();
    if (!s) return itens;
    return itens.filter((p) =>
      p.pessoa.toLowerCase().includes(s) || p.chavePix.toLowerCase().includes(s) || p.descricao.toLowerCase().includes(s)
    );
  }, [rhQuery.data, search]);
  const rhAberto = (rhQuery.data?.itens ?? []).filter((p) => !p.pago).reduce((s, p) => s + p.valor, 0);

  // Estornado fica de fora dos totais: o dinheiro não saiu (ou voltou).
  const validos = doPeriodo.filter((p) => !p.estornado);
  const aPagar = validos.filter((p) => !p.pago).reduce((s, p) => s + p.valor, 0);
  const pago = validos.filter((p) => p.pago).reduce((s, p) => s + p.valor, 0);
  const abertosNoPeriodo = validos.filter((p) => !p.pago).length;
  const estornado = doPeriodo.filter((p) => p.estornado).reduce((s, p) => s + p.valor, 0);

  // Seleção em massa: só as em aberto entram (as pagas já estão fechadas).
  const selecionaveis = filtrados.filter((p) => !p.pago);
  const selArr = useMemo(() => pagamentos.filter((p) => sel.has(p.id) && !p.pago), [pagamentos, sel]);
  const selTotal = selArr.reduce((s, p) => s + p.valor, 0);
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todosSel = selecionaveis.length > 0 && selecionaveis.every((p) => sel.has(p.id));
  const toggleTodos = () => setSel((s) => {
    const n = new Set(s);
    selecionaveis.forEach((p) => (todosSel ? n.delete(p.id) : n.add(p.id)));
    return n;
  });

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (p: PagamentoDiario) => { setEditing(p); setDialogOpen(true); };

  const copiarChave = async (p: PagamentoDiario) => {
    try {
      await navigator.clipboard.writeText(p.chavePix);
      toast.success(`Chave de ${p.titular} copiada.`);
    } catch {
      toast.error("O navegador não deixou copiar. Selecione a chave na tela.");
    }
  };

  const confirmarPagar = async () => {
    if (!pagarAlvos) return;
    try {
      const n = await marcar.mutateAsync(pagarAlvos.map((p) => p.id));
      toast.success(`${n} pagamento${n === 1 ? "" : "s"} marcado${n === 1 ? "" : "s"} como pago${n === 1 ? "" : "s"}. Registro definitivo.`);
      setSel(new Set());
      setPagarAlvos(null);
    } catch (e) {
      toast.error(msgErro(e, "Erro ao marcar como pago."));
    }
  };

  const confirmarExcluir = async () => {
    if (!deleteTarget) return;
    setDeleteErr(null);
    try {
      await del.mutateAsync(deleteTarget.id);
      setSel((s) => { const n = new Set(s); n.delete(deleteTarget.id); return n; });
      setDeleteTarget(null);
    } catch (e) {
      // Se alguém marcou como pago em outra aba, a trava do banco barra aqui.
      setDeleteErr(msgErro(e, "Erro ao excluir."));
    }
  };

  const handleXlsx = () => {
    exportToXlsx({
      filename: `pagamentos-diarios-${escopo === "dia" ? dia : mes}`,
      sheets: [{
        name: "Pagamentos",
        columns: ["Data", "Titular", "Chave Pix", "Tipo", "Valor", "Situação", "Quem lançou", "Lançado em", "Descrição"],
        rows: filtrados.map((p) => [
          fmtBR(p.data), p.titular, formatarChavePix(p.chavePix, p.tipoChave), labelTipoChave(p.tipoChave),
          p.valor, situacaoDe(p) === "aberto" ? "Em aberto" : situacaoDe(p) === "pago" ? "Pago" : "Estornado",
          autores[p.id]?.email ?? "", fmtDataHora(autores[p.id]?.em ?? p.criadoEm),
          p.descricao,
        ]),
      }, ...(filtradosRH.length > 0 ? [{
        name: "Lançados no RH",
        columns: ["Data", "Pessoa", "Chave Pix", "Forma", "Valor", "Situação no RH", "Descrição"],
        rows: filtradosRH.map((p) => [
          fmtBR(p.data), p.pessoa, p.chavePix, p.forma, p.valor, p.pago ? "Pago" : "Em aberto", p.descricao,
        ]),
      }] : [])],
    });
  };

  const tabelaSemMigracao = !!error && semMigracao(error instanceof Error ? error.message : "");

  return (
    <AppShell
      title="Pagamentos Diários"
      subtitle="Lista de Pix do dia — chave, titular recebedor e valor"
      actions={
        <>
          <Button variant="outline" className="h-9" onClick={handleXlsx} disabled={filtrados.length === 0 && filtradosRH.length === 0}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" />Excel
          </Button>
          <Button onClick={openCreate} className="h-9 bg-foreground text-background hover:bg-foreground/90">
            <Plus className="h-4 w-4 mr-1.5" />Novo pagamento
          </Button>
        </>
      }
    >
      <Card className="p-3 card-elevated border-primary/20 bg-primary/5 mb-5">
        <p className="text-xs text-muted-foreground flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
          <span>
            Lista de controle: <strong className="text-foreground">não entra no saldo</strong> das contas nem nas movimentações — a saída continua vindo do extrato.
            Marcou como <strong className="text-foreground">pago</strong>, o registro fica definitivo: não se apaga nem se edita.
            Cada mudança vai para o <strong className="text-foreground">histórico do mês</strong>.
          </span>
        </p>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">A pagar</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-destructive">{brl(aPagar)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{abertosNoPeriodo} em aberto</p>
          {rhAberto > 0 && (
            <p className="text-[11px] text-muted-foreground">+ {brl(rhAberto)} em aberto no RH</p>
          )}
        </Card>
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Pago</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-success">{brl(pago)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{validos.filter((p) => p.pago).length} pagamento(s)</p>
        </Card>
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Total da lista</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5">{brl(aPagar + pago)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{escopo === "dia" ? fmtBR(dia) : fmtMes(mes)}</p>
        </Card>
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Estornado</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-muted-foreground">{brl(estornado)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">fora dos totais</p>
        </Card>
      </div>

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList className="mb-4">
          <TabsTrigger value="lista">Lista</TabsTrigger>
          <TabsTrigger value="historico" className="gap-1.5"><History className="h-3.5 w-3.5" />Histórico do mês</TabsTrigger>
        </TabsList>

        <TabsContent value="lista">
          {/* Escopo: um dia (o normal) ou o mês inteiro */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="inline-flex rounded-lg border border-border/70 p-0.5">
              {(["dia", "mes"] as const).map((e) => (
                <button key={e} onClick={() => setEscopo(e)}
                  className={`px-3 h-8 rounded-md text-xs font-medium transition-colors ${escopo === e ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {e === "dia" ? "Por dia" : "Mês inteiro"}
                </button>
              ))}
            </div>

            {escopo === "dia" ? (
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => setDia((d) => somaDias(d, -1))} title="Dia anterior">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Input type="date" value={dia} onChange={(e) => setDia(e.target.value || hoje)} className="h-9 w-40" />
                <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => setDia((d) => somaDias(d, 1))} title="Próximo dia">
                  <ChevronRight className="h-4 w-4" />
                </Button>
                {dia !== hoje && (
                  <button onClick={() => setDia(hoje)} className="text-xs text-muted-foreground hover:text-foreground ml-1">hoje</button>
                )}
              </div>
            ) : (
              <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="h-9 w-40" />
            )}

            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Buscar titular, chave ou descrição..." className="pl-8 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {/* Barra de seleção em massa */}
          {selArr.length > 0 && (
            <div className="flex items-center gap-3 mb-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 flex-wrap">
              <span className="text-sm font-medium">{selArr.length} selecionado(s) · {brl(selTotal)}</span>
              <button onClick={() => setSel(new Set())} className="text-xs text-muted-foreground hover:text-foreground">Limpar seleção</button>
              <Button size="sm" className="h-8 ml-auto bg-success text-white hover:bg-success/90"
                onClick={() => setPagarAlvos(selArr)} disabled={marcar.isPending}>
                {marcar.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                Marcar {selArr.length} como pago{selArr.length === 1 ? "" : "s"}
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando pagamentos...
            </div>
          ) : error ? (
            <Card className="card-elevated border-destructive/30 bg-destructive/5 p-6 text-sm">
              <div className="flex items-start gap-2 text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  {tabelaSemMigracao
                    ? <>A tabela ainda não existe. Rode <strong>supabase/39_pagamentos_diarios.sql</strong> no SQL Editor e recarregue.</>
                    : <>Erro ao carregar os pagamentos. {error instanceof Error ? error.message : ""}</>}
                </div>
              </div>
            </Card>
          ) : (
            <Card className="card-elevated border-border/70 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 w-9">
                        <Checkbox checked={todosSel} onCheckedChange={toggleTodos} aria-label="Selecionar todos em aberto"
                          disabled={selecionaveis.length === 0} />
                      </th>
                      {escopo === "mes" && <th className="text-left px-5 py-3 font-medium">Data</th>}
                      <th className="text-left px-5 py-3 font-medium">Titular recebedor</th>
                      <th className="text-left px-5 py-3 font-medium">Chave Pix</th>
                      <th className="text-left px-5 py-3 font-medium">Quem lançou</th>
                      <th className="text-right px-5 py-3 font-medium">Valor</th>
                      <th className="text-left px-5 py-3 font-medium">Situação</th>
                      <th className="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtrados.length === 0 ? (
                      <tr>
                        <td colSpan={escopo === "mes" ? 8 : 7} className="px-5 py-14 text-center text-muted-foreground">
                          {pagamentos.length === 0
                            ? <>Nenhum pagamento lançado ainda. Clique em <strong>Novo pagamento</strong> para montar a lista do dia.</>
                            : search.trim()
                              ? <>Nenhum pagamento encontrado para “{search}”.</>
                              : <>Nenhum pagamento em {escopo === "dia" ? fmtBR(dia) : fmtMes(mes)}.</>}
                        </td>
                      </tr>
                    ) : (
                      filtrados.map((p) => {
                        const s = situacaoDe(p);
                        return (
                          <tr key={p.id} className={`hover:bg-secondary/30 group ${p.estornado ? "opacity-60" : ""}`}>
                            <td className="px-4 py-3">
                              <Checkbox checked={sel.has(p.id)} onCheckedChange={() => toggleSel(p.id)} disabled={p.pago}
                                aria-label={`Selecionar ${p.titular}`} />
                            </td>
                            {escopo === "mes" && (
                              <td className="px-5 py-3 font-numeric tabular-nums whitespace-nowrap">{fmtBR(p.data)}</td>
                            )}
                            <td className="px-5 py-3 font-medium">
                              <span className={p.estornado ? "line-through" : ""}>{p.titular}</span>
                              {p.descricao && <div className="text-[11px] text-muted-foreground font-normal">{p.descricao}</div>}
                              {p.estornado && p.estornoMotivo && (
                                <div className="text-[11px] text-destructive font-normal">Estorno: {p.estornoMotivo}</div>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className="font-numeric text-[13px]" title={p.tipoChave === "copia_cola" ? p.chavePix : undefined}>
                                  {resumirChavePix(p.chavePix, p.tipoChave)}
                                </span>
                                <button onClick={() => copiarChave(p)} title="Copiar chave"
                                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                                  <Copy className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <Badge variant="outline" className="bg-secondary border-0 font-medium text-[10px] mt-1">{labelTipoChave(p.tipoChave)}</Badge>
                            </td>
                            <td className="px-5 py-3 whitespace-nowrap">
                              <QuemLancou autor={autores[p.id]} criadoEm={p.criadoEm} />
                            </td>
                            <td className={`px-5 py-3 text-right font-numeric font-semibold tabular-nums whitespace-nowrap ${p.estornado ? "line-through" : ""}`}>
                              {brl(p.valor)}
                            </td>
                            <td className="px-5 py-3"><BadgeSituacao p={p} /></td>
                            <td className="px-5 py-3 text-right whitespace-nowrap">
                              {s === "aberto" ? (
                                <>
                                  <Button size="sm" variant="ghost" onClick={() => setPagarAlvos([p])} title="Marcar como pago"
                                    className="h-7 w-7 p-0 text-success hover:text-success opacity-0 group-hover:opacity-100 transition-opacity">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => openEdit(p)} title="Editar"
                                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => { setDeleteErr(null); setDeleteTarget(p); }} title="Excluir"
                                    className="h-7 w-7 p-0 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              ) : s === "pago" && isMaster ? (
                                <Button size="sm" variant="ghost" onClick={() => setEstornoTarget(p)} title="Estornar (só master)"
                                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                              ) : (
                                <span title="Registro definitivo" className="text-muted-foreground inline-flex"><Lock className="h-3.5 w-3.5" /></span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {filtrados.length > 0 && (
                    <tfoot className="bg-secondary/30 text-sm font-semibold">
                      <tr>
                        <td className="px-5 py-3" colSpan={escopo === "mes" ? 5 : 4}>
                          {filtrados.length} pagamento{filtrados.length === 1 ? "" : "s"}
                        </td>
                        <td className="px-5 py-3 text-right font-numeric tabular-nums">
                          {brl(filtrados.filter((p) => !p.estornado).reduce((s, p) => s + p.valor, 0))}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </Card>
          )}

          {rhDisponivel && (
            <PagamentosDoRH
              itens={filtradosRH}
              porMes={escopo === "mes"}
              periodo={escopo === "dia" ? fmtBR(dia) : fmtMes(mes)}
              carregando={rhQuery.isLoading}
              erro={rhQuery.error}
            />
          )}
        </TabsContent>

        <TabsContent value="historico">
          {escopo === "mes" ? null : (
            <p className="text-xs text-muted-foreground mb-3">
              O histórico é mensal — mostrando o mês do dia selecionado na lista.
            </p>
          )}
          <HistoricoMes competencia={competencia} />
        </TabsContent>
      </Tabs>

      {/* No escopo mensal o novo pagamento nasce em hoje (se hoje é do mês) ou no dia 1. */}
      <PagamentoDialog open={dialogOpen} onOpenChange={setDialogOpen} pagamento={editing}
        dataPadrao={escopo === "dia" ? dia : hoje.startsWith(mes) ? hoje : `${mes}-01`} />

      <EstornoDialog alvo={estornoTarget} onClose={() => setEstornoTarget(null)} />

      {/* Marcar como pago — porta de sentido único, avisa antes */}
      <AlertDialog open={!!pagarAlvos} onOpenChange={(v) => !v && setPagarAlvos(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Marcar {pagarAlvos?.length === 1 ? "este pagamento" : `${pagarAlvos?.length} pagamentos`} como pago?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pagarAlvos?.length === 1 && pagarAlvos[0]
                ? <>{pagarAlvos[0].titular} · {brl(pagarAlvos[0].valor)}. </>
                : <>Total de {brl((pagarAlvos ?? []).reduce((s, p) => s + p.valor, 0))}. </>}
              Depois de pago o registro é <strong>definitivo</strong>: não pode ser excluído nem editado.
              Se der algo errado, só o master consegue estornar — e a linha continua na lista.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={marcar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmarPagar(); }} disabled={marcar.isPending}
              className="bg-success text-white hover:bg-success/90">
              {marcar.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Confirmar pagamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Excluir — só chega aqui quem está em aberto */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir pagamento?</AlertDialogTitle>
            <AlertDialogDescription>
              O pagamento de <strong>{deleteTarget?.titular}</strong> ({deleteTarget && brl(deleteTarget.valor)}) sai da lista.
              A exclusão fica registrada no histórico do mês, com quem apagou e quando.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteErr && (
            <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />{deleteErr}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmarExcluir(); }} disabled={del.isPending}
              className="bg-destructive hover:bg-destructive/90">
              {del.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
