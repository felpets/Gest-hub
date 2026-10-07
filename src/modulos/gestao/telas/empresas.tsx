import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Building2, Plus, Pencil, Users, UserPlus, Trash2, Loader2, ShieldAlert, ShieldCheck, Info, Wallet } from "lucide-react";
import { useEmpresa } from "@/lib/empresa";
import {
  useEmpresasAdmin, useCriarEmpresa, useRenomearEmpresa, useExcluirEmpresa, useDefinirModulosEmpresa,
  useMembros, useVincularMembro, useDesvincularMembro, useDefinirPapel,
  useCargos, useSalvarCargo, useExcluirCargo,
  type EmpresaAdmin, type Membro, type Cargo,
} from "@/lib/queries";
import { CAPACIDADES, nomeCapacidade } from "@/lib/permissoes";
import { nomeModulos } from "@/modulos/rh/empresas";

// Onde a empresa é usada. O Financeiro dá acesso por membros e cargos; o RH, por
// pessoa (Configurações › Usuários). Uma empresa pode ter os dois.
type Uso = "financeiro" | "rh" | "ambos";
const USOS: { valor: Uso; titulo: string; desc: string; icon: typeof Wallet }[] = [
  { valor: "financeiro", titulo: "Financeiro", desc: "Caixa, extratos, pagamentos e receitas. Acesso por membros e cargos.", icon: Wallet },
  { valor: "rh", titulo: "RH", desc: "Funcionários, folha e recrutamento. Acesso liberado por pessoa em Usuários.", icon: Users },
  { valor: "ambos", titulo: "Financeiro e RH", desc: "A mesma empresa nos dois pilares, com o seletor do topo valendo para os dois.", icon: Building2 },
];
const modulosDe = (uso: Uso): string[] => (uso === "ambos" ? ["financeiro", "rh"] : [uso]);
const usoDe = (modulos: string[]): Uso =>
  modulos.includes("financeiro") && modulos.includes("rh") ? "ambos" : modulos.includes("rh") ? "rh" : "financeiro";

