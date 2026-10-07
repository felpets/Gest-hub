import { createContext, ReactNode, useContext, useEffect } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LogOut, Loader2, Building2, ChevronsUpDown, Check, Sun, Moon, ShieldAlert,
  ChevronRight, FlaskConical, Settings, Users,
} from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { useEmpresa } from "@/lib/empresa";
import { podeAcessar, primeiraRotaPermitida, temAlguma, type Capacidade } from "@/lib/permissoes";
import { useTheme } from "@/lib/theme";
import { isMock } from "@/lib/supabase";
import { MENU, pilarDaRota } from "@/lib/navegacao";
import { useAcessoRH } from "@/modulos/rh/acesso";
import { SeletorConta } from "@/components/seletor-conta";
import { CascaCelular } from "@/components/CascaCelular";
import { useEhCelular } from "@/lib/tela";

// ─── Tela antiga dentro de uma aba ──────────────────────────────────────────
// As telas herdadas (Movimentações, Contas a Pagar…) continuam chamando
// <AppShell title actions>. Dentro de uma tela consolidada, o AppShell vira só
// a linha de contexto da aba (descrição + ações); o shell de verdade é o da
// página que as agrupa. `caps` = capacidades exigidas pela aba.
type EmbutidoCtx = { caps?: readonly Capacidade[] };
const ShellEmbutidoContext = createContext<EmbutidoCtx | null>(null);

export function TelaEmbutida({ caps, children }: { caps?: readonly Capacidade[]; children: ReactNode }) {
  return <ShellEmbutidoContext.Provider value={{ caps }}>{children}</ShellEmbutidoContext.Provider>;
}

function AcessoRestrito({ papelNome, destino, podeIr }: { papelNome: string; destino: string; podeIr: boolean }) {
  const navigate = useNavigate();
  return (
    <Card className="card-elevated border-border/70 p-8 text-center max-w-md mx-auto mt-6">
      <div className="mx-auto h-12 w-12 rounded-2xl bg-secondary grid place-items-center mb-3">
        <ShieldAlert className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="font-display text-lg font-semibold">Acesso restrito</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Seu cargo de <strong>{papelNome}</strong> não tem acesso a esta página.
        Fale com o administrador se precisar de mais permissões.
      </p>
      {/* Manda para uma página que o cargo abre de verdade — "/" pode
          estar bloqueado também, e aí o botão não levaria a lugar nenhum. */}
      {podeIr && (
        <button
          onClick={() => navigate({ to: destino })}
          className="mt-5 inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-secondary"
        >
          Ir para uma página do meu cargo
        </button>
      )}
    </Card>
  );
}

// Alterna claro/escuro. O ícone reflete o tema atual; o clique persiste a escolha.
function ThemeToggle() {
  const { isDark, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={isDark ? "Modo claro" : "Modo escuro"}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      className="h-9 w-9 grid place-items-center rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
    >
      {isDark ? <Sun className="h-[18px] w-[18px] stroke-[1.6]" /> : <Moon className="h-[18px] w-[18px] stroke-[1.6]" />}
    </button>
  );
}

