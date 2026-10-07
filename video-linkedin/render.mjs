// Renderiza o vídeo: abre index.html num Chrome sem janela, pede cada quadro a
// window.__render(t), manda os quadros para o ffmpeg e junta a narração.
//
//   node render.mjs              → saida/finance-hub-tour.mp4 (1920x1080, 30 qps)
//   node render.mjs --frame=12.5 → saida/quadro-12.5.png (confere um instante sem renderizar tudo)
//   node render.mjs --preview    → só serve a pasta; abra o endereço no navegador
//
// A duração sai da narração (ver linha.mjs): rode `npm run narrar` antes.
// Navegador: CHROME_PATH, ou o Chrome/Edge instalados no lugar de sempre.
import { createServer } from "node:http";
import { readFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerFalas, lerRoteiro, montarLinha } from "./linha.mjs";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(RAIZ, "saida");
const LARGURA = 1920, ALTURA = 1080, QPS = 30;
const ARQUIVO = path.join(SAIDA, "finance-hub-tour.mp4");

const arg = (nome) => process.argv.find((a) => a === `--${nome}` || a.startsWith(`--${nome}=`))?.split("=")[1] ?? (process.argv.includes(`--${nome}`) ? "" : undefined);

// ─── Servidor local (só esta pasta, só nesta máquina) ───────
// /linha.json é montado a cada pedido: mexeu no roteiro e narrou de novo, o preview já pega.
const linhaAtual = () => montarLinha(lerRoteiro(RAIZ), lerFalas(RAIZ));
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".wav": "audio/wav", ".png": "image/png", ".mp4": "video/mp4" };
const servidor = createServer(async (req, res) => {
  const rota = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (rota === "/linha.json") return res.writeHead(200, { "content-type": TIPOS[".json"], "cache-control": "no-store" }).end(JSON.stringify(linhaAtual()));
  const arquivo = path.join(RAIZ, rota === "/" ? "index.html" : rota);
  if (!arquivo.startsWith(RAIZ)) return res.writeHead(403).end();
  const corpo = await readFile(arquivo).catch(() => null);
  if (!corpo) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TIPOS[path.extname(arquivo)] ?? "application/octet-stream", "cache-control": "no-store" }).end(corpo);
});
servidor.listen(Number(arg("porta")) || 0, "127.0.0.1");
await once(servidor, "listening");
const URL_BASE = `http://127.0.0.1:${servidor.address().port}/`;

if (arg("preview") !== undefined) {
  console.log(`Preview em ${URL_BASE}  (Ctrl+C para sair)`);
  if (!linhaAtual().audios.length) console.log("Sem narração em saida/voz: rode `npm run narrar` primeiro.");
} else {
  await renderizar().finally(() => servidor.close());
}

async function renderizar() {
  await mkdir(SAIDA, { recursive: true });
  const linha = linhaAtual();
  if (!linha.audios.length) console.warn("! Sem narração (rode npm run narrar): o vídeo sai mudo e com os tempos mínimos.");
  const faltando = linha.audios.filter((a) => !existsSync(path.join(RAIZ, a.arquivo)));
  if (faltando.length) throw new Error(`Áudios faltando: ${faltando.map((a) => a.arquivo).join(", ")}. Rode npm run narrar.`);

  const candidatos = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  const navegador = candidatos.find((c) => existsSync(c));
  if (!navegador) throw new Error("Não achei Chrome nem Edge. Aponte CHROME_PATH para o executável.");

  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: navegador, headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: LARGURA, height: ALTURA, deviceScaleFactor: 1 });
    page.on("pageerror", (err) => { throw err; });
    await page.goto(`${URL_BASE}?render=1`, { waitUntil: "networkidle0", timeout: 120000 });
    await page.waitForFunction("window.__pronto === true", { timeout: 120000 });
    const erro = await page.evaluate(() => window.__erro);
    if (erro) throw new Error(erro);

    const quadro = arg("frame");
    if (quadro !== undefined) {
      await page.evaluate((t) => window.__render(t), Number(quadro));
      const destino = path.join(SAIDA, `quadro-${quadro}.png`);
      await page.screenshot({ path: destino, type: "png" });
      return console.log(destino);
    }

    // Áudio: cada clipe de voz entra no seu instante; tudo é mixado e o volume
    // final é nivelado no padrão das redes (-16 LUFS).
    const { default: ffmpegPath } = await import("ffmpeg-static");
    const args = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(QPS), "-c:v", "mjpeg", "-i", "-"];
    for (const a of linha.audios) args.push("-i", path.join(RAIZ, a.arquivo));
    if (!linha.audios.length) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"); // o LinkedIn lida melhor com uma faixa de áudio, mesmo muda
    const filtro = linha.audios.length
      ? linha.audios.map((a, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(a.ini * 1000)}:all=1[a${i}]`).join(";") +
        `;${linha.audios.map((_, i) => `[a${i}]`).join("")}amix=inputs=${linha.audios.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad[a]`
      : "[1:a]anull[a]";
    args.push("-filter_complex", filtro, "-map", "0:v", "-map", "[a]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(QPS),
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", String(linha.duracao), "-movflags", "+faststart", ARQUIVO);

    const ffmpeg = spawn(ffmpegPath, args, { stdio: ["pipe", "inherit", "inherit"] });
    const fim = once(ffmpeg, "close");
    const total = Math.round(QPS * linha.duracao);
    const comeco = Date.now();
    for (let n = 0; n < total; n++) {
      await page.evaluate((t) => window.__render(t), n / QPS);
      const jpg = await page.screenshot({ type: "jpeg", quality: 95, optimizeForSpeed: true });
      if (!ffmpeg.stdin.write(jpg)) await once(ffmpeg.stdin, "drain");
      if (n % 150 === 0) {
        const resta = n ? ((Date.now() - comeco) / n) * (total - n) / 60000 : 0;
        process.stdout.write(`\r${String(Math.round((n / total) * 100)).padStart(3)}%  (${n}/${total} quadros${n ? `, ~${resta.toFixed(0)} min restantes` : ""})   `);
      }
    }
    ffmpeg.stdin.end();
    const [codigo] = await fim;
    if (codigo !== 0) throw new Error(`ffmpeg terminou com código ${codigo}`);
    const { size } = await stat(ARQUIVO);
    console.log(`\r100%  ${ARQUIVO}  (${(size / 1048576).toFixed(1)} MB, ${Math.floor(linha.duracao / 60)}min${Math.round(linha.duracao % 60)}s)`);
  } finally {
    await browser.close();
  }
}
