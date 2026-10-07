// ─── Autenticação simulada do protótipo ────────────────────────────────────
// Imita o subconjunto de `supabase.auth` que o app usa (getSession,
// onAuthStateChange, signInWithPassword, signOut). Os logins são FICTÍCIOS e
// vivem na tabela simulada "auth.users" (ver seed). Nada sai do navegador.
import { tabela, marcarAlterado, SPECS, type Row } from "./db";

SPECS["auth.users"] = { pk: ["id"] };

const SESSION_KEY = "zaytan.prototipo.sessao.v1";

export type MockUser = {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
  aud: string;
  created_at: string;
};

export type MockSession = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
  user: MockUser;
};

type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "INITIAL_SESSION" | "USER_UPDATED";
type Listener = (event: AuthEvent, session: MockSession | null) => void;

const listeners = new Set<Listener>();
let current: MockSession | null | undefined;

function toUser(u: Row): MockUser {
  return {
    id: String(u.id),
    email: String(u.email),
    user_metadata: { nome: u.nome ?? null, ...((u.user_metadata as object) ?? {}) },
    app_metadata: { provider: "email", ...((u.app_metadata as object) ?? {}) },
    aud: "authenticated",
    created_at: String(u.created_at ?? new Date().toISOString()),
  };
}

function buildSession(u: Row): MockSession {
  return {
    access_token: `prototipo.${u.id}`,
    refresh_token: "prototipo",
    token_type: "bearer",
    expires_in: 3600 * 24,
    expires_at: Math.floor(Date.now() / 1000) + 3600 * 24,
    user: toUser(u),
  };
}

function lerSessao(): MockSession | null {
  if (current !== undefined) return current;
  current = null;
  if (typeof localStorage !== "undefined") {
    try {
      const id = localStorage.getItem(SESSION_KEY);
      const u = id ? tabela("auth.users").find((r) => r.id === id) : undefined;
      if (u) current = buildSession(u);
    } catch {
      current = null;
    }
  }
  return current;
}

function gravarSessao(s: MockSession | null) {
  current = s;
  if (typeof localStorage !== "undefined") {
    try {
      if (s) localStorage.setItem(SESSION_KEY, s.user.id);
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignora */
    }
  }
}

// Usuário logado (usado pelas "policies" e gatilhos simulados).
export function usuarioAtual(): MockUser | null {
  return lerSessao()?.user ?? null;
}

const erro = (message: string) => ({ name: "AuthApiError", message, status: 400 });
const tick = () => new Promise((r) => setTimeout(r, 120));

export const mockAuth = {
  async getSession() {
    return { data: { session: lerSessao() }, error: null };
  },
  async getUser() {
    const s = lerSessao();
    return s ? { data: { user: s.user }, error: null } : { data: { user: null }, error: erro("Sem sessão") };
  },
  onAuthStateChange(cb: Listener) {
    listeners.add(cb);
    // Igual ao supabase-js: dispara a sessão inicial logo depois de assinar.
    setTimeout(() => cb("INITIAL_SESSION", lerSessao()), 0);
    return { data: { subscription: { id: String(Math.random()), unsubscribe: () => listeners.delete(cb) } } };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    await tick();
    const alvo = email.trim().toLowerCase();
    const u = tabela("auth.users").find((r) => String(r.email).toLowerCase() === alvo && !r.deleted_at);
    if (!u || u.senha !== password) {
      return { data: { user: null, session: null }, error: erro("Invalid login credentials") };
    }
    u.last_sign_in_at = new Date().toISOString();
    marcarAlterado();
    const s = buildSession(u);
    gravarSessao(s);
    listeners.forEach((l) => l("SIGNED_IN", s));
    return { data: { user: s.user, session: s }, error: null };
  },
  async signOut() {
    gravarSessao(null);
    listeners.forEach((l) => l("SIGNED_OUT", null));
    return { error: null };
  },
  async updateUser(attrs: { data?: Record<string, unknown> }) {
    const s = lerSessao();
    if (!s) return { data: { user: null }, error: erro("Sem sessão") };
    const u = tabela("auth.users").find((r) => r.id === s.user.id);
    if (u && attrs.data) u.user_metadata = { ...((u.user_metadata as object) ?? {}), ...attrs.data };
    marcarAlterado();
    const nova = buildSession(u ?? {});
    gravarSessao(nova);
    listeners.forEach((l) => l("USER_UPDATED", nova));
    return { data: { user: nova.user }, error: null };
  },
};

// Chamado quando o banco simulado é restaurado: a sessão pode apontar para um
// usuário que mudou; relê do zero.
export function reiniciarSessao() {
  current = undefined;
}
