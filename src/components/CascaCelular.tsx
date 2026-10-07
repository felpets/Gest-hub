// ─── A casca de celular ─────────────────────────────────────────────────────
// O mesmo Hub, com o desenho de app: cabeçalho enxuto no topo e barra de
// navegação embaixo, no lugar do menu lateral e do cabeçalho de computador.
// Entra quando a janela é estreita (ver src/lib/tela.ts) — no APK Android e no
// site aberto num celular.
//
// Quem decide QUANDO trocar é o AppShell: esta casca é só a aparência. Sessão,
// empresa e as guardas de cargo continuam todas lá, calculadas uma vez só —
// assim não existe a chance de o desenho novo esquecer uma checagem que o
// antigo fazia.
//
// A barra de baixo respeita o cargo: quem não pode abrir uma tela não vê o
// atalho dela. "Mais" abre o menu inteiro, também filtrado, com as ações que no
// computador moram no canto superior direito (tema, configurações, sair).
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Home,
  Receipt,
  ArrowLeftRight,
  Menu,
  LogOut,
  Settings,
  Sun,
  Moon,
  WifiOff,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth";
import { useEmpresa } from "@/lib/empresa";
import { useTheme } from "@/lib/theme";
import { isMock } from "@/lib/supabase";
import { MENU } from "@/lib/navegacao";
import { podeAcessar } from "@/lib/permissoes";
import { useQueryClient } from "@tanstack/react-query";

// O workflow do APK passa VITE_BUILD=1.<número da execução>. Fora dele (site,
// `npm run dev`) não há build numerado, e a versão mostra a origem.
const VERSAO = (import.meta.env.VITE_BUILD as string | undefined) || "site";

type Atalho = { titulo: string; url: string; icon: typeof Home };

// Os três atalhos fixos da barra. O quarto lugar é sempre o "Mais".
const ATALHOS: Atalho[] = [
  { titulo: "Início", url: "/", icon: Home },
  { titulo: "Pagamentos", url: "/financeiro/pagamentos", icon: Receipt },
  { titulo: "Movimentações", url: "/financeiro/caixa", icon: ArrowLeftRight },
];

export function CascaCelular({
  title,
  subtitle,
  actions,
  tabs,
  seletorEmpresa,
  bloqueado,
  nome,
  papelNome,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  tabs?: ReactNode;
  seletorEmpresa?: ReactNode;
  bloqueado: boolean;
  nome: string;
  papelNome: string;
  children: ReactNode;
}) {
  return (
    // `app-celular` liga os tokens do desenho do app (styles.css, no fim):
    // eles valem só aqui dentro, e não vazam para a tela de computador.
    <div className="app-celular flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 px-4 pt-3 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[20px] font-bold leading-tight tracking-tight">
              {title}
            </h1>
            {seletorEmpresa && <div className="mt-1 -ml-1">{seletorEmpresa}</div>}
          </div>
          {/* As ações da página (Novo Pix, exportar…) ficam ao lado do título,
              em linha que rola: com quatro botões elas não cabem em 360 px, e
              empurrar a página para o lado é justamente o que o teste barra. */}
          {actions && !bloqueado && (
            <div className="-mr-1 flex max-w-[55%] items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {actions}
            </div>
          )}
        </div>
        {subtitle && (
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{subtitle}</p>
        )}
        {tabs && !bloqueado && (
          <div className="-mx-4 mt-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs}
          </div>
        )}
      </header>

      <AvisoSemConexao />

      {/* pb-24: a barra de baixo é fixa e cobriria o fim da lista. */}
      <main className="min-w-0 flex-1 px-4 pb-24 pt-4">{children}</main>

      <BarraInferior nome={nome} papelNome={papelNome} />
    </div>
  );
}