// Seletor de empresa: quem tem acesso a mais de uma empresa (master ou membro
// vinculado a várias) pode trocar; com uma só, mostra o nome fixo.
function SeletorEmpresa() {
  const { empresas, empresaId, trocarEmpresa } = useEmpresa();
  const ativa = empresas.find((e) => e.id === empresaId);
  const podeTrocar = empresas.length > 1;

  if (!ativa) return null;

  if (!podeTrocar) {
    return (
      <div className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-lg bg-secondary/60 text-sm font-medium">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="max-w-[160px] truncate">{ativa.nome}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Empresa ativa no Financeiro"
        className="flex items-center gap-2 h-9 px-3 rounded-lg bg-secondary/60 hover:bg-secondary text-sm font-medium transition-colors"
      >
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="max-w-[160px] truncate">{ativa.nome}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Empresa ativa (Financeiro)</DropdownMenuLabel>
        {empresas.map((e) => (
          <DropdownMenuItem key={e.id} onClick={() => trocarEmpresa(e.id)} className="gap-2">
            <Check className={`h-4 w-4 ${e.id === empresaId ? "opacity-100" : "opacity-0"}`} />
            <span className="truncate">{e.nome}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// No RH, a mesma ideia do Financeiro: uma empresa ativa no topo e o módulo
// mostrando só ela. Quem tem o RH sem restrição também pode ver todas juntas
// (é a visão que o fechamento da competência da folha exige).
function SeletorEmpresaRH() {
  const { empresasRH, rhPodeTodas, trocarEmpresaRH } = useEmpresa();
  const { empresa, restrita } = useAcessoRH();
  const rotulo = empresa || "Todas as empresas";
  const opcoes = empresasRH.length + (rhPodeTodas ? 1 : 0);

  if (opcoes <= 1) {
    return (
      <div
        title={restrita ? `Seu acesso ao RH é só da ${empresa}` : undefined}
        className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-lg bg-secondary/60 text-sm font-medium"
      >
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="max-w-[160px] truncate">{rotulo}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Empresa ativa no RH"
        className="flex items-center gap-2 h-9 px-3 rounded-lg bg-secondary/60 hover:bg-secondary text-sm font-medium transition-colors"
      >
        {empresa ? <Building2 className="h-4 w-4 text-muted-foreground" /> : <Users className="h-4 w-4 text-muted-foreground" />}
        <span className="max-w-[160px] truncate">{rotulo}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Empresa ativa (RH)</DropdownMenuLabel>
        {empresasRH.map((nome) => (
          <DropdownMenuItem key={nome} onClick={() => trocarEmpresaRH(nome)} className="gap-2">
            <Check className={`h-4 w-4 ${nome === empresa ? "opacity-100" : "opacity-0"}`} />
            <span className="truncate">{nome}</span>
          </DropdownMenuItem>
        ))}
        {rhPodeTodas && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => trocarEmpresaRH("")} className="gap-2 items-start">
              <Check className={`h-4 w-4 mt-0.5 ${empresa ? "opacity-0" : "opacity-100"}`} />
              <span>
                <span className="block">Todas as empresas</span>
                <span className="block text-[11px] text-muted-foreground">Para fechar a folha da competência</span>
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Configurações: uma área só para o sistema inteiro, no canto superior direito
// (antes eram itens espalhados pelo menu lateral).
function BotaoConfiguracoes() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const ativo = path === "/configuracoes";
  return (
    <Link
      to="/configuracoes"
      title="Configurações"
      aria-label="Configurações"
      aria-current={ativo ? "page" : undefined}
      className={`h-9 w-9 grid place-items-center rounded-lg transition-colors hover:bg-secondary ${
        ativo ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Settings className="h-[18px] w-[18px] stroke-[1.6]" />
    </Link>
  );
}

function Trilha({ path, title }: { path: string; title: string }) {
  const pilar = pilarDaRota(path);
  // Configurações valem para o sistema inteiro — não são uma tela da Gestão.
  const nome = path.startsWith("/configuracoes") ? "Sistema" : MENU.find((m) => m.pilar === pilar)?.titulo ?? "";
  return (
    <nav aria-label="Você está em" className="hidden md:flex items-center gap-1.5 ml-1 min-w-0 text-sm">
      <span className="text-muted-foreground">{nome}</span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
      <span className="font-medium truncate">{title}</span>
    </nav>
  );
}

export function AppShell({
  title,
  subtitle,
  actions,
  tabs,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  tabs?: ReactNode;
  children: ReactNode;
}) {
  const embutido = useContext(ShellEmbutidoContext);
  if (embutido) {
    return <ConteudoEmbutido caps={embutido.caps} subtitle={subtitle} actions={actions}>{children}</ConteudoEmbutido>;
  }
  return <ShellCompleto title={title} subtitle={subtitle} actions={actions} tabs={tabs}>{children}</ShellCompleto>;
}

function ConteudoEmbutido({ caps: capsAba, subtitle, actions, children }: { caps?: readonly Capacidade[]; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const { caps, papelNome } = useEmpresa();
  const liberado = temAlguma(caps, capsAba);
  const destino = primeiraRotaPermitida(caps);
  return (
    <div className="min-w-0">
      {(subtitle || (actions && liberado)) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          {subtitle ? <p className="text-sm text-muted-foreground max-w-3xl">{subtitle}</p> : <span />}
          {actions && liberado && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {liberado ? children : <AcessoRestrito papelNome={papelNome} destino={destino} podeIr={podeAcessar(caps, destino)} />}
    </div>
  );
}

function ShellCompleto({ title, subtitle, actions, tabs, children }: { title: string; subtitle?: string; actions?: ReactNode; tabs?: ReactNode; children: ReactNode }) {
  const navigate = useNavigate();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const temAbaNaUrl = useRouterState({ select: (r) => "aba" in ((r.location.search ?? {}) as Record<string, unknown>) });
  const { user, loading, signOut } = useAuth();
  const { loading: empLoading, semEmpresa, caps, papelNome } = useEmpresa();
  const pilar = pilarDaRota(path);
  // Janela estreita (celular, ou o APK) usa a casca de app. Tem de ser lido
  // aqui em cima: abaixo há returns antecipados, e hook não pode ficar depois.
  const celular = useEhCelular();

  // Protege a rota: sem sessão → manda pro login.
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  // Guarda por cargo: bloqueia acesso direto por URL a páginas fora do cargo.
  const bloqueado = !podeAcessar(caps, path);
  const destinoLivre = primeiraRotaPermitida(caps);

  // O login sempre cai em "/" (Dashboard da Gestão). Cargos que não usam o
  // Dashboard (ex.: só Pix, ou só RH) vão direto para a casa deles. Só vale na
  // entrada "limpa": um link para uma aba do Dashboard (?aba=) é respeitado.
  useEffect(() => {
    if (!empLoading && path === "/" && !temAbaNaUrl && destinoLivre !== "/") {
      navigate({ to: destinoLivre, replace: true });
    }
  }, [empLoading, path, temAbaNaUrl, destinoLivre, navigate]);

  // Enquanto resolve a sessão (ou já redirecionando), não renderiza o painel.
  if (loading || !user || empLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Logado mas sem empresa vinculada: bloqueia com aviso (não vaza nenhum dado).
  if (semEmpresa) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-secondary grid place-items-center mb-3">
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="font-display text-xl font-semibold">Acesso sem empresa</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Seu login ainda não está vinculado a nenhuma empresa. Peça ao administrador para vincular seu acesso.
          </p>
          <button
            onClick={() => { signOut(); navigate({ to: "/login" }); }}
            className="mt-5 inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-secondary"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  // Nome amigável: o do cadastro; sem ele, a parte local do e-mail.
  const email = user.email ?? "";
  const nomeCadastro = typeof user.user_metadata?.nome === "string" ? (user.user_metadata.nome as string) : "";
  const nome = nomeCadastro || email.split("@")[0] || "Usuário";
  const iniciais = (nome.match(/\p{L}+/gu) ?? ["U"]).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  // ─── Celular: mesma guarda acima, outro desenho ───
  // Tudo o que decide acesso já rodou; daqui para baixo é só aparência.
  if (celular) {
    return (
      <CascaCelular
        title={title}
        subtitle={subtitle}
        actions={actions}
        tabs={tabs}
        seletorEmpresa={
          pilar === "rh" ? (
            <SeletorEmpresaRH />
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <SeletorEmpresa />
              {pilar === "financeiro" && <SeletorConta />}
            </div>
          )
        }
        bloqueado={bloqueado}
        nome={nome}
        papelNome={papelNome}
      >
        {bloqueado ? (
          <AcessoRestrito papelNome={papelNome} destino={destinoLivre} podeIr={podeAcessar(caps, destinoLivre)} />
        ) : (
          children
        )}
      </CascaCelular>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 backdrop-blur-xl px-4 sm:px-6">
            <SidebarTrigger className="-ml-1" />
            <Trilha path={path} title={title} />
            <div className="ml-auto flex items-center gap-2">
              {isMock && (
                <span
                  title="Protótipo: todas as informações são fictícias e nada é gravado no Supabase real."
                  className="hidden xl:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-primary/30 bg-primary/10 text-[11px] font-semibold uppercase tracking-wider text-primary"
                >
                  <FlaskConical className="h-3.5 w-3.5" /> Protótipo · dados fictícios
                </span>
              )}
              {pilar === "rh" ? <SeletorEmpresaRH /> : (
                <>
                  <SeletorEmpresa />
                  {pilar === "financeiro" && <SeletorConta />}
                </>
              )}
              <ThemeToggle />
              <BotaoConfiguracoes />
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2.5 pl-2 pr-1 py-1 rounded-lg hover:bg-secondary transition-colors outline-none">
                  <div className="hidden sm:flex flex-col items-end leading-tight">
                    <span className="text-xs font-medium">{nome}</span>
                    <span className="text-[10px] text-muted-foreground">{papelNome}</span>
                  </div>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-foreground text-background text-xs font-semibold">{iniciais}</AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="font-normal">
                    <p className="text-sm font-medium truncate">{nome}</p>
                    <p className="text-xs text-muted-foreground truncate">{email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="gap-2">
                    <LogOut className="h-4 w-4" /> Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <div className="px-4 sm:px-8 pt-7 border-b border-border/60">
            <div className={`flex flex-wrap items-end justify-between gap-4 ${tabs && !bloqueado ? "pb-4" : "pb-5"}`}>
              <div className="min-w-0">
                <h1 className="font-display text-2xl sm:text-[28px] font-bold tracking-tight">{title}</h1>
                {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
              </div>
              {/* flex-wrap: com 4 ou 5 botões (filtro, conta, exportações) a linha
                  não cabe em 390 px e empurrava a página para o lado. */}
              {actions && !bloqueado && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
            {tabs && !bloqueado && <div className="-mb-px">{tabs}</div>}
          </div>

          <main className="flex-1 min-w-0 px-4 sm:px-8 py-6 sm:py-8">
            {bloqueado ? (
              <AcessoRestrito papelNome={papelNome} destino={destinoLivre} podeIr={podeAcessar(caps, destinoLivre)} />
            ) : (
              children
            )}
          </main>
          <footer className="px-4 sm:px-8 py-4 border-t border-border/60 text-[11px] text-muted-foreground flex flex-wrap items-center justify-between gap-2">
            <span>Finance HUB · Financeiro · RH · Gestão</span>
            {isMock && <span>Protótipo com dados fictícios — o Supabase real não é acessado</span>}
          </footer>
        </div>
      </div>
    </SidebarProvider>
  );
}
