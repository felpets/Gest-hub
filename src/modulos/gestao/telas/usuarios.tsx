import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Search, Loader2, AlertCircle, Pencil, ShieldAlert, ShieldCheck, Info,
  Eye, EyeOff, RefreshCw, Copy, KeyRound, UserPlus, Mail, Users, Wallet, SlidersHorizontal,
  Trash2, History, FileSpreadsheet, BarChart3,
  type LucideIcon,
} from "lucide-react";
import { fmtDataHora } from "@/lib/datas";
import { exportToXlsx } from "@/lib/export";
import { useAuth } from "@/lib/auth";
import { useEmpresa } from "@/lib/empresa";
import { podeGerirUsuarios } from "@/lib/permissoes";
import {
  useUsuarios, useCriarUsuario, useAtualizarUsuario, useCargos,
  useAcessosRH, useAcessosGestao, useSalvarAcessosUsuario, useExcluirUsuario, useHistoricoUsuarios,
  type Usuario, type NovoUsuarioInput, type AcessoRHUsuario, type HistoricoUsuario, type AcaoHistoricoUsuario,
} from "@/lib/queries";
import { PERFIS_RH, nomePerfilRH } from "@/modulos/rh/acesso";

const SENHA_MIN = 8;

// Senha sugerida ao criar um login. Sem caracteres que se confundem na hora de
// ditar por telefone (O/0, l/1/I) — quem cria o acesso quase sempre passa a
// senha falando com a pessoa.
function gerarSenha(): string {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$%&*";
  const n = 14;
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (v) => abc[v % abc.length]).join("");
}

