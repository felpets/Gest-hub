# Integração Supabase — Zaytan Hub Financeiro

A base já está montada no código (cliente, login real, proteção de rotas, banco e
camada de dados). Falta só você criar o projeto no Supabase e colar as chaves.

## 1. Criar o projeto no Supabase
1. Acesse https://supabase.com/dashboard e crie uma conta (pode usar o Google).
2. Clique em **New project**. Dê um nome (ex.: `zaytan-hub`), escolha uma senha forte
   para o banco e a região **South America (São Paulo)**.
3. Aguarde ~2 min até o projeto ficar pronto.

## 2. Pegar as chaves
No projeto: **Settings** (engrenagem) → **API**. Copie dois valores:
- **Project URL** → vai em `VITE_SUPABASE_URL`
- **anon public** (em *Project API keys*) → vai em `VITE_SUPABASE_ANON_KEY`

> A chave `anon` é pública e segura para o frontend. **Nunca** use a `service_role` aqui.

## 3. Colar no `.env.local`
Abra o arquivo `.env.local` (na raiz do projeto) e preencha:

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Depois **reinicie** o servidor (`Ctrl+C` e `npm run dev`) — o Vite só lê o `.env` ao iniciar.

## 4. Criar as tabelas (e dados de exemplo)
No projeto: **SQL Editor** → **New query** → cole **todo** o conteúdo de
[`supabase/schema.sql`](supabase/schema.sql) → **Run**.

Isso cria as tabelas `clientes`, `movimentacoes`, `previstos`, `regras`, ativa a
segurança (RLS) e já insere os dados que hoje estão no mock.

**Depois**, rode também (mesma forma, no SQL Editor) o arquivo
[`supabase/02_planejamento.sql`](supabase/02_planejamento.sql) — ele cria as tabelas
`planejamento_meses` e `planejamento_itens` (usadas pelo Dashboard e pela grade de
planejamento em Movimentações) com o seed correspondente.

## 5. Criar seu usuário de acesso
A tela de login agora é real. Crie o usuário em:
**Authentication** → **Users** → **Add user** → **Create new user**.
Informe e-mail + senha e marque **Auto Confirm User** (assim não precisa confirmar e-mail).

> Para liberar cadastro só por convite (recomendado em painel interno), deixe o
> *signup* público desligado em **Authentication → Providers → Email**.

## 6. Testar
1. `npm run dev` e abra o app.
2. Qualquer rota interna redireciona para `/login` se você não estiver logado.
3. Entre com o usuário criado no passo 5.
4. Abra **Clientes** — os cards agora vêm do banco (já está ligado como referência).
5. Botão de **sair** fica no canto superior direito do cabeçalho.

---

## Como ligar as outras telas ao banco
A tela **Clientes** (`src/routes/clientes.tsx`) é o modelo. O padrão é:

```tsx
import { useClientes } from "@/lib/queries";
// ...
const { data: clientes = [], isLoading, error } = useClientes();
```

Para movimentações já existe `useMovimentacoes()` em
[`src/lib/queries.ts`](src/lib/queries.ts). Para cada nova tela:
1. Crie a função de fetch + o hook em `src/lib/queries.ts` (copie o padrão).
2. No componente, troque o import do `@/lib/mock` pelo hook.
3. Trate `isLoading` / `error` como em Clientes.

> O planejamento (`planning` no mock) é uma estrutura aninhada por mês. Quando quiser
> migrá-lo, o ideal é uma tabela `planejamento_itens` (categoria, item, mês, previsto,
> realizado). Posso montar isso quando você chegar nessa etapa.

## Arquivos criados/alterados
- `src/lib/supabase.ts` — cliente Supabase (lê o `.env.local`)
- `src/lib/auth.tsx` — contexto de autenticação (`useAuth`)
- `src/lib/queries.ts` — camada de dados (TanStack Query)
- `src/routes/__root.tsx` — envolve o app no `AuthProvider`
- `src/routes/login.tsx` — login real (e-mail/senha)
- `src/components/AppShell.tsx` — proteção de rota + usuário + logout
- `src/routes/clientes.tsx` — clientes lendo do banco
- `src/routes/movimentacoes.tsx` — extrato + grade de planejamento do banco
- `src/routes/index.tsx` — Dashboard (KPIs, listas e gráficos) do banco
- `supabase/schema.sql` — tabelas clientes/movimentacoes/previstos/regras + RLS + seed
- `supabase/02_planejamento.sql` — tabelas de planejamento + RLS + seed
- `.env.example` / `.env.local` — variáveis de ambiente