// ─── Sem conexão ───────────────────────────────────────────────────────────
// No aparelho a rede cai de verdade — no elevador, no estacionamento, no
// cliente. Sem este aviso, as telas só ficavam vazias ou com o erro de cada
// consulta, e ninguém sabia se o problema era o sistema ou o sinal.
//
// `navigator.onLine` só garante o NEGATIVO: falso quer dizer que não há rede;
// verdadeiro não promete que o servidor responde. Por isso a faixa some
// sozinha ao voltar o sinal, e os erros de cada tela continuam existindo.
function AvisoSemConexao() {
  const qc = useQueryClient();
  const [offline, setOffline] = useState(false);

  // Só depois de montar: navigator não existe no servidor.
  useEffect(() => {
    const ler = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    ler();
    window.addEventListener("online", ler);
    window.addEventListener("offline", ler);
    return () => {
      window.removeEventListener("online", ler);
      window.removeEventListener("offline", ler);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 text-[12px] font-semibold leading-snug text-destructive">
        Sem conexão — os dados na tela podem estar desatualizados.
      </span>
      <button
        type="button"
        onClick={() => void qc.refetchQueries()}
        className="shrink-0 rounded-md border border-destructive/40 px-2.5 py-1 text-[11.5px] font-bold text-destructive"
      >
        Tentar de novo
      </button>
    </div>
  );
}

function BarraInferior({ nome, papelNome }: { nome: string; papelNome: string }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { caps } = useEmpresa();

  const visiveis = ATALHOS.filter((a) => podeAcessar(caps, a.url));

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/95 backdrop-blur-xl"
        // Aparelhos com barra de gestos: a faixa do sistema não pode comer os botões.
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex max-w-lg items-stretch">
          {visiveis.map((a) => {
            const ativo = a.url === "/" ? path === "/" : path.startsWith(a.url);
            return (
              <Link
                key={a.url}
                to={a.url}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                  ativo ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <span
                  className={`grid h-6 w-[46px] place-items-center rounded-xl transition-colors ${
                    ativo ? "bg-[var(--primary-soft)]" : ""
                  }`}
                >
                  <a.icon className="h-[18px] w-[18px]" />
                </span>
                <span className="max-w-full truncate px-1">{a.titulo}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMenuAberto(true)}
            className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground"
          >
            <span className="grid h-6 w-[46px] place-items-center rounded-xl">
              <Menu className="h-[18px] w-[18px]" />
            </span>
            <span>Mais</span>
          </button>
        </div>
      </nav>

      <MenuCompleto
        aberto={menuAberto}
        fechar={() => setMenuAberto(false)}
        nome={nome}
        papelNome={papelNome}
      />
    </>
  );
}

function MenuCompleto({
  aberto,
  fechar,
  nome,
  papelNome,
}: {
  aberto: boolean;
  fechar: () => void;
  nome: string;
  papelNome: string;
}) {
  const navigate = useNavigate();
  const { caps } = useEmpresa();
  const { signOut } = useAuth();
  const { theme, toggle } = useTheme();

  const iniciais = (nome.match(/\p{L}+/gu) ?? ["U"])
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const sair = async () => {
    fechar();
    await signOut();
    navigate({ to: "/login" });
  };

  const ir = (url: string) => {
    fechar();
    navigate({ to: url });
  };

  return (
    <Sheet open={aberto} onOpenChange={(v) => (v ? undefined : fechar())}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-foreground text-xs font-semibold text-background">
                {iniciais}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{nome}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {papelNome}
              </span>
            </span>
          </SheetTitle>
        </SheetHeader>

        {isMock && (
          <p className="mt-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] font-medium text-primary">
            Protótipo · dados fictícios — o Supabase real não é acessado
          </p>
        )}

        <div className="mt-4 space-y-5">
          {MENU.map((grupo) => {
            const itens = grupo.itens.filter((i) => podeAcessar(caps, i.url));
            if (!itens.length) return null;
            return (
              <div key={grupo.pilar}>
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {grupo.titulo}
                </p>
                <div className="mt-1.5 grid gap-0.5">
                  {itens.map((i) => (
                    <button
                      key={i.url}
                      type="button"
                      onClick={() => ir(i.url)}
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm font-medium hover:bg-secondary"
                    >
                      <i.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{i.titulo}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="grid gap-0.5 border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={() => ir("/configuracoes")}
              className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm font-medium hover:bg-secondary"
            >
              <Settings className="h-4 w-4 shrink-0 text-muted-foreground" /> Configurações
            </button>
            <button
              type="button"
              onClick={toggle}
              className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm font-medium hover:bg-secondary"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <Moon className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              {theme === "dark" ? "Tema claro" : "Tema escuro"}
            </button>
            <button
              type="button"
              onClick={sair}
              className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm font-medium hover:bg-secondary"
            >
              <LogOut className="h-4 w-4 shrink-0 text-muted-foreground" /> Sair
            </button>
          </div>
        </div>

        {/* Qual build está neste aparelho. Sem isto, saber se alguém ficou com
            um APK velho vira adivinhação — e já virou uma vez. */}
        <p className="mt-4 text-center text-[11px] text-muted-foreground">Finance HUB · versão {VERSAO}</p>
      </SheetContent>
    </Sheet>
  );
}
