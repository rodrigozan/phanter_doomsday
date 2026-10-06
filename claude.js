import { spawn } from "node:child_process";

export const MODOS_PERMISSAO = ["default", "acceptEdits", "plan"];
export const TIMEOUT_PADRAO_MS = 30 * 60 * 1000;

const ehWindows = process.platform === "win32";

export function montarEnv(base) {
  const env = {};
  for (const [chave, valor] of Object.entries(base)) {
    if (chave.toUpperCase().startsWith("ANTHROPIC_API")) continue;
    env[chave] = valor;
  }
  return env;
}

function citar(valor) {
  const texto = String(valor);
  if (/^[A-Za-z0-9_.:\\/=-]+$/.test(texto)) return texto;
  return `"${texto.replace(/"/g, '\\"')}"`;
}

export function montarArgs({ modelo, modoPermissao, sessionId, ferramentas, diretorios }) {
  const args = ["-p", "--model", modelo, "--output-format", "json", "--permission-mode", modoPermissao];
  if (sessionId) args.push("--resume", sessionId);
  if (ferramentas && ferramentas.length > 0) args.push("--allowedTools", ferramentas.join(","));
  for (const diretorio of diretorios ?? []) args.push("--add-dir", diretorio);
  return args;
}

export function classificarErro(texto) {
  return /not logged in|\/login|authentication|unauthorized|invalid api key|401|oauth/i.test(texto || "")
    ? "autenticacao"
    : "geral";
}

export function regraDaFerramenta(nome, entrada) {
  if (nome === "Bash" && typeof entrada?.command === "string") {
    const primeira = entrada.command.trim().split(/\s+/)[0];
    if (primeira && /^[A-Za-z0-9_.-]+$/.test(primeira)) return `Bash(${primeira} *)`;
  }
  return nome;
}

export function extrairNegacoes(lista) {
  if (!Array.isArray(lista)) return [];
  const vistas = new Map();
  for (const item of lista) {
    const nome = item?.tool_name;
    if (typeof nome !== "string" || !nome) continue;
    const regra = regraDaFerramenta(nome, item.tool_input);
    if (vistas.has(regra)) continue;
    const alvo = item.tool_input?.command ?? item.tool_input?.file_path ?? item.tool_input?.url ?? item.tool_input?.pattern ?? "";
    vistas.set(regra, { ferramenta: nome, regra, descricao: String(alvo).slice(0, 300) });
  }
  return [...vistas.values()];
}

export function interpretarSaida(stdout) {
  let dados;
  try {
    dados = JSON.parse(stdout);
  } catch {
    const erro = new Error("Não foi possível interpretar a saída do Claude Code.");
    erro.detalhe = stdout;
    throw erro;
  }
  if (Array.isArray(dados)) dados = dados.find((item) => item?.type === "result") ?? dados.at(-1) ?? {};
  return {
    negacoes: extrairNegacoes(dados.permission_denials),
    resultado: typeof dados.result === "string" ? dados.result : "",
    sessionId: dados.session_id ?? null,
    custoUsd: dados.total_cost_usd ?? dados.cost_usd ?? null,
    duracaoClaudeMs: dados.duration_ms ?? null,
    uso: dados.usage ?? null,
    erro: dados.is_error === true
  };
}

function encerrarArvore(filho) {
  if (!filho.pid) return;
  if (ehWindows) {
    spawn("taskkill", ["/pid", String(filho.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    filho.kill("SIGKILL");
  }
}

export function executarClaude({ cwd, prompt, modelo, modoPermissao, sessionId, ferramentas, diretorios, timeoutMs = TIMEOUT_PADRAO_MS, envBase = process.env }) {
  const args = montarArgs({ modelo, modoPermissao, sessionId, ferramentas, diretorios }).map(citar);
  const filho = spawn("claude", args, {
    cwd,
    env: montarEnv(envBase),
    shell: ehWindows,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  let cancelado = false;
  let estourou = false;

  filho.stdout.setEncoding("utf8");
  filho.stderr.setEncoding("utf8");
  filho.stdout.on("data", (parte) => { stdout += parte; });
  filho.stderr.on("data", (parte) => { stderr += parte; });

  const temporizador = setTimeout(() => {
    estourou = true;
    encerrarArvore(filho);
  }, timeoutMs);

  const inicio = Date.now();

  const promessa = new Promise((resolver) => {
    const finalizar = (dados) => {
      clearTimeout(temporizador);
      resolver({ ...dados, duracaoMs: Date.now() - inicio });
    };

    filho.on("error", (erro) => {
      finalizar({ status: "erro", erro: `Falha ao iniciar o claude: ${erro.message}`, tipoErro: "geral" });
    });

    filho.on("close", (codigo) => {
      if (cancelado) return finalizar({ status: "cancelada", erro: "Execução cancelada." });
      if (estourou) return finalizar({ status: "erro", erro: "Tempo limite da execução excedido.", tipoErro: "geral" });
      if (codigo !== 0) {
        const detalhe = (stderr || stdout).trim() || `Código de saída ${codigo}`;
        return finalizar({ status: "erro", erro: detalhe, tipoErro: classificarErro(detalhe) });
      }
      try {
        const saida = interpretarSaida(stdout);
        if (saida.erro) {
          return finalizar({ ...saida, status: "erro", erro: saida.resultado || "O Claude Code retornou erro.", tipoErro: classificarErro(saida.resultado) });
        }
        finalizar({ ...saida, status: "concluida" });
      } catch (erro) {
        finalizar({ status: "erro", erro: `${erro.message}\n${erro.detalhe ?? ""}`.trim(), tipoErro: "geral" });
      }
    });
  });

  filho.stdin.on("error", () => {});
  filho.stdin.end(prompt);

  return {
    promessa,
    cancelar() {
      cancelado = true;
      encerrarArvore(filho);
    }
  };
}

export function verificarClaude() {
  return new Promise((resolver) => {
    const filho = spawn("claude", ["--version"], { shell: ehWindows, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let saida = "";
    filho.stdout.on("data", (parte) => { saida += parte; });
    filho.on("error", () => resolver({ disponivel: false, versao: null }));
    filho.on("close", (codigo) => resolver({ disponivel: codigo === 0, versao: codigo === 0 ? saida.trim() : null }));
  });
}
