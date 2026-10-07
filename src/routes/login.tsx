import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, Mail, TrendingUp, ShieldCheck, ArrowRight, Loader2, FlaskConical, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { NO_APP, DESTINO_INICIAL_DO_APP } from "@/lib/nativo";
import { isMock } from "@/lib/supabase";
import { USUARIOS_DEMO, SENHA_DEMO } from "@/lib/mock";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar · Finance HUB" },
      { name: "description", content: "Acesso ao painel interno do Finance HUB." },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();

  // Depois de entrar, o site vai para o Dashboard e o APK vai para o painel de
  // Pagamentos. A troca de rota da abertura do app (src/lib/nativo.ts) acontece
  // ANTES do login; sem esta linha, a tela de login a desfazia e o app abria no
  // Dashboard — que foi exatamente o que aconteceu no primeiro APK.
  const irParaOInicio = () => navigate(NO_APP ? DESTINO_INICIAL_DO_APP : { to: "/" });

  const { signIn, session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Já autenticado? Vai direto pro painel.
  useEffect(() => {
    if (!loading && session) irParaOInicio();
  }, [loading, session, navigate]);

  const entrar = async (emailLogin: string, senha: string) => {
    setError(null);
    setSubmitting(true);
    const { error: err } = await signIn(emailLogin, senha);
    setSubmitting(false);
    if (err) {
      setError(
        err === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : err
      );
      return;
    }
    irParaOInicio();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await entrar(email, password);
  };

  // Protótipo: entra direto com uma das contas fictícias (uma por perfil).
  const entrarDemo = async (emailDemo: string) => {
    setEmail(emailDemo);
    setPassword(SENHA_DEMO);
    await entrar(emailDemo, SENHA_DEMO);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Left: form */}
      <div className="flex flex-col px-6 sm:px-12 py-8">
        <Link to="/" className="flex items-center gap-2.5 w-fit">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground text-background">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-display text-[13px] font-bold tracking-tight">FINANCE</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              HUB
            </span>
          </div>
        </Link>

        <div className="flex-1 flex items-center">
          <div className="w-full max-w-sm mx-auto">
            <h1 className="font-display text-3xl font-bold tracking-tight">Bem-vindo de volta</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Financeiro, RH e Gestão da empresa em um só lugar.
            </p>

            <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium">E-mail corporativo</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@empresa.com.br"
                    className="pl-9 h-11"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium">Senha</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={verSenha ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Sua senha"
                    className="pl-9 pr-11 h-11"
                  />
                  {/* Conferir o que foi digitado: num teclado de celular, errar a
                      senha sem conseguir ver é o jeito mais fácil de não entrar. */}
                  <button
                    type="button"
                    onClick={() => setVerSenha((v) => !v)}
                    aria-label={verSenha ? "Ocultar senha" : "Mostrar senha"}
                    aria-pressed={verSenha}
                    className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
                  >
                    {verSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-medium group disabled:opacity-70"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Entrando...
                  </>
                ) : (
                  <>
                    Entrar no painel
                    <ArrowRight className="h-4 w-4 ml-1.5 group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </Button>

              <div className="flex items-center gap-2 pt-3 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-success" />
                Acesso por cargo: cada pessoa vê só as áreas liberadas para ela
              </div>
            </form>

            {isMock && (
              <div className="mt-8 rounded-xl border border-primary/25 bg-primary/5 p-4">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  <FlaskConical className="h-3.5 w-3.5" /> Protótipo · dados fictícios
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Nada aqui é real e o Supabase não é acessado. Entre com um perfil para ver o que cada cargo enxerga
                  (senha de todos: <code className="font-numeric">{SENHA_DEMO}</code>).
                </p>
                <ul className="mt-3 grid gap-1.5">
                  {USUARIOS_DEMO.map((u) => (
                    <li key={u.email}>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => entrarDemo(u.email)}
                        className="group w-full cursor-pointer rounded-lg border border-border/70 bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 disabled:opacity-60"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{u.nome}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                        </span>
                        <span className="block text-[11px] text-muted-foreground">{u.descricao}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          © 2026 Finance HUB · Todos os direitos reservados.
        </p>
      </div>

      {/* Right: visual */}
      <div className="hidden lg:block relative bg-foreground text-background overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div
          className="absolute -top-32 -right-32 w-[480px] h-[480px] rounded-full blur-3xl opacity-30"
          style={{ background: "radial-gradient(closest-side, #FF4D1C, transparent)" }}
        />
        <div className="absolute -bottom-40 -left-20 w-[420px] h-[420px] rounded-full blur-3xl opacity-20"
          style={{ background: "radial-gradient(closest-side, #FF4D1C, transparent)" }}
        />

        <div className="relative h-full flex flex-col justify-between p-12">
          <div className="inline-flex items-center gap-2 text-[11px] font-medium px-3 py-1.5 rounded-full bg-background/10 backdrop-blur w-fit">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Financeiro · RH · Gestão
          </div>

          {/* Mock card */}
          <div className="space-y-5">
            <div className="rounded-2xl bg-background/[0.06] border border-background/10 backdrop-blur p-6">
              <div className="flex items-center justify-between text-[11px] text-background/60">
                <span>Saldo realizado · Conta Principal</span>
                <span className="px-2 py-0.5 rounded-md bg-success/20 text-success">+2,8%</span>
              </div>
              <p className="mt-2 font-numeric text-3xl font-bold tracking-tight">R$ 148.732,18</p>
              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  { l: "Entradas", v: "R$ 24,5k", c: "bg-success" },
                  { l: "Saídas", v: "R$ 15,9k", c: "bg-primary" },
                  { l: "Projeção", v: "R$ 173k", c: "bg-background/40" },
                ].map((b) => (
                  <div key={b.l} className="rounded-lg bg-background/5 p-3">
                    <div className={`h-1 w-6 rounded-full ${b.c} mb-2`} />
                    <p className="text-[10px] text-background/60 uppercase tracking-wider">{b.l}</p>
                    <p className="font-numeric text-sm font-semibold mt-0.5">{b.v}</p>
                  </div>
                ))}
              </div>
              <svg viewBox="0 0 300 60" className="mt-5 w-full h-14">
                <defs>
                  <linearGradient id="lgrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#FF4D1C" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#FF4D1C" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M0 45 L30 38 L60 42 L90 30 L120 33 L150 22 L180 26 L210 15 L240 19 L270 10 L300 8 L300 60 L0 60 Z"
                  fill="url(#lgrad)"
                />
                <path
                  d="M0 45 L30 38 L60 42 L90 30 L120 33 L150 22 L180 26 L210 15 L240 19 L270 10 L300 8"
                  stroke="#FF4D1C"
                  strokeWidth="1.5"
                  fill="none"
                />
              </svg>
            </div>

            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight max-w-md text-balance">
                A operação da empresa em um único painel: dinheiro, pessoas e gestão.
              </h2>
              <p className="mt-2 text-sm text-background/60 max-w-md">
                Extratos com categorização assistida, pagamentos e cobranças, folha e
                benefícios, recrutamento e um Dashboard gerencial com dados para análise.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6 text-[11px] text-background/50">
            <span>Financeiro</span>
            <span>·</span>
            <span>RH</span>
            <span>·</span>
            <span>Gestão</span>
          </div>
        </div>
      </div>
    </div>
  );
}
