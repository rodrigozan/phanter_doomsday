import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage } from "electron";
import dotenv from "dotenv";
import { basename, dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as banco from "./supabase.js";
import * as orquestrador from "./orquestrador.js";
import { verificarClaude, MODOS_PERMISSAO } from "./claude.js";
import { verificarAgy } from "./agy.js";
import { normalizarModelosAntigravity } from "./modelos.js";

const raiz = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(raiz, ".env"), quiet: true });

let janela = null;

const TAMANHO_MAXIMO = 32 * 1024 * 1024;
const LIMITE_ANEXOS = 20;
const anexos = new Map();

function pastaAnexos() {
  return join(app.getPath("userData"), "anexos");
}

function nomeSeguro(nome) {
  const limpo = basename(String(nome ?? "")).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return limpo || "arquivo";
}

function publicos() {
  return [...anexos.entries()].map(([id, a]) => ({ id, nome: a.nome, tamanho: a.tamanho }));
}

function registrarAnexo(dados) {
  if (anexos.size >= LIMITE_ANEXOS) throw new Error(`Limite de ${LIMITE_ANEXOS} anexos por tarefa.`);
  const id = randomUUID();
  anexos.set(id, dados);
  return id;
}

function descartarAnexo(id) {
  const anexo = anexos.get(id);
  if (!anexo) return;
  if (anexo.temporario) rmSync(dirname(anexo.caminho), { recursive: true, force: true });
  anexos.delete(id);
}

function limparAnexos() {
  for (const id of [...anexos.keys()]) descartarAnexo(id);
}

function arquivoSessao() {
  return join(app.getPath("userData"), "sessao.bin");
}

function guardarRefreshToken(token) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    writeFileSync(arquivoSessao(), safeStorage.encryptString(token));
  } catch {}
}

