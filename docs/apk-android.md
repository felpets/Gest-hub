# APK Android — painel de Pagamentos

O app Android **é o próprio Zaytan Hub**: o build do site (`dist/client`) vai empacotado dentro do APK
e roda num WebView, pelo [Capacitor](https://capacitorjs.com). Não existe um segundo código a manter —
toda correção feita no site entra no app no APK seguinte.

A diferença é o ponto de partida: o app abre direto em **Financeiro › Pagamentos › Pix do dia**, que é a
tarefa de quem vai pagar. O resto do Hub continua inteiro ali dentro (menu, RH, Gestão), respeitando as
mesmas permissões de cargo — o app não ganha acesso a nada que o login já não tivesse no site.

---

## Gerar o APK

Nenhuma máquina do escritório precisa de Android Studio: quem compila é o GitHub.

1. No repositório: **Actions › APK Android › Run workflow**
2. Escolha:

| Campo | Opções | Quando usar |
|---|---|---|
| `tipo` | `debug` (padrão) · `release` | `debug` instala direto, sem chave nenhuma. `release` exige a chave de assinatura (mais abaixo) |
| `dados` | `real` (padrão) · `mock` | `mock` gera um app com dados fictícios, bom para mostrar a tela a alguém sem tocar no banco |

3. Ao terminar (~5 a 10 minutos), a página da execução mostra um resumo com a versão e o `sha256`, e o
   APK fica em **Artifacts** — baixe o `.zip`, dentro dele está o `.apk`.

Também sai um APK ao empurrar uma tag `apk-v*` (ex.: `git tag apk-v1.3 && git push origin apk-v1.3`),
com os padrões: depuração e dados reais.

E todo **pull request** que mexa em `android/`, no `capacitor.config.ts` ou neste workflow compila um APK
de depuração com dados fictícios: é o que garante que uma quebra do Gradle apareça na revisão, e não no dia
em que alguém precisa do app. Esse APK também fica em *Artifacts*, então dá para instalar e testar antes do
merge — e ele não depende de secret nenhum.

> O botão **Run workflow** só aparece depois que este arquivo estiver na `main` — é regra do GitHub para
> `workflow_dispatch`. Até o merge, o APK vem pelo gatilho de pull request acima.

### Secrets necessários

Em **Settings › Secrets and variables › Actions**:

| Secret | O que é | Obrigatório |
|---|---|---|
| `VITE_SUPABASE_URL` | mesmo valor do `.env.real.local` | sim, quando `dados=real` |
| `VITE_SUPABASE_ANON_KEY` | idem (é a chave **pública** do projeto) | sim, quando `dados=real` |
| `ANDROID_KEYSTORE_BASE64` | a chave de assinatura em base64 | só para `release` |
| `ANDROID_KEYSTORE_PASSWORD` | senha do arquivo da chave | só para `release` |
| `ANDROID_KEY_ALIAS` | apelido da chave dentro do arquivo | só para `release` |
| `ANDROID_KEY_PASSWORD` | senha da chave | só para `release` |

Opcional, em **Variables**: `VITE_API_BASE`, o endereço do site publicado. Sem ela vale
`https://gest-o-laportec.vercel.app`, que está escrito no workflow.

A chave anônima do Supabase **fica dentro do APK** — como já fica no JavaScript do site. É assim que ela
foi feita: quem manda no que cada login pode ler e gravar é o RLS do banco, não o segredo da chave.

---

## Instalar no celular

1. Passe o `.apk` para o aparelho (WhatsApp, Drive, cabo — tanto faz).
2. Ao abrir, o Android avisa que o app não vem da Play Store. Em **Configurações › Aplicativos ›
   Instalar apps desconhecidos**, libere o aplicativo pelo qual o arquivo chegou.
3. Instale e entre com o login de sempre.

Para **atualizar**, basta instalar o APK novo por cima: o `versionCode` cresce a cada execução do
workflow, que é o que faz o Android aceitar a substituição. Não precisa desinstalar, e a sessão e a
empresa escolhida continuam lá — desde que o APK novo esteja assinado com a **mesma** chave do
anterior (dois APKs `debug` gerados pelo GitHub também combinam entre si).

---

## O que muda dentro do app

| Tema | No site | No APK | Onde |
|---|---|---|---|
| Tela de abertura | Dashboard | Pagamentos › Pix do dia | [`src/lib/nativo.ts`](../src/lib/nativo.ts) |
| Exportar PDF/Excel | baixa o arquivo | grava o arquivo e abre o compartilhar do Android | [`src/lib/salvar-arquivo.ts`](../src/lib/salvar-arquivo.ts) |
| `/api/usuarios`, `/api/inter/sync` | mesma origem | vão para o site na Vercel (`VITE_API_BASE`) | [`src/lib/nativo.ts`](../src/lib/nativo.ts), [`api/_lib/cors.ts`](../api/_lib/cors.ts) |
| Avisos do Pix em tempo real | Realtime do Supabase | igual (websocket direto ao Supabase) | `supabase/58_pix_tempo_real.sql` |

O `<a download>` não funciona em WebView do Android: o clique em "Exportar" simplesmente não fazia nada.
Por isso o PDF e o Excel passaram a sair por um caminho só, que no navegador continua sendo o download
de sempre e no app grava em cache e chama o compartilhar (abrir no leitor de PDF, salvar no Drive,
mandar no WhatsApp).

As funções `/api/*` não existem dentro do APK — são funções de servidor da Vercel. Como o app chama de
outra origem (`https://localhost`, o servidor local do Capacitor), elas ganharam CORS para essa origem
e só para ela. **Isso não afrouxa nada**: a autorização continua sendo o token do usuário conferido
contra o Supabase; CORS só decide quem o navegador deixa ler a resposta.

---

## Assinatura: `debug` ou `release`

| | `debug` | `release` |
|---|---|---|
| Precisa de chave | não | sim (4 secrets) |
| Instala no celular | sim | sim |
| `debuggable` | **sim** — com o aparelho no cabo e depuração USB ligada, dá para ler os dados do app | não |
| Recomendado para | testar, uma ou duas pessoas | distribuir para a equipe |

Um APK `debug` é o caminho mais curto para ver o app funcionando hoje. Para colocar na mão dos pagadores,
gere `release`: num app que mostra chave Pix e valor a pagar, deixar o `debuggable` ligado é abrir uma
porta sem motivo.

### Criar a chave (uma vez na vida)

Numa máquina com Java (qualquer uma com Android Studio; esta máquina não tem):

```bash
keytool -genkeypair -v -keystore zaytan.keystore -alias zaytan \
        -keyalg RSA -keysize 2048 -validity 10000

# guarde as senhas; base64 para colar no secret:
base64 -w0 zaytan.keystore > zaytan.keystore.b64
```

Guarde o arquivo `zaytan.keystore` fora do repositório e em lugar seguro: **perder a chave significa que
nenhum APK futuro instala por cima dos já instalados** — só desinstalando antes. O `.gitignore` do
projeto Android já não deixa `*.keystore` entrar por acidente.

---

## Mexer no projeto Android

A pasta [`android/`](../android) é um projeto Gradle comum, versionado. O que é gerado a cada build
(assets copiados, `capacitor.config.json`, `build/`) está no `.gitignore` dela.

```bash
npm run apk:preparar        # build do site + copia para dentro do projeto Android
npm run apk:preparar:real   # idem, mas com os dados reais (.env.real.local)
npm run apk:abrir           # abre no Android Studio (se estiver instalado)

# Atenção: o build padrão sai em modo PROTÓTIPO (dados fictícios). As chaves reais
# só entram com --mode real, que é o que o apk:preparar:real faz; nesse caso
# acrescente VITE_API_BASE=https://gest-o-laportec.vercel.app ao .env.real.local,
# senão as telas que usam /api/* não acham as funções da Vercel.

# com Android Studio/JDK instalados, para compilar sem o GitHub:
cd android && ./gradlew assembleDebug
# o APK sai em android/app/build/outputs/apk/debug/
```

Arquivos que vale conhecer:

| Arquivo | O que decide |
|---|---|
| [`capacitor.config.ts`](../capacitor.config.ts) | nome do app, `appId`, de onde vêm os arquivos web |
| `android/variables.gradle` | versões do SDK (minSdk 24, compile/target 36) |
| `android/app/build.gradle` | `versionCode`/`versionName` (vêm do workflow) e a assinatura |
| `android/app/src/main/AndroidManifest.xml` | permissões (só INTERNET) e `allowBackup="false"` |
| `android/app/src/main/res/` | ícone e tela de abertura, desenhados a partir do `public/favicon.svg` |
| [`.github/workflows/apk.yml`](../.github/workflows/apk.yml) | como o APK é compilado |

O ícone e o splash são vetores escritos à mão com a mesma geometria do favicon do site — o APK não
carrega nenhum PNG de ícone, e nada do template do Capacitor sobrou à vista.

---

## O que já foi conferido

| Item | Situação |
|---|---|
| Typecheck do app e das funções, 373 testes, 471+138 do RH, build do site | ✅ |
| `npx cap sync android` (site entra no projeto Android) | ✅ |
| **Compilação do APK (Gradle) no workflow** | ✅ passa em ~3 min, APK em *Artifacts* |
| App instalado num aparelho | ⏳ com vocês: abrir no Pix do dia, entrar, lançar um pagamento, exportar o Excel, receber o aviso em tempo real |

Duas pedras apareceram no primeiro build, as duas já corrigidas e anotadas aqui para não voltarem:

- **`android-actions/setup-android`** considerava velho o `cmdline-tools` que vem no runner, baixava um
  mais novo e travava no prompt de licença — um contrato inteiro no log e 26 segundos de execução. O
  workflow usa o `sdkmanager` que já está na imagem do Ubuntu.
- **`npm ci` fora de sincronia** (`Missing: lru-cache@11.5.3 from lock file`): o `unstorage` alpha que vem
  dentro do `nitro` passou a declarar uma dependência que nenhum lockfile antigo tem. Vale para o
  repositório inteiro, não só para o APK. O npm 11 tolera a árvore inválida, o npm 10 (Node 22, o do CI)
  recusa — ao mexer no lockfile, confira com `npx npm@10 ci --dry-run`, senão o erro só aparece no CI.