function EscolhaUso({ valor, onChange, disabled }: { valor: Uso; onChange: (u: Uso) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Onde a empresa é usada" className="grid gap-2">
      {USOS.map((u) => {
        const ativo = u.valor === valor;
        const Icone = u.icon;
        return (
          <button
            key={u.valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            disabled={disabled}
            onClick={() => onChange(u.valor)}
            className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${ativo ? "border-foreground bg-secondary/60" : "border-border/70 hover:bg-secondary/30"}`}
          >
            <Icone className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <span>
              <span className="block text-sm font-medium">{u.titulo}</span>
              <span className="block text-[11px] text-muted-foreground">{u.desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Empresas() {
  const { isMaster, refetchEmpresas, empresaId, trocarEmpresa } = useEmpresa();
  const { data: empresas = [], isLoading } = useEmpresasAdmin();
  const criar = useCriarEmpresa();
  const renomear = useRenomearEmpresa();
  const definirModulos = useDefinirModulosEmpresa();
  const excluirMut = useExcluirEmpresa();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EmpresaAdmin | null>(null);
  const [nome, setNome] = useState("");
  const [uso, setUso] = useState<Uso>("ambos");
  const [err, setErr] = useState<string | null>(null);
  const [gerenciar, setGerenciar] = useState<EmpresaAdmin | null>(null);
  // Exclusão de empresa inteira: alvo + nome digitado (trava de segurança).
  const [excluir, setExcluir] = useState<EmpresaAdmin | null>(null);
  const [confirmaNome, setConfirmaNome] = useState("");

  const abrirExcluir = (e: EmpresaAdmin) => { setConfirmaNome(""); excluirMut.reset(); setExcluir(e); };
  const confirmarExclusao = async () => {
    if (!excluir || confirmaNome.trim() !== excluir.nome) return;
    try {
      const { total } = await excluirMut.mutateAsync(excluir.id);
      // Se a empresa ativa foi embora, muda o contexto para outra que sobrou.
      if (empresaId === excluir.id) {
        const resto = empresas.filter((e) => e.id !== excluir.id);
        if (resto.length > 0) trocarEmpresa(resto[0].id);
      }
      await refetchEmpresas();
      toast.success(`Empresa "${excluir.nome}" excluída (${total} registro${total === 1 ? "" : "s"} removido${total === 1 ? "" : "s"}).`);
      setExcluir(null);
    } catch { /* erro exibido no diálogo via excluirMut.isError; mantém aberto */ }
  };

  const openNew = () => { setEditing(null); setNome(""); setUso("ambos"); setErr(null); criar.reset(); setFormOpen(true); };
  const openEdit = (e: EmpresaAdmin) => {
    setEditing(e); setNome(e.nome); setUso(usoDe(e.modulos)); setErr(null);
    renomear.reset(); definirModulos.reset(); setFormOpen(true);
  };

  const salvar = async () => {
    if (!nome.trim()) { setErr("Informe o nome da empresa."); return; }
    setErr(null);
    try {
      if (editing) {
        if (nome.trim() !== editing.nome) await renomear.mutateAsync({ id: editing.id, nome: nome.trim() });
        if (uso !== usoDe(editing.modulos)) await definirModulos.mutateAsync({ id: editing.id, modulos: modulosDe(uso) });
      } else {
        await criar.mutateAsync({ nome: nome.trim(), modulos: modulosDe(uso) });
      }
      await refetchEmpresas(); // atualiza o seletor do topo
      setFormOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar a empresa.");
    }
  };

  const salvando = criar.isPending || renomear.isPending || definirModulos.isPending;
  const temRH = editing ? editing.modulos.includes("rh") : false;

  if (!isMaster) {
    return (
      <AppShell title="Empresas" subtitle="Administração de empresas e acessos">
        <Card className="card-elevated border-border/70 p-8 text-center max-w-md mx-auto">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-secondary grid place-items-center mb-3">
            <ShieldAlert className="h-5 w-5 text-muted-foreground" />
          </div>
          <h3 className="font-display text-lg font-semibold">Acesso restrito</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Apenas o administrador master pode gerenciar empresas.
          </p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Empresas"
      subtitle="Crie empresas para o Financeiro, para o RH ou para os dois"
      actions={
        <Button onClick={openNew} className="h-9 bg-foreground text-background hover:bg-foreground/90">
          <Plus className="h-4 w-4 mr-1.5" />Nova empresa
        </Button>
      }
    >
      <Card className="p-3 card-elevated border-primary/20 bg-primary/5 mb-5">
        <p className="text-xs text-muted-foreground flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
          <span>
            <strong className="text-foreground">Financeiro:</strong> quem acessa é definido em Membros, com um cargo.{" "}
            <strong className="text-foreground">RH:</strong> o acesso é liberado por pessoa em Configurações › Usuários (botão Acessos),
            com as empresas que ela pode ver.
          </span>
        </p>
      </Card>

      <Card className="card-elevated border-border/70 overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-display text-base font-semibold">
            {empresas.length} {empresas.length === 1 ? "empresa" : "empresas"}
          </h3>
        </div>
        {isLoading && (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando...
          </div>
        )}
        {!isLoading && empresas.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            Nenhuma empresa. Crie a primeira com “Nova empresa”.
          </div>
        )}
        <ul className="divide-y divide-border">
          {empresas.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-6 py-3.5 hover:bg-secondary/30">
              <div className="h-9 w-9 rounded-lg bg-secondary grid place-items-center">
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{e.nome}</span>
              </span>
              <Badge variant="outline" className="bg-secondary border-0 font-medium text-[10px] whitespace-nowrap">
                {nomeModulos(e.modulos)}
              </Badge>
              {e.modulos.includes("financeiro") ? (
                <Button variant="ghost" size="sm" className="h-8" onClick={() => setGerenciar(e)}>
                  <Users className="h-3.5 w-3.5 mr-1.5" />Membros
                </Button>
              ) : (
                <span className="hidden sm:inline text-[11px] text-muted-foreground px-2" title="Empresa só do RH: o acesso é por pessoa, em Usuários">
                  acesso em Usuários
                </span>
              )}
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(e)} title="Editar nome e módulos">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost" size="sm"
                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                onClick={() => abrirExcluir(e)}
                title="Excluir a empresa e todos os dados dela"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      {/* Cargos e permissões */}
      <div className="mt-6">
        <CargosCard />
      </div>

      {/* Criar/renomear empresa */}
      <Dialog open={formOpen} onOpenChange={(v) => { if (!salvando) setFormOpen(v); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar empresa" : "Nova empresa"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Altere o nome ou onde a empresa é usada. Um módulo que já tem dados não pode ser desligado."
                : "Escolha onde a empresa vai ser usada. Dá para mudar depois."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input value={nome} onChange={(ev) => setNome(ev.target.value)} placeholder="Ex.: Padaria do João" autoFocus />
              {editing && temRH && nome.trim() !== editing.nome && (
                <p className="text-[11px] text-warning-ink mt-1">
                  O RH guarda o nome da empresa em cada cadastro: os registros antigos continuam com
                  “{editing.nome}” e deixam de aparecer nesta empresa.
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Onde a empresa é usada</Label>
              <div className="mt-1.5">
                <EscolhaUso valor={uso} onChange={setUso} disabled={salvando} />
              </div>
            </div>
          </div>
          {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={salvando}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando} className="bg-foreground text-background hover:bg-foreground/90">
              {salvando && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Gerenciar membros */}
      <MembrosDialog empresa={gerenciar} onClose={() => setGerenciar(null)} />

      {/* Excluir empresa inteira — trava: digitar o nome exato */}
      <AlertDialog open={!!excluir} onOpenChange={(v) => { if (!v && !excluirMut.isPending) setExcluir(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a empresa “{excluir?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Isso apaga <strong>permanentemente</strong> tudo desta empresa: movimentações,
                  clientes e cobranças, contas a pagar, plano de contas, contas bancárias,
                  orçamento, regras e o vínculo dos membros. Não tem como desfazer.
                </p>
                {excluir?.modulos.includes("rh") && (
                  <p>Os cadastros do RH desta empresa (funcionários, folha, candidatos) não são apagados.</p>
                )}
                <p>
                  Para confirmar, digite o nome exato da empresa:
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmaNome}
            onChange={(ev) => setConfirmaNome(ev.target.value)}
            placeholder={excluir?.nome}
            disabled={excluirMut.isPending}
            autoFocus
          />
          {excluirMut.isError && (
            <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {excluirMut.error instanceof Error ? excluirMut.error.message : "Erro ao excluir a empresa."}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => { ev.preventDefault(); confirmarExclusao(); }}
              disabled={excluirMut.isPending || confirmaNome.trim() !== (excluir?.nome ?? "")}
              className="bg-destructive hover:bg-destructive/90"
            >
              {excluirMut.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Excluir tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function MembrosDialog({ empresa, onClose }: { empresa: EmpresaAdmin | null; onClose: () => void }) {
  const { data: membros = [], isLoading } = useMembros(empresa?.id ?? null);
  const { data: cargos = [] } = useCargos();
  const vincular = useVincularMembro();
  const desvincular = useDesvincularMembro();
  const definirPapel = useDefinirPapel();
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<string>("operador");
  const [err, setErr] = useState<string | null>(null);
  const [remover, setRemover] = useState<Membro | null>(null);

  const nomeCargo = (chave: string) => cargos.find((c) => c.chave === chave)?.nome ?? chave;
  const capsCargo = cargos.find((c) => c.chave === papel)?.caps ?? [];

  useEffect(() => { setEmail(""); setPapel("operador"); setErr(null); vincular.reset(); }, [empresa?.id]);

  const add = async () => {
    if (!empresa || !email.trim()) return;
    setErr(null);
    try {
      await vincular.mutateAsync({ empresaId: empresa.id, email: email.trim(), papel });
      setEmail("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao vincular o login.");
    }
  };

  const trocarPapel = async (m: Membro, novo: string) => {
    if (!empresa || m.isMaster || novo === m.papel) return;
    setErr(null);
    try {
      await definirPapel.mutateAsync({ empresaId: empresa.id, userId: m.userId, papel: novo });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao alterar o papel.");
    }
  };

  const confirmRemover = async () => {
    if (!empresa || !remover) return;
    await desvincular.mutateAsync({ empresaId: empresa.id, userId: remover.userId });
    setRemover(null);
  };

  return (
    <>
      <Dialog open={!!empresa} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Membros · {empresa?.nome}</DialogTitle>
            <DialogDescription>
              Logins que acessam esta empresa. Crie o usuário no painel do Supabase (Authentication) e vincule pelo email aqui.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-end gap-2 py-1">
            <div className="flex-1">
              <Label className="text-xs">Email do login</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="login@empresa.com"
                type="email"
                onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              />
            </div>
            <div className="w-44">
              <Label className="text-xs">Cargo</Label>
              <Select value={papel} onValueChange={setPapel}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {cargos.map((c) => (
                    <SelectItem key={c.chave} value={c.chave}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={add} disabled={vincular.isPending || !email.trim()} className="h-10 bg-foreground text-background hover:bg-foreground/90">
              {vincular.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1.5" />}
              Vincular
            </Button>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            {capsCargo.length ? capsCargo.map(nomeCapacidade).join(" · ") : "Sem permissões (somente páginas públicas)."}
          </p>
          {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}

          <div className="mt-1 max-h-[280px] overflow-y-auto rounded-md border border-border">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando...
              </div>
            ) : membros.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum login vinculado ainda.</div>
            ) : (
              <ul className="divide-y divide-border">
                {membros.map((m) => (
                  <li key={m.userId} className="flex items-center gap-2 px-4 py-2.5">
                    <span className="flex-1 text-sm truncate">{m.email}</span>
                    {m.isMaster ? (
                      <Badge variant="outline" className="text-[10px]">master</Badge>
                    ) : (
                      <Select
                        value={m.papel}
                        onValueChange={(v) => trocarPapel(m, v)}
                        disabled={definirPapel.isPending}
                      >
                        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue>{nomeCargo(m.papel)}</SelectValue></SelectTrigger>
                        <SelectContent>
                          {cargos.map((c) => (
                            <SelectItem key={c.chave} value={c.chave}>{c.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive disabled:opacity-30"
                      onClick={() => setRemover(m)}
                      disabled={m.isMaster}
                      title={m.isMaster ? "O master não pode ser removido" : "Remover acesso"}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!remover} onOpenChange={(v) => !v && setRemover(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover acesso?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{remover?.email}</strong> deixará de acessar <strong>{empresa?.nome}</strong>. O login continua existindo no Supabase.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={desvincular.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmRemover(); }}
              disabled={desvincular.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {desvincular.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Cargos: cria/edita/exclui e define as permissões de cada um ──
function CargosCard() {
  const { data: cargos = [], isLoading } = useCargos();
  const salvar = useSalvarCargo();
  const excluir = useExcluirCargo();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Cargo | null>(null);
  const [nome, setNome] = useState("");
  const [caps, setCaps] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [remover, setRemover] = useState<Cargo | null>(null);

  // O admin é sempre todo-poderoso — não dá p/ tirar permissões dele.
  const adminTravado = editing?.chave === "admin";

  const abrirNovo = () => {
    setEditing(null); setNome(""); setCaps(new Set()); setErr(null); salvar.reset(); setOpen(true);
  };
  const abrirEdicao = (c: Cargo) => {
    setEditing(c); setNome(c.nome); setCaps(new Set(c.caps)); setErr(null); salvar.reset(); setOpen(true);
  };

  const toggleCap = (cap: string) => {
    setCaps((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap); else next.add(cap);
      return next;
    });
  };

  const gravar = async () => {
    if (!nome.trim()) { setErr("Informe o nome do cargo."); return; }
    setErr(null);
    try {
      await salvar.mutateAsync({ chave: editing?.chave ?? null, nome: nome.trim(), caps: [...caps] });
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar o cargo.");
    }
  };

  const confirmarRemover = async () => {
    if (!remover) return;
    try {
      await excluir.mutateAsync(remover.chave);
      setRemover(null);
    } catch (e) {
      // A RPC recusa cargo em uso / de sistema — mostra o motivo e fecha o alerta.
      setRemover(null);
      toast.error(e instanceof Error ? e.message : "Erro ao excluir o cargo.");
    }
  };

  return (
    <Card className="card-elevated border-border/70 overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-display text-base font-semibold">Cargos e permissões</h3>
        <Button size="sm" className="h-8 ml-auto bg-foreground text-background hover:bg-foreground/90" onClick={abrirNovo}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />Novo cargo
        </Button>
      </div>
      <p className="px-6 pt-3 text-xs text-muted-foreground">
        Os cargos valem para todas as empresas. Atribua um cargo a cada login em “Membros”.
      </p>

      {isLoading ? (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando...
        </div>
      ) : (
        <ul className="divide-y divide-border mt-2">
          {cargos.map((c) => (
            <li key={c.chave} className="flex items-start gap-3 px-6 py-3.5 hover:bg-secondary/30">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.nome}</span>
                  {c.isSistema && <Badge variant="outline" className="text-[10px]">sistema</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {c.caps.length ? c.caps.map(nomeCapacidade).join(" · ") : "Sem permissões."}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => abrirEdicao(c)} title="Editar permissões">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost" size="sm"
                className="h-8 w-8 p-0 text-destructive hover:text-destructive disabled:opacity-30"
                onClick={() => setRemover(c)}
                disabled={c.isSistema}
                title={c.isSistema ? "Cargo de sistema não pode ser excluído" : "Excluir cargo"}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Criar/editar cargo */}
      <Dialog open={open} onOpenChange={(v) => { if (!salvar.isPending) setOpen(v); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar · ${editing.nome}` : "Novo cargo"}</DialogTitle>
            <DialogDescription>
              Dê um nome e marque o que este cargo pode fazer. A leitura das páginas liberadas é automática.
            </DialogDescription>
          </DialogHeader>

          <div className="py-1">
            <Label className="text-xs">Nome do cargo</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Financeiro Jr" autoFocus />
          </div>

          <div className="space-y-2 py-1">
            <Label className="text-xs">Permissões</Label>
            {adminTravado && (
              <p className="text-xs text-muted-foreground">O Administrador tem sempre todas as permissões.</p>
            )}
            <div className="rounded-md border border-border divide-y divide-border">
              {CAPACIDADES.map((cap) => {
                const marcado = adminTravado || caps.has(cap.chave);
                return (
                  <label key={cap.chave} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-secondary/40">
                    <Checkbox
                      checked={marcado}
                      disabled={adminTravado}
                      onCheckedChange={() => toggleCap(cap.chave)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{cap.nome}</span>
                      <span className="block text-xs text-muted-foreground">{cap.desc}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={salvar.isPending}>Cancelar</Button>
            <Button onClick={gravar} disabled={salvar.isPending} className="bg-foreground text-background hover:bg-foreground/90">
              {salvar.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!remover} onOpenChange={(v) => !v && setRemover(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cargo?</AlertDialogTitle>
            <AlertDialogDescription>
              O cargo <strong>{remover?.nome}</strong> será removido. Só é possível se nenhum membro estiver usando.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluir.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmarRemover(); }}
              disabled={excluir.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {excluir.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