function lerRefreshToken() {
  try {
    const arquivo = arquivoSessao();
    if (!existsSync(arquivo) || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(readFileSync(arquivo));
  } catch {
    return null;
  }
}

function apagarSessaoLocal() {
  try {
    rmSync(arquivoSessao(), { force: true });
  } catch {}
}

function notificar(titulo, corpo) {
  try {
    if (!Notification.isSupported()) return;
    const aviso = new Notification({ title: titulo, body: String(corpo).slice(0, 200) });
    aviso.on("click", () => {
      if (!janela) return;
      if (janela.isMinimized()) janela.restore();
      janela.show();
      janela.focus();
    });
    aviso.show();
  } catch {}
}

function notificarResultado(resposta) {
  if (resposta.aprovacoes?.length) {
    const itens = resposta.aprovacoes.map((a) => a.regra).join(", ");
    notificar("Aprovação necessária", `O Claude Code aguarda sua aprovação: ${itens}`);
  } else if (resposta.status === "concluida") {
    notificar("Tarefa finalizada", "O Claude Code concluiu a tarefa.");
  } else if (resposta.status === "erro") {
    notificar("Tarefa com erro", resposta.resultado ?? "A execução falhou.");
  }
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0A0A0F",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(raiz, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  janela.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  janela.webContents.on("will-navigate", (evento) => evento.preventDefault());
  janela.loadFile(join(raiz, "renderer", "index.html"));
}

function tratar(canal, fn, { exigeSessao = true } = {}) {
  ipcMain.handle(canal, async (_evento, ...args) => {
    try {
      if (exigeSessao && !(await banco.usuarioAtual())) throw new Error("Sessão inválida. Faça login novamente.");
      const dados = await fn(...args);
      return { ok: true, dados };
    } catch (erro) {
      return { ok: false, erro: String(erro?.message ?? erro) };
    }
  });
}

function texto(valor, max = 20000) {
  if (typeof valor !== "string") throw new Error("Valor inválido.");
  return valor.slice(0, max);
}

function idValido(valor) {
  if (typeof valor !== "string" || !/^[0-9a-f-]{36}$/i.test(valor)) throw new Error("Identificador inválido.");
  return valor;
}

function validarConfig(config) {
  const limiar = Number(config?.limiar_confianca);
  if (!Number.isFinite(limiar) || limiar < 0 || limiar > 1) throw new Error("O limiar de confiança deve estar entre 0 e 1.");
  if (!MODOS_PERMISSAO.includes(config?.permission_mode)) throw new Error("Modo de permissão inválido.");
  if (!Array.isArray(config?.allowed_tools)) throw new Error("Lista de ferramentas inválida.");
  const ferramentas = config.allowed_tools.map((item) => texto(item, 200).trim()).filter(Boolean);
  const limiarNoul = Number(config?.limiar_noul);
  if (!Number.isFinite(limiarNoul) || limiarNoul < 0 || limiarNoul > 1) throw new Error("O limiar Noul deve estar entre 0 e 1.");
  if (!["automatico", "claude_code", "antigravity"].includes(config?.modo_executor)) throw new Error("Modo de executor inválido.");
  if (typeof config?.agy_sem_confirmacao !== "boolean") throw new Error("Opção do Antigravity inválida.");
  return { limiar_confianca: limiar, limiar_noul: limiarNoul, modo_executor: config.modo_executor, agy_sem_confirmacao: config.agy_sem_confirmacao, agy_modelos: normalizarModelosAntigravity(config.agy_modelos), permission_mode: config.permission_mode, allowed_tools: ferramentas };
}

function registrarHandlers() {
  banco.definirPersistencia(guardarRefreshToken);

  tratar("ambiente:verificar", async () => ({
    claude: await verificarClaude(),
    agy: await verificarAgy(),
    typesafe: Boolean(process.env.TYPESAFE_API_KEY)
  }), { exigeSessao: false });

  tratar("auth:restaurar", async () => {
    const token = lerRefreshToken();
    if (!token) return null;
    try {
      const sessao = await banco.restaurar(token);
      guardarRefreshToken(sessao.refreshToken);
      return { email: sessao.usuario.email };
    } catch {
      apagarSessaoLocal();
      return null;
    }
  }, { exigeSessao: false });

  tratar("auth:entrar", async (email, senha) => {
    const sessao = await banco.entrar(texto(email, 320), texto(senha, 500));
    guardarRefreshToken(sessao.refreshToken);
    return { email: sessao.usuario.email };
  }, { exigeSessao: false });

  tratar("auth:cadastrar", async (email, senha) => {
    const sessao = await banco.cadastrar(texto(email, 320), texto(senha, 500));
    if (sessao.refreshToken) guardarRefreshToken(sessao.refreshToken);
    return { email: sessao.usuario?.email ?? email, confirmarEmail: sessao.confirmarEmail };
  }, { exigeSessao: false });

  tratar("auth:sair", async () => {
    await banco.sair();
    apagarSessaoLocal();
    return true;
  }, { exigeSessao: false });

  tratar("projetos:listar", () => banco.listarProjetos());

  tratar("projetos:adicionar", async () => {
    const escolha = await dialog.showOpenDialog(janela, { properties: ["openDirectory"], title: "Selecionar pasta do projeto" });
    if (escolha.canceled || escolha.filePaths.length === 0) return null;
    const caminho = escolha.filePaths[0];
    return banco.criarProjeto(basename(caminho) || caminho, caminho);
  });

  tratar("projetos:renomear", async (id, nome) => {
    const novo = texto(nome, 200).trim();
    if (!novo) throw new Error("Informe um nome.");
    return banco.renomearProjeto(idValido(id), novo);
  });

  tratar("projetos:remover", async (id) => {
    const projetoId = idValido(id);
    if (orquestrador.emExecucao(projetoId)) throw new Error("Cancele a execução em andamento antes de remover o projeto.");
    await banco.removerProjeto(projetoId);
    return true;
  });

  tratar("conversas:listar", (projetoId) => banco.listarConversas(idValido(projetoId)));

  tratar("conversas:renomear", async (id, titulo) => {
    const novo = texto(titulo, 200).trim();
    if (!novo) throw new Error("Informe um título.");
    return banco.renomearConversa(idValido(id), novo);
  });

  tratar("conversas:remover", async (id) => {
    const conversa = await banco.obterConversa(idValido(id));
    if (orquestrador.emExecucao(conversa.projeto_id)) throw new Error("Cancele a execução em andamento antes de remover a conversa.");
    await banco.removerConversa(conversa.id);
    return true;
  });

  tratar("anexos:selecionar", async () => {
    const escolha = await dialog.showOpenDialog(janela, { properties: ["openFile", "multiSelections"], title: "Anexar arquivos" });
    if (escolha.canceled) return publicos();
    for (const caminho of escolha.filePaths) {
      const info = statSync(caminho);
      if (!info.isFile()) continue;
      if (info.size > TAMANHO_MAXIMO) throw new Error(`${basename(caminho)} excede 32 MB.`);
      registrarAnexo({ nome: basename(caminho), caminho, tamanho: info.size, temporario: false });
    }
    return publicos();
  });

  tratar("anexos:adicionarBytes", async (nome, bytes) => {
    if (!(bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes))) throw new Error("Conteúdo inválido.");
    const buffer = Buffer.from(bytes instanceof ArrayBuffer ? bytes : bytes.buffer, bytes.byteOffset ?? 0, bytes.byteLength);
    if (buffer.length > TAMANHO_MAXIMO) throw new Error("O arquivo excede 32 MB.");
    const pasta = join(pastaAnexos(), randomUUID());
    mkdirSync(pasta, { recursive: true });
    const caminho = join(pasta, nomeSeguro(nome));
    writeFileSync(caminho, buffer);
    try {
      registrarAnexo({ nome: basename(caminho), caminho, tamanho: buffer.length, temporario: true });
    } catch (erro) {
      rmSync(pasta, { recursive: true, force: true });
      throw erro;
    }
    return publicos();
  });

  tratar("anexos:remover", (id) => {
    descartarAnexo(texto(id, 64));
    return publicos();
  });

  tratar("anexos:limpar", () => {
    limparAnexos();
    return publicos();
  });

  tratar("tarefa:executar", async (dados) => {
    const ids = Array.isArray(dados?.anexoIds) ? dados.anexoIds.map((id) => texto(id, 64)) : [];
    const usados = ids.map((id) => anexos.get(id)).filter((a) => a && existsSync(a.caminho)).map((a) => ({ nome: a.nome, caminho: a.caminho }));
    const aprovadas = Array.isArray(dados?.aprovadas) ? dados.aprovadas.map((item) => texto(item, 200).trim()).filter(Boolean).slice(0, 50) : [];
    try {
      const resposta = await orquestrador.executar({
        projetoId: idValido(dados?.projetoId),
        conversaId: dados?.conversaId ? idValido(dados.conversaId) : null,
        tarefa: texto(dados?.tarefa, 50000),
        modoModelo: texto(dados?.modoModelo, 20),
        modoExecutor: texto(dados?.modoExecutor ?? "automatico", 20),
        timeoutMin: dados?.timeoutMin,
        anexos: usados,
        aprovadas
      });
      notificarResultado(resposta);
      return resposta;
    } finally {
      limparAnexos();
    }
  });

  tratar("tarefa:cancelar", (id) => orquestrador.cancelar(idValido(id)));

  tratar("historico:listar", (id) => banco.listarExecucoes(idValido(id)));

  tratar("config:obter", () => banco.obterConfiguracao());

  tratar("config:salvar", (config) => banco.salvarConfiguracao(validarConfig(config)));
}

process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});

const instancia = app.requestSingleInstanceLock();
if (!instancia) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (janela) {
      if (janela.isMinimized()) janela.restore();
      janela.focus();
    }
  });
  app.whenReady().then(() => {
    rmSync(pastaAnexos(), { recursive: true, force: true });
    registrarHandlers();
    criarJanela();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", limparAnexos);
}