const copiar = async (texto: string, oque: string) => {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${oque} copiado.`);
  } catch {
    toast.error("O navegador não deixou copiar. Selecione o texto na tela.");
  }
};

const msgErro = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

// ─── Campo de senha com ver/ocultar, sortear e copiar ───────
function CampoSenha({
  valor, onChange, label, hint, autoFocus,
}: {
  valor: string;
  onChange: (v: string) => void;
  label: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  const [visivel, setVisivel] = useState(false);
  const curta = valor.length > 0 && valor.length < SENHA_MIN;

  return (
    <div className="col-span-2">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Input
            type={visivel ? "text" : "password"}
            value={valor}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="new-password"
            autoFocus={autoFocus}
            className="pr-9 font-numeric"
          />
          <button
            type="button"
            onClick={() => setVisivel((v) => !v)}
            title={visivel ? "Ocultar" : "Mostrar"}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {visivel ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0"
          title="Sortear uma senha forte" onClick={() => { onChange(gerarSenha()); setVisivel(true); }}>
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0"
          title="Copiar a senha" disabled={!valor} onClick={() => copiar(valor, "Senha")}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      <p className={`text-[11px] mt-1 ${curta ? "text-destructive" : "text-muted-foreground"}`}>
        {curta ? `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.` : hint ?? `Mínimo de ${SENHA_MIN} caracteres.`}
      </p>
    </div>
  );
}

// ─── Novo usuário ───────────────────────────────────────────
// Só o master cria um login sem empresa no Financeiro (quem só usa o RH, ou terá
// os acessos definidos depois no botão Acessos).
const SEM_EMPRESA = "__sem_empresa__";

function NovoUsuarioDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { empresas, empresaId, isMaster } = useEmpresa();
  const { data: cargos = [] } = useCargos();
  const criar = useCriarUsuario();

  // O admin só cria dentro da empresa que administra (é ela que lhe dá a aba).
  // O master escolhe qualquer uma.
  const disponiveis = useMemo(
    () => (isMaster ? empresas : empresas.filter((e) => e.id === empresaId)),
    [empresas, empresaId, isMaster]
  );

  const vazio = (): NovoUsuarioInput => ({
    email: "", senha: "", nome: "", empresaId: empresaId ?? disponiveis[0]?.id ?? "", papel: "operador",
  });
  const [form, setForm] = useState<NovoUsuarioInput>(vazio);
  const [err, setErr] = useState<string | null>(null);
  const [criado, setCriado] = useState<{ email: string; senha: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setCriado(null);
    criar.reset();
    setForm(vazio());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const salvar = async () => {
    if (!form.nome.trim()) { setErr("Informe o nome da pessoa."); return; }
    if (!form.email.trim()) { setErr("Informe o e-mail de acesso."); return; }
    if (form.senha.length < SENHA_MIN) { setErr(`A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`); return; }
    if (!form.empresaId && !isMaster) { setErr("Escolha a empresa."); return; }
    if (form.empresaId && !form.papel) { setErr("Escolha o cargo."); return; }
    setErr(null);
    try {
      await criar.mutateAsync({ ...form, papel: form.empresaId ? form.papel : null });
      // Guarda para o administrador conseguir copiar e repassar — depois de
      // fechar, ninguém mais vê essa senha (nem o banco guarda em texto).
      setCriado({ email: form.email.trim(), senha: form.senha });
    } catch (e) {
      setErr(msgErro(e, "Erro ao criar o usuário."));
    }
  };

  if (criado) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Login criado</DialogTitle>
            <DialogDescription>
              Anote ou copie agora: esta é a única vez que a senha aparece na tela.
              {isMaster && " Para escolher o que a pessoa vê (Financeiro, RH, Administração), use o botão Acessos na linha dela."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border/70 bg-secondary/30 px-3 py-3 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 break-all">{criado.email}</span>
              <button onClick={() => copiar(criado.email, "E-mail")} title="Copiar e-mail"
                className="text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button>
            </div>
            <div className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 font-numeric break-all">{criado.senha}</span>
              <button onClick={() => copiar(criado.senha, "Senha")} title="Copiar senha"
                className="text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} className="bg-foreground text-background hover:bg-foreground/90">
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!criar.isPending) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Novo usuário</DialogTitle>
          <DialogDescription>
            Cria o login e já vincula à empresa com um cargo. A pessoa entra direto com a senha
            definida aqui — não há e-mail de confirmação.
            {isMaster && " Sem empresa, o login fica sem acesso até você configurar em Acessos (por exemplo, só o RH)."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            <Label className="text-xs">Nome</Label>
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Nome da pessoa" autoFocus />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">E-mail de acesso</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="pessoa@empresa.com.br" autoComplete="off" />
          </div>
          <CampoSenha label="Senha" valor={form.senha} onChange={(senha) => setForm({ ...form, senha })} />
          <div>
            <Label className="text-xs">Empresa</Label>
            <Select
              value={form.empresaId ?? SEM_EMPRESA}
              onValueChange={(v) => setForm({ ...form, empresaId: v === SEM_EMPRESA ? null : v })}
            >
              <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                {disponiveis.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                {isMaster && <SelectItem value={SEM_EMPRESA}>Nenhuma (só RH ou definir depois)</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Cargo</Label>
            <Select value={form.empresaId ? form.papel ?? "" : ""} onValueChange={(v) => setForm({ ...form, papel: v })}
              disabled={!form.empresaId}>
              <SelectTrigger><SelectValue placeholder={form.empresaId ? "Escolha" : "—"} /></SelectTrigger>
              <SelectContent>
                {cargos.map((c) => <SelectItem key={c.chave} value={c.chave}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={criar.isPending}>Cancelar</Button>
          <Button onClick={salvar} disabled={criar.isPending} className="bg-foreground text-background hover:bg-foreground/90">
            {criar.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Criar login
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Editar cadastro (nome, e-mail, senha) ──────────────────
function EditarUsuarioDialog({
  usuario, onClose,
}: {
  usuario: Usuario | null;
  onClose: () => void;
}) {
  const { user, signOut } = useAuth();
  const atualizar = useAtualizarUsuario();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!usuario) return;
    setNome(usuario.nome);
    setEmail(usuario.email);
    setSenha("");
    setErr(null);
    atualizar.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  if (!usuario) return null;
  const euMesmo = user?.id === usuario.userId;

  const mudouNome = nome.trim() !== usuario.nome;
  const mudouEmail = email.trim().toLowerCase() !== usuario.email.toLowerCase();
  const temMudanca = mudouNome || mudouEmail || senha.length > 0;

  const salvar = async () => {
    if (!temMudanca) { setErr("Nada foi alterado."); return; }
    if (senha && senha.length < SENHA_MIN) { setErr(`A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`); return; }
    if (mudouEmail && !email.trim()) { setErr("Informe o e-mail."); return; }
    setErr(null);
    try {
      const r = await atualizar.mutateAsync({
        userId: usuario.userId,
        ...(mudouNome ? { nome: nome.trim() } : {}),
        ...(mudouEmail ? { email: email.trim() } : {}),
        ...(senha ? { senha } : {}),
      });
      onClose();
      if (r.reautenticar) {
        // Trocar o próprio e-mail/senha derruba a sessão no Supabase; sair
        // agora evita a pessoa esbarrar em erro em cada clique seguinte.
        toast.success("Cadastro alterado. Entre de novo com os novos dados.");
        await signOut();
      } else {
        toast.success(`Cadastro de ${nome.trim() || email.trim()} atualizado.`);
      }
    } catch (e) {
      setErr(msgErro(e, "Erro ao alterar o cadastro."));
    }
  };

  return (
    <Dialog open={!!usuario} onOpenChange={(v) => { if (!v && !atualizar.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Editar cadastro</DialogTitle>
          <DialogDescription>
            O e-mail é o login: trocá-lo troca por onde a pessoa entra. A senha só muda se você
            preencher o campo — em branco, fica a que já existe.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da pessoa" autoFocus />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">E-mail de acesso</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            {mudouEmail && (
              <p className="text-[11px] text-primary mt-1">
                O login passa a ser <strong>{email.trim()}</strong>; o antigo deixa de funcionar.
              </p>
            )}
          </div>
          <CampoSenha
            label="Nova senha"
            valor={senha}
            onChange={setSenha}
            hint="Deixe em branco para manter a senha atual."
          />
        </div>

        {euMesmo && (senha || mudouEmail) && (
          <p className="text-[12px] text-muted-foreground bg-secondary/50 rounded-md px-3 py-2 flex items-start gap-2">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Você está alterando o próprio acesso — vai precisar entrar de novo assim que salvar.
          </p>
        )}

        {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={atualizar.isPending}>Cancelar</Button>
          <Button onClick={salvar} disabled={atualizar.isPending || !temMudanca}
            className="bg-foreground text-background hover:bg-foreground/90">
            {atualizar.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Acessos (só master) ────────────────────────────────────
// Quatro chaves por pessoa: Financeiro (cargo em cada empresa), RH (perfil e
// empresas), Gestão (o Dashboard; o cargo Administrador já vê sem precisar
// desta chave) e Administração — Empresas e cargos, que é o acesso total (master):
// quem cria empresas, cargos e acessos consegue dar a si mesmo qualquer acesso.
// O banco aplica as mesmas regras.
const SEM_ACESSO = "__sem_acesso__";

function SecaoAcesso({
  titulo, desc, icone: Icone, ligado, onChange, disabled, children,
}: {
  titulo: string;
  desc: string;
  icone: LucideIcon;
  ligado: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/70">
      <div className="flex items-start gap-3 px-3 py-2.5">
        <Icone className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{titulo}</p>
          <p className="text-[11px] text-muted-foreground">{desc}</p>
        </div>
        <Switch checked={ligado} onCheckedChange={onChange} disabled={disabled} aria-label={titulo} />
      </div>
      {ligado && children && <div className="border-t border-border/70 px-3 py-3 space-y-3">{children}</div>}
    </section>
  );
}

function AcessosDialog({
  usuario, rhAtual, rhDisponivel, gestaoAtual, gestaoDisponivel, onClose,
}: {
  usuario: Usuario | null;
  rhAtual: AcessoRHUsuario | null;
  rhDisponivel: boolean;
  gestaoAtual: boolean;
  gestaoDisponivel: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { empresas, empresasRH, refetchEmpresas } = useEmpresa();
  const { data: cargos = [] } = useCargos();
  const salvar = useSalvarAcessosUsuario();

  const [finLigado, setFinLigado] = useState(false);
  const [fin, setFin] = useState<Record<string, string | null>>({});
  const [rhLigado, setRhLigado] = useState(false);
  const [perfil, setPerfil] = useState("");
  const [todas, setTodas] = useState(true);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [admin, setAdmin] = useState(false);
  const [gestao, setGestao] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Empresas do RH no cadastro + as que a pessoa já tem (mesmo que tenham saído do RH).
  const opcoesRH = useMemo(() => {
    const lista = [...empresasRH];
    for (const e of rhAtual?.empresas ?? []) if (!lista.includes(e)) lista.push(e);
    return lista;
  }, [empresasRH, rhAtual]);

  useEffect(() => {
    if (!usuario) return;
    const mapa: Record<string, string | null> = {};
    for (const e of empresas) mapa[e.id] = usuario.vinculos.find((v) => v.empresaId === e.id)?.papel ?? null;
    setFin(mapa);
    setFinLigado(Object.values(mapa).some(Boolean));
    setRhLigado(!!rhAtual);
    setPerfil(rhAtual?.perfil ?? "");
    setTodas(rhAtual ? rhAtual.empresas === null : true);
    setMarcadas(rhAtual?.empresas ?? []);
    setAdmin(usuario.isMaster);
    setGestao(gestaoAtual);
    setErr(null);
    salvar.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario, rhAtual, gestaoAtual]);

  if (!usuario) return null;
  const ehVoce = user?.id === usuario.userId;
  const descricaoPerfil = PERFIS_RH.find((p) => p.valor === perfil)?.desc;
  const alternar = (empresa: string, marcar: boolean) =>
    setMarcadas((atuais) => (marcar ? [...atuais, empresa] : atuais.filter((e) => e !== empresa)));

  const confirmar = async () => {
    const financeiro: Record<string, string | null> = {};
    for (const e of empresas) financeiro[e.id] = finLigado ? fin[e.id] ?? null : null;
    if (finLigado && !Object.values(financeiro).some(Boolean)) {
      setErr("No Financeiro, escolha o cargo em pelo menos uma empresa (ou desligue o Financeiro).");
      return;
    }
    const escolhidas = opcoesRH.filter((e) => marcadas.includes(e));
    if (rhDisponivel && rhLigado && !todas && escolhidas.length === 0) {
      setErr("No RH, marque pelo menos uma empresa (ou Todas as empresas).");
      return;
    }
    setErr(null);
    try {
      await salvar.mutateAsync({
        usuario,
        financeiro,
        rhAntes: rhAtual,
        rh: !rhDisponivel ? rhAtual : rhLigado ? { perfil: perfil || null, empresas: todas ? null : escolhidas } : null,
        gestaoAntes: gestaoAtual,
        gestao: gestaoDisponivel ? gestao : undefined,
        admin,
      });
      if (ehVoce) await refetchEmpresas();
      onClose();
    } catch (e) {
      setErr(msgErro(e, "Erro ao salvar os acessos."));
    }
  };

  return (
    <Dialog open={!!usuario} onOpenChange={(v) => { if (!v && !salvar.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Acessos de {usuario.nome || usuario.email}</DialogTitle>
          <DialogDescription>
            Ligue só o que a pessoa usa: só o Financeiro, só o RH, os dois — ou a administração, que libera tudo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <SecaoAcesso
            titulo="Financeiro"
            desc="Caixa, extratos, pagamentos e receitas, conforme o cargo em cada empresa."
            icone={Wallet}
            ligado={finLigado}
            onChange={setFinLigado}
          >
            {empresas.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">Nenhuma empresa usa o Financeiro.</p>
            ) : (
              empresas.map((e) => (
                <div key={e.id} className="flex items-center gap-3">
                  <span className="flex-1 min-w-0 truncate text-sm">{e.nome}</span>
                  <Select
                    value={fin[e.id] ?? SEM_ACESSO}
                    onValueChange={(v) => setFin((m) => ({ ...m, [e.id]: v === SEM_ACESSO ? null : v }))}
                  >
                    <SelectTrigger className="w-52 h-9" aria-label={`Cargo em ${e.nome}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SEM_ACESSO}>Sem acesso</SelectItem>
                      {cargos.map((c) => <SelectItem key={c.chave} value={c.chave}>{c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))
            )}
            <p className="text-[11px] text-muted-foreground">O que cada cargo pode fazer é definido em Empresas e cargos.</p>
          </SecaoAcesso>

          {rhDisponivel && (
            <SecaoAcesso
              titulo="RH"
              desc="Funcionários, folha, recrutamento e pagamento diário."
              icone={Users}
              ligado={rhLigado}
              onChange={setRhLigado}
            >
              <div>
                <Label className="text-xs">Perfil no RH</Label>
                <Select value={perfil || "admin"} onValueChange={(v) => setPerfil(v === "admin" ? "" : v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PERFIS_RH.map((p) => (
                      <SelectItem key={p.valor || "admin"} value={p.valor || "admin"}>{p.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {descricaoPerfil && <p className="text-[11px] text-muted-foreground mt-1">{descricaoPerfil}</p>}
              </div>
              <div>
                <Label className="text-xs">Empresas no RH</Label>
                <div className="mt-1.5 rounded-lg border border-border/70 divide-y divide-border">
                  <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer">
                    <Checkbox checked={todas} onCheckedChange={(v) => setTodas(!!v)} aria-label="Todas as empresas" />
                    <span className="text-sm font-medium">Todas as empresas</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">inclui as criadas depois</span>
                  </label>
                  {opcoesRH.map((e) => (
                    <label key={e} className={`flex items-center gap-2.5 px-3 py-2 ${todas ? "opacity-50" : "cursor-pointer"}`}>
                      <Checkbox
                        checked={todas || marcadas.includes(e)}
                        disabled={todas}
                        onCheckedChange={(v) => alternar(e, !!v)}
                        aria-label={e}
                      />
                      <span className="text-sm">{e}</span>
                      {!empresasRH.includes(e) && <span className="ml-auto text-[11px] text-muted-foreground">fora do RH</span>}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Com empresas marcadas, a pessoa troca entre elas no topo do RH e não vê “Todas as empresas”
                  — nem os registros sem empresa (ex.: extratos da contabilidade ainda sem funcionário).
                </p>
              </div>
            </SecaoAcesso>
          )}

          {gestaoDisponivel && (
            <SecaoAcesso
              titulo="Gestão"
              desc="O Dashboard da Gestão (previsão, entradas e saídas, análises). Quem tem o cargo Administrador já vê — ligue para liberar a outra pessoa."
              icone={BarChart3}
              ligado={gestao}
              onChange={setGestao}
            >
              <p className="text-[12px] text-muted-foreground">
                Vale nas empresas em que a pessoa tem acesso ao Financeiro.
                {Object.values(fin).some((c) => c === "admin") && " Ela já é Administradora em pelo menos uma empresa: lá a Gestão aparece de qualquer jeito."}
              </p>
            </SecaoAcesso>
          )}

          <SecaoAcesso
            titulo="Administração — Empresas e cargos"
            desc="Acesso total: cria empresas, cargos e acessos, e vê tudo no Financeiro e no RH. Só para quem administra o sistema."
            icone={ShieldCheck}
            ligado={admin}
            onChange={setAdmin}
            disabled={ehVoce && admin}
          >
            <p className="text-[12px] text-muted-foreground">
              {ehVoce
                ? "Você não pode tirar a sua própria administração."
                : "Enquanto a administração estiver ligada, a pessoa vê tudo. Os acessos acima ficam guardados e voltam a valer se ela for desligada."}
            </p>
          </SecaoAcesso>

          {!finLigado && !rhLigado && !admin && (
            <p className="text-[12px] text-warning-ink bg-warning/10 rounded-md px-3 py-2">
              Sem nenhum acesso ligado, a pessoa consegue entrar, mas não vê nada.
            </p>
          )}
        </div>

        {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button onClick={confirmar} disabled={salvar.isPending} className="bg-foreground text-background hover:bg-foreground/90">
            {salvar.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Salvar acessos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Ao lado dos cargos: liberado para a Gestão sem ser Administrador.
function BadgeAcessoGestao() {
  return (
    <Badge variant="outline" className="bg-primary/10 border-0 font-medium text-[10px] text-primary"
      title="Liberado para a Gestão (Dashboard)">
      Gestão
    </Badge>
  );
}

// Ao lado dos cargos: quem entra no RH e com que alcance (o master entra sempre).
function BadgeAcessoRH({ acesso }: { acesso: AcessoRHUsuario | undefined }) {
  if (!acesso) return null;
  return (
    <Badge variant="outline" className="bg-primary/10 border-0 font-medium text-[10px] text-primary"
      title="Acesso ao RH (perfil · empresas)">
      RH · {nomePerfilRH(acesso.perfil)} · {acesso.empresas?.join(", ") ?? "todas"}
    </Badge>
  );
}

// ─── Excluir login (só master) ──────────────────────────────
// O login deixa de existir, mas nada do que a pessoa fez some: o histórico do
// Pix, do RH e o registro de alterações continuam, e a própria exclusão fica
// registrada com o que ela tinha.
function ExcluirUsuarioDialog({
  usuario, rhAtual, nomeCargo, onClose,
}: {
  usuario: Usuario | null;
  rhAtual: AcessoRHUsuario | null;
  nomeCargo: (chave: string) => string;
  onClose: () => void;
}) {
  const excluir = useExcluirUsuario();
  const [motivo, setMotivo] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!usuario) return;
    setMotivo("");
    setConfirmacao("");
    setErr(null);
    excluir.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  if (!usuario) return null;
  const confere = confirmacao.trim().toLowerCase() === usuario.email.toLowerCase();

  const confirmar = async () => {
    if (!confere) return;
    setErr(null);
    try {
      await excluir.mutateAsync({ userId: usuario.userId, motivo: motivo.trim() });
      toast.success(`Login de ${usuario.nome || usuario.email} excluído. O registro de alterações foi mantido.`);
      onClose();
    } catch (e) {
      setErr(msgErro(e, "Erro ao excluir o login."));
    }
  };

  return (
    <Dialog open={!!usuario} onOpenChange={(v) => { if (!v && !excluir.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Excluir o login de {usuario.nome || usuario.email}?</DialogTitle>
          <DialogDescription>
            A pessoa perde o acesso na hora e o login deixa de existir. O <strong>registro de alterações
            é mantido</strong>: o histórico do Pix, do RH e deste cadastro continua mostrando o que ela fez, e
            esta exclusão fica registrada com os acessos abaixo.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border/70 bg-secondary/30 px-3 py-2.5 text-sm space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Acessos que serão retirados</p>
          <p>
            <span className="text-muted-foreground">Financeiro: </span>
            {usuario.vinculos.length === 0
              ? "nenhum"
              : usuario.vinculos.map((v) => `${v.empresa} (${nomeCargo(v.papel)})`).join(", ")}
          </p>
          <p>
            <span className="text-muted-foreground">RH: </span>
            {rhAtual ? `${nomePerfilRH(rhAtual.perfil)} · ${rhAtual.empresas?.join(", ") ?? "todas as empresas"}` : "sem acesso"}
          </p>
          <p>
            <span className="text-muted-foreground">Administração: </span>
            {usuario.isMaster ? "sim" : "não"}
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Motivo (opcional, fica no registro)</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
              placeholder="Ex.: saiu da empresa" />
          </div>
          <div>
            <Label className="text-xs">Para confirmar, digite o e-mail: <strong>{usuario.email}</strong></Label>
            <Input value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} autoComplete="off"
              aria-label="Confirmar e-mail" />
          </div>
        </div>

        {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={excluir.isPending}>Cancelar</Button>
          <Button variant="destructive" onClick={confirmar} disabled={!confere || excluir.isPending}>
            {excluir.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Excluir login
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Registro de alterações (só master) ─────────────────────
const ACOES_USUARIO: Record<AcaoHistoricoUsuario, { label: string; classe: string }> = {
  criado: { label: "Login criado", classe: "bg-success/10 text-success" },
  alterado: { label: "Cadastro alterado", classe: "bg-primary/10 text-primary" },
  acesso_financeiro: { label: "Financeiro", classe: "bg-secondary text-foreground" },
  acesso_rh: { label: "RH", classe: "bg-secondary text-foreground" },
  acesso_gestao: { label: "Gestão", classe: "bg-secondary text-foreground" },
  administracao: { label: "Administração", classe: "bg-warning/10 text-warning-ink" },
  excluido: { label: "Login excluído", classe: "bg-destructive/10 text-destructive" },
};

type Obj = Record<string, unknown>;
const texto = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const rhTexto = (v: unknown) => {
  if (!v || typeof v !== "object") return "sem RH";
  const r = v as { perfil?: string | null; empresas?: string[] | null };
  return `${nomePerfilRH(r.perfil ?? "")} · ${r.empresas?.join(", ") ?? "todas as empresas"}`;
};

// Frases do que aconteceu, a partir dos detalhes gravados.
function descreverHistorico(h: HistoricoUsuario): string[] {
  const d = h.detalhes as Obj;
  switch (h.acao) {
    case "criado": {
      const fin = d.financeiro as Obj | null;
      return [fin ? `Com o cargo ${texto(fin.cargo)} na ${texto(fin.empresa)}` : "Sem empresa no Financeiro"];
    }
    case "alterado": {
      const linhas: string[] = [];
      const nome = d.nome as Obj | undefined;
      const email = d.email as Obj | undefined;
      if (nome) linhas.push(`Nome: ${texto(nome.antes)} → ${texto(nome.depois)}`);
      if (email) linhas.push(`E-mail: ${texto(email.antes)} → ${texto(email.depois)}`);
      if (d.senha) linhas.push("Senha trocada");
      return linhas.length ? linhas : ["Cadastro alterado"];
    }
    case "acesso_financeiro": {
      const empresa = texto(d.empresa ?? "empresa excluída");
      if (!d.antes) return [`Entrou na ${empresa} com o cargo ${texto(d.depois)}`];
      if (!d.depois) return [`Saiu da ${empresa} (era ${texto(d.antes)})`];
      return [`${empresa}: ${texto(d.antes)} → ${texto(d.depois)}`];
    }
    case "acesso_rh":
      if (!d.antes) return [`RH liberado: ${rhTexto(d.depois)}`];
      if (!d.depois) return [`RH retirado (era ${rhTexto(d.antes)})`];
      return [`${rhTexto(d.antes)} → ${rhTexto(d.depois)}`];
    case "acesso_gestao":
      return [d.depois ? "Gestão liberada" : "Gestão retirada"];
    case "administracao":
      return [d.depois ? "Administração ligada" : "Administração desligada"];
    case "excluido": {
      const fin = (d.financeiro as Obj[] | undefined) ?? [];
      const linhas = [
        `Tinha — Financeiro: ${fin.length ? fin.map((f) => `${texto(f.empresa)} (${texto(f.cargo)})`).join(", ") : "nenhum"}`,
        `RH: ${rhTexto(d.rh)} · Administração: ${d.administracao ? "sim" : "não"}`,
      ];
      if (d.motivo) linhas.push(`Motivo: ${String(d.motivo)}`);
      return linhas;
    }
    default:
      return [];
  }
}

function HistoricoUsuarios() {
  const { data, isLoading, error } = useHistoricoUsuarios(true);
  const [busca, setBusca] = useState("");
  const itens = useMemo(() => {
    const lista = data?.itens ?? [];
    const s = busca.trim().toLowerCase();
    if (!s) return lista;
    return lista.filter((h) =>
      h.nome.toLowerCase().includes(s) || h.email.toLowerCase().includes(s) || h.autorEmail.toLowerCase().includes(s) ||
      descreverHistorico(h).join(" ").toLowerCase().includes(s)
    );
  }, [data, busca]);

  const baixar = () => exportToXlsx({
    filename: "usuarios-registro-de-alteracoes",
    sheets: [{
      name: "Registro",
      columns: ["Quando", "Pessoa", "E-mail", "Ação", "O que mudou", "Quem fez"],
      rows: itens.map((h) => [
        fmtDataHora(h.ocorridoEm), h.nome, h.email, ACOES_USUARIO[h.acao]?.label ?? h.acao,
        descreverHistorico(h).join(" | "), h.autorEmail || "—",
      ]),
    }],
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando registro...</div>;
  }
  if (error) {
    return (
      <Card className="card-elevated border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive flex items-start gap-2">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />{msgErro(error, "Erro ao carregar o registro de alterações.")}
      </Card>
    );
  }
  if (!data?.disponivel) {
    return (
      <Card className="card-elevated border-border/70 p-6 text-sm text-muted-foreground">
        O registro de alterações ainda não existe no banco. Rode supabase/46_historico_usuarios.sql.
      </Card>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar pessoa, quem fez ou mudança..." className="pl-8 h-9"
            value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Ninguém edita nem apaga este registro — nem quando o login é excluído.
        </p>
        <Button variant="outline" size="sm" className="h-8 ml-auto" onClick={baixar} disabled={itens.length === 0}>
          <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />Excel
        </Button>
      </div>

      <Card className="card-elevated border-border/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Quando</th>
                <th className="text-left px-5 py-3 font-medium">Pessoa</th>
                <th className="text-left px-5 py-3 font-medium">O que aconteceu</th>
                <th className="text-left px-5 py-3 font-medium">Quem fez</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {itens.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-14 text-center text-muted-foreground">
                    {busca.trim() ? <>Nada encontrado para “{busca}”.</> : "Nenhuma alteração registrada ainda."}
                  </td>
                </tr>
              ) : (
                itens.map((h) => {
                  const a = ACOES_USUARIO[h.acao] ?? { label: h.acao, classe: "bg-secondary" };
                  return (
                    <tr key={h.id} className="align-top hover:bg-secondary/20">
                      <td className="px-5 py-3 font-numeric tabular-nums whitespace-nowrap text-muted-foreground">{fmtDataHora(h.ocorridoEm)}</td>
                      <td className="px-5 py-3">
                        <div className="font-medium">{h.nome || "—"}</div>
                        <div className="text-[11px] text-muted-foreground break-all">{h.email}</div>
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant="outline" className={`border-0 font-medium text-[11px] ${a.classe}`}>{a.label}</Badge>
                        <ul className="mt-1 space-y-0.5">
                          {descreverHistorico(h).map((linha) => <li key={linha} className="text-[12px]">{linha}</li>)}
                        </ul>
                      </td>
                      <td className="px-5 py-3 text-[12px] text-muted-foreground break-all">{h.autorEmail || "—"}</td>
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

// ─── Página ─────────────────────────────────────────────────
export function Usuarios() {
  const { isMaster, papel, papelNome } = useEmpresa();
  const { data: cargos = [] } = useCargos();
  const autorizado = podeGerirUsuarios(isMaster, papel);
  const { data: usuarios = [], isLoading, error } = useUsuarios(autorizado);
  const { data: acessosRH } = useAcessosRH(isMaster);
  const verRH = isMaster && !!acessosRH?.disponivel;
  const acessoDe = (userId: string) => acessosRH?.itens.find((a) => a.userId === userId);
  const { data: acessosGestao } = useAcessosGestao(isMaster);
  const gestaoDe = (userId: string) => !!acessosGestao?.ids.has(userId);
  const [acessosDe, setAcessosDe] = useState<Usuario | null>(null);
  const [excluindo, setExcluindo] = useState<Usuario | null>(null);
  const [aba, setAba] = useState("logins");
  const { user } = useAuth();

  const [search, setSearch] = useState("");
  const [novoOpen, setNovoOpen] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);

  const nomeCargo = (chave: string) => cargos.find((c) => c.chave === chave)?.nome ?? chave;

  const filtrados = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return usuarios;
    return usuarios.filter((u) =>
      u.nome.toLowerCase().includes(s) ||
      u.email.toLowerCase().includes(s) ||
      u.vinculos.some((v) => v.empresa.toLowerCase().includes(s))
    );
  }, [usuarios, search]);

  if (!autorizado) {
    return (
      <AppShell title="Usuários" subtitle="Cadastro dos logins">
        <Card className="card-elevated border-border/70 p-8 text-center max-w-md mx-auto">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-secondary grid place-items-center mb-3">
            <ShieldAlert className="h-5 w-5 text-muted-foreground" />
          </div>
          <h3 className="font-display text-lg font-semibold">Acesso restrito</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Só o master e os administradores alteram o cadastro dos usuários.
            Seu cargo é <strong>{papelNome}</strong>.
          </p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Usuários"
      subtitle="Nome, e-mail e senha dos logins do sistema"
      actions={
        <Button onClick={() => setNovoOpen(true)} className="h-9 bg-foreground text-background hover:bg-foreground/90">
          <Plus className="h-4 w-4 mr-1.5" />Novo usuário
        </Button>
      }
    >
      <Card className="p-3 card-elevated border-primary/20 bg-primary/5 mb-5">
        <p className="text-xs text-muted-foreground flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
          <span>
            {isMaster
              ? <>Como master, você vê e altera <strong className="text-foreground">todos</strong> os logins.</>
              : <>Como administrador, você vê os logins das empresas que administra — <strong className="text-foreground">nunca</strong> os do master.</>}
            {" "}A nova senha vale na hora e não é enviada por e-mail: combine com a pessoa.
            O cargo de cada um continua sendo definido em <strong className="text-foreground">Configurações › Empresas e cargos</strong>.
            {isMaster && <> No botão <strong className="text-foreground">Acessos</strong> de cada linha você escolhe o que a pessoa vê: Financeiro, RH e/ou Administração (Empresas e cargos).</>}
          </span>
        </p>
      </Card>

      <Tabs value={aba} onValueChange={setAba}>
      {isMaster && (
        <TabsList className="mb-4">
          <TabsTrigger value="logins" className="gap-1.5"><Users className="h-3.5 w-3.5" />Logins</TabsTrigger>
          <TabsTrigger value="historico" className="gap-1.5"><History className="h-3.5 w-3.5" />Registro de alterações</TabsTrigger>
        </TabsList>
      )}
      <TabsContent value="logins">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar nome, e-mail ou empresa..." className="pl-8 h-9"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="text-xs text-muted-foreground">
          {usuarios.length} {usuarios.length === 1 ? "login" : "logins"}
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando usuários...
        </div>
      ) : error ? (
        <Card className="card-elevated border-destructive/30 bg-destructive/5 p-6 text-sm">
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>{msgErro(error, "Erro ao carregar os usuários.")}</div>
          </div>
        </Card>
      ) : (
        <Card className="card-elevated border-border/70 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Nome</th>
                  <th className="text-left px-5 py-3 font-medium">E-mail (login)</th>
                  <th className="text-left px-5 py-3 font-medium">{isMaster ? "Acessos" : "Empresas e cargos"}</th>
                  <th className="text-left px-5 py-3 font-medium">Último acesso</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtrados.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-14 text-center text-muted-foreground">
                      {usuarios.length === 0
                        ? <>Nenhum login para gerenciar. Clique em <strong>Novo usuário</strong> para criar o primeiro.</>
                        : <>Nenhum usuário encontrado para “{search}”.</>}
                    </td>
                  </tr>
                ) : (
                  filtrados.map((u) => (
                    <tr key={u.userId} className="hover:bg-secondary/30 group">
                      <td className="px-5 py-3 font-medium">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-md bg-secondary grid place-items-center shrink-0 text-[11px] font-semibold uppercase">
                            {(u.nome || u.email).slice(0, 2)}
                          </div>
                          <span>{u.nome || <span className="text-muted-foreground font-normal">sem nome</span>}</span>
                          {u.isMaster && (
                            <Badge variant="outline" className="bg-primary/10 border-0 text-[10px] font-medium text-primary gap-1">
                              <ShieldCheck className="h-3 w-3" />master
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="whitespace-nowrap">{u.email}</span>
                          <button onClick={() => copiar(u.email, "E-mail")} title="Copiar e-mail"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0">
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        {u.vinculos.length === 0 ? (
                          <span className="text-muted-foreground text-[12px]">sem empresa</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {u.vinculos.map((v) => (
                              <Badge key={v.empresaId} variant="outline" className="bg-secondary border-0 font-medium text-[10px] whitespace-nowrap">
                                {v.empresa} · {nomeCargo(v.papel)}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {isMaster && !u.isMaster && (acessoDe(u.userId) || gestaoDe(u.userId)) && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {verRH && <BadgeAcessoRH acesso={acessoDe(u.userId)} />}
                            {gestaoDe(u.userId) && <BadgeAcessoGestao />}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground font-numeric tabular-nums text-[12px] whitespace-nowrap">
                        {u.ultimoLogin ? fmtDataHora(u.ultimoLogin) : "nunca entrou"}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {isMaster && (
                          <Button size="sm" variant="ghost" onClick={() => setAcessosDe(u)} title="Acessos"
                            className="h-7 gap-1.5 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            <span className="text-xs">Acessos</span>
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setEditando(u)} title="Editar cadastro"
                          className="h-7 gap-1.5 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="text-xs">Editar</span>
                        </Button>
                        {isMaster && u.userId !== user?.id && (
                          <Button size="sm" variant="ghost" onClick={() => setExcluindo(u)} title="Excluir login"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mt-4 flex items-start gap-2 text-[11px] text-muted-foreground">
        <UserPlus className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          Criar, alterar e excluir login passa pela função <strong>/api/usuarios</strong> na Vercel, que fala com a
          Admin API do Supabase. Se ela reclamar de variável de ambiente, elas ficam em
          Settings › Environments › Production — e só valem depois de um deploy novo.
        </span>
      </div>
      </TabsContent>
      {isMaster && (
        <TabsContent value="historico">
          <HistoricoUsuarios />
        </TabsContent>
      )}
      </Tabs>

      <NovoUsuarioDialog open={novoOpen} onOpenChange={setNovoOpen} />
      <EditarUsuarioDialog usuario={editando} onClose={() => setEditando(null)} />
      <AcessosDialog
        usuario={acessosDe}
        rhAtual={acessosDe ? acessoDe(acessosDe.userId) ?? null : null}
        rhDisponivel={!!acessosRH?.disponivel}
        gestaoAtual={acessosDe ? gestaoDe(acessosDe.userId) : false}
        gestaoDisponivel={!!acessosGestao?.disponivel}
        onClose={() => setAcessosDe(null)}
      />
      <ExcluirUsuarioDialog
        usuario={excluindo}
        rhAtual={excluindo ? acessoDe(excluindo.userId) ?? null : null}
        nomeCargo={nomeCargo}
        onClose={() => setExcluindo(null)}
      />
    </AppShell>
  );
}
