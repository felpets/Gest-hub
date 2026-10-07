// Client HTTP da API do Banco Inter (cdpj.partners.bancointer.com.br).
// A autenticação exige mTLS: cada requisição sai por um Agent undici com o
// certificado (.crt) e a chave (.key) da aplicação criada no Internet Banking
// PJ da empresa. Por isso este código SÓ roda server-side (função Vercel).
import { Agent, request } from "undici";

const BASE = "https://cdpj.partners.bancointer.com.br";

export type InterCreds = {
  client_id: string;
  client_secret: string;
  cert_pem: string;
  key_pem: string;
  conta_corrente: string | null;
};

export type InterTransacao = {
  idTransacao?: string;
  dataEntrada?: string;    // YYYY-MM-DD
  dataTransacao?: string;  // fallback
  tipoOperacao?: "C" | "D";
  valor?: string | number;
  titulo?: string;
  descricao?: string;
  tipoTransacao?: string;  // PIX, TED, BOLETO_COBRANCA...
};

export function makeDispatcher(creds: InterCreds): Agent {
  // Normaliza \r remanescente (PEM colado no Windows) por segurança extra.
  const cert = creds.cert_pem.replace(/\r/g, "");
  const key = creds.key_pem.replace(/\r/g, "");
  return new Agent({ connect: { cert, key } });
}

async function readBody(res: { body: { text(): Promise<string> } }): Promise<string> {
  try {
    return await res.body.text();
  } catch {
    return "";
  }
}

function headers(token: string, creds: InterCreds, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${token}`,
    ...(creds.conta_corrente ? { "x-conta-corrente": creds.conta_corrente } : {}),
    ...extra,
  };
}

// OAuth2 client_credentials sobre mTLS. Token vale ~1h; pedimos um novo a
// cada sincronização (sem cache — simples e sempre válido).
export async function getToken(dispatcher: Agent, creds: InterCreds): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    scope: "extrato.read",
  }).toString();

  const res = await request(`${BASE}/oauth/v2/token`, {
    dispatcher,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await readBody(res);
  if (res.statusCode !== 200) {
    throw new Error(`Inter token HTTP ${res.statusCode}: ${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text) as { access_token?: string };
  if (!json.access_token) throw new Error("Inter token: resposta sem access_token");
  return json.access_token;
}

// Saldo disponível na data (usamos a data de hoje na sync).
export async function getSaldo(
  dispatcher: Agent,
  token: string,
  creds: InterCreds,
  dataSaldo: string
): Promise<number> {
  const res = await request(`${BASE}/banking/v2/saldo?dataSaldo=${dataSaldo}`, {
    dispatcher,
    method: "GET",
    headers: headers(token, creds),
  });
  const text = await readBody(res);
  if (res.statusCode !== 200) {
    throw new Error(`Inter saldo HTTP ${res.statusCode}: ${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text) as { disponivel?: number | string };
  const n = Number(json.disponivel);
  if (!Number.isFinite(n)) throw new Error("Inter saldo: resposta sem campo 'disponivel' numérico");
  return n;
}

// Extrato enriquecido, paginado (janela máxima de 90 dias por consulta).
export async function getExtrato(
  dispatcher: Agent,
  token: string,
  creds: InterCreds,
  dataInicio: string,
  dataFim: string
): Promise<InterTransacao[]> {
  const out: InterTransacao[] = [];
  let pagina = 0;
  let totalPaginas = 1;
  const MAX_PAGINAS = 50; // trava defensiva (~5000 transações por sync)

  while (pagina < totalPaginas && pagina < MAX_PAGINAS) {
    const url =
      `${BASE}/banking/v2/extrato/completo?dataInicio=${dataInicio}&dataFim=${dataFim}` +
      `&pagina=${pagina}&tamanhoPagina=100`;
    const res = await request(url, { dispatcher, method: "GET", headers: headers(token, creds) });
    const text = await readBody(res);
    if (res.statusCode !== 200) {
      throw new Error(`Inter extrato HTTP ${res.statusCode}: ${text.slice(0, 200)}`);
    }
    const json = JSON.parse(text) as { totalPaginas?: number; transacoes?: InterTransacao[] };
    out.push(...(json.transacoes ?? []));
    totalPaginas = Number(json.totalPaginas ?? 1);
    pagina += 1;
  }
  return out;
}
