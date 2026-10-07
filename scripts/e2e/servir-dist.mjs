// Serve dist/client como a Vercel: arquivo se existir; senão index.html (SPA).
// Uso: node scripts/e2e/servir-dist.mjs dist/client 4173
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(process.argv[2]);
const porta = Number(process.argv[3] || 4173);
const tipos = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm" };

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let arq = path.resolve(path.join(raiz, url));
  if (!arq.startsWith(raiz) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) arq = path.join(raiz, "index.html");
  res.writeHead(200, { "content-type": tipos[path.extname(arq)] || "application/octet-stream" });
  fs.createReadStream(arq).pipe(res);
}).listen(porta, "127.0.0.1", () => console.log(`servindo ${raiz} em http://127.0.0.1:${porta}`));
