import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, resolve } from "node:path";
import { TIMEOUT_PADRAO_MS } from "./claude.js";

const ehWindows = process.platform === "win32";
const ERRO_SEM_RESPOSTA = "Antigravity não retornou resposta. Possível cota esgotada ou falha de autenticação. Veja o cli.log em ~/.gemini/antigravity-cli.";

export function caminhoAgy(localAppData = process.env.LOCALAPPDATA) {
  const candidato = localAppData ? join(localAppData, "agy", "bin", "agy.exe") : null;
  return candidato && existsSync(candidato) ? candidato : "agy";
}

export function montarArgsAgy({ prompt, modelo, permitirSemConfirmacao, suportaModelo = true }) {
  const args = [];
  if (suportaModelo && modelo) args.push("--model", modelo);
  if (permitirSemConfirmacao) args.push("--dangerously-skip-permissions");
  args.push("--print", prompt);
  return args;
}

export function encerrarAgyOrfaos() {
  if (!ehWindows) return;
  spawnSync("taskkill", ["/im", "agy.exe", "/T", "/F"], { stdio: "ignore", windowsHide: true });
}

function encerrarArvore(filho) {
  if (!filho.pid) return;
  if (ehWindows) spawn("taskkill", ["/pid", String(filho.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else filho.kill("SIGKILL");
}

function arquivosConversa(cwd, casa = homedir()) {
  const base = join(casa, ".gemini", "antigravity-cli");
  const conversas = join(base, "cache", "last_conversations.json");
  if (!existsSync(conversas)) return null;
  try {
    const dados = JSON.parse(readFileSync(conversas, "utf8"));
    const chave = normalize(resolve(cwd));
    const id = dados[chave] ?? dados[cwd] ?? dados.conversations?.[chave] ?? dados.conversations?.[cwd];
    const conversaId = typeof id === "string" ? id : id?.id ?? id?.conversation_id;
    return conversaId ? join(base, "brain", conversaId, ".system_generated", "logs", "transcript.jsonl") : null;
  } catch {
    return null;
  }
}

function linhas(arquivo) {
  try {
    return readFileSync(arquivo, "utf8").split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

export function marcarTranscript(cwd, casa) {
  const arquivo = arquivosConversa(cwd, casa);
  return { arquivo, linhas: arquivo ? linhas(arquivo).length : 0 };
}

export function recuperarTranscript(marca, cwd, casa) {
  const arquivo = arquivosConversa(cwd, casa) ?? marca?.arquivo;
  const novas = linhas(arquivo).slice(marca?.arquivo === arquivo ? marca.linhas : 0);
  for (let indice = novas.length - 1; indice >= 0; indice -= 1) {
    try {
      const item = JSON.parse(novas[indice]);
      if (item.source === "MODEL" && item.type === "PLANNER_RESPONSE" && typeof item.content === "string" && item.content.trim()) return item.content;
    } catch {}
  }
  return null;
}

export function executarAgy({ cwd, prompt, modelo, permitirSemConfirmacao = false, suportaModelo = true, timeoutMs = TIMEOUT_PADRAO_MS, binario = caminhoAgy(), casa = homedir() }) {
  encerrarAgyOrfaos();
  const marca = marcarTranscript(cwd, casa);
  const filho = spawn(binario, montarArgsAgy({ prompt, modelo, permitirSemConfirmacao, suportaModelo }), { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let cancelado = false;
  let estourou = false;
  filho.stdout.setEncoding("utf8");
  filho.stderr.setEncoding("utf8");
  filho.stdout.on("data", (parte) => { stdout += parte; });
  filho.stderr.on("data", (parte) => { stderr += parte; });
  const inicio = Date.now();
  const temporizador = setTimeout(() => { estourou = true; encerrarArvore(filho); }, timeoutMs);
  const promessa = new Promise((resolver) => {
    const finalizar = (dados) => { clearTimeout(temporizador); resolver({ ...dados, duracaoMs: Date.now() - inicio }); };
    filho.on("error", (erro) => finalizar({ status: "erro", erro: `Falha ao iniciar o agy: ${erro.message}`, tipoErro: "geral" }));
    filho.on("close", (codigo) => {
      if (cancelado) return finalizar({ status: "cancelada", erro: "Execução cancelada." });
      if (estourou) return finalizar({ status: "erro", erro: "Tempo limite da execução excedido.", tipoErro: "geral" });
      if (codigo !== 0) return finalizar({ status: "erro", erro: stderr.trim() || stdout.trim() || `Código de saída ${codigo}`, tipoErro: "geral" });
      const resultado = stdout.trim() || recuperarTranscript(marca, cwd, casa);
      if (!resultado) return finalizar({ status: "erro", erro: ERRO_SEM_RESPOSTA, tipoErro: "geral" });
      finalizar({ status: "concluida", resultado });
    });
  });
  return { promessa, cancelar() { cancelado = true; encerrarArvore(filho); } };
}

function versaoCompativel(versao) {
  const partes = String(versao).match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
  return partes[0] > 1 || (partes[0] === 1 && (partes[1] > 0 || (partes[1] === 0 && (partes[2] ?? 0) >= 15)));
}

export function verificarAgy(binario = caminhoAgy()) {
  return new Promise((resolver) => {
    const filho = spawn(binario, ["--version"], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    filho.stdout.on("data", (parte) => { stdout += parte; });
    filho.stderr.on("data", (parte) => { stderr += parte; });
    filho.on("error", () => resolver({ disponivel: false, versao: null, suportaModelo: false, aviso: "agy não encontrado. Abra o agy no terminal e conclua o login." }));
    filho.on("close", async (codigo) => {
      if (codigo !== 0) return resolver({ disponivel: false, versao: null, suportaModelo: false, aviso: stderr.trim() || "agy não está disponível ou não está autenticado." });
      const versao = stdout.trim();
      const ajuda = await new Promise((concluir) => {
        const processo = spawn(binario, ["--help"], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let texto = "";
        processo.stdout.on("data", (parte) => { texto += parte; });
        processo.stderr.on("data", (parte) => { texto += parte; });
        processo.on("error", () => concluir(""));
        processo.on("close", () => concluir(texto));
      });
      resolver({ disponivel: true, versao, suportaModelo: /(^|\s)--model(?:[\s,=]|$)/m.test(ajuda), aviso: versaoCompativel(versao) ? null : "Atualize o agy para a versão 1.0.15 ou superior." });
    });
  });
}

export { ERRO_SEM_RESPOSTA };
