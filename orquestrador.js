import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { executarClaude, TIMEOUT_PADRAO_MS } from "./claude.js";
import { executarAgy, verificarAgy } from "./agy.js";
import { rotear, MODELOS } from "./roteador.js";
import * as banco from "./supabase.js";

const ativas = new Map();

export const MODOS_MODELO = ["automatico", ...MODELOS];

function pastaValida(caminho) {
  try {
    return existsSync(caminho) && statSync(caminho).isDirectory();
  } catch {
    return false;
  }
}

export function emExecucao(projetoId) {
  return ativas.has(projetoId);
}

export function cancelar(projetoId) {
  const execucao = ativas.get(projetoId);
  if (!execucao) return false;
  execucao.cancelar();
  return true;
}

export function montarPrompt(texto, anexos) {
  if (!anexos || anexos.length === 0) return texto;
  const referencias = anexos.map((a) => (/\s/.test(a.caminho) ? `@"${a.caminho}"` : `@${a.caminho}`));
  return `${texto}\n\nArquivos anexados:\n${referencias.join("\n")}`;
}

export async function executar({ projetoId, conversaId = null, tarefa, modoModelo = "automatico", modoExecutor = "automatico", timeoutMin, anexos = [], aprovadas = [] }) {
  if (!MODOS_MODELO.includes(modoModelo)) throw new Error("Modo de modelo inválido.");
  const texto = String(tarefa ?? "").trim();
  if (!texto) throw new Error("Digite a tarefa a ser executada.");
  if (ativas.has(projetoId)) throw new Error("Já existe uma execução em andamento neste projeto.");

  ativas.set(projetoId, { cancelar() {} });

  const avisos = [];
  try {
    const projeto = await banco.obterProjeto(projetoId);
    if (!pastaValida(projeto.caminho)) throw new Error(`A pasta do projeto não existe mais: ${projeto.caminho}`);

    let conversa;
    if (conversaId) {
      conversa = await banco.obterConversa(conversaId);
      if (conversa.projeto_id !== projetoId) throw new Error("A conversa não pertence a este projeto.");
    } else {
      conversa = await banco.criarConversa(projetoId, texto.replace(/\s+/g, " ").slice(0, 60));
    }

    const config = await banco.obterConfiguracao();

    let modelo = modoModelo;
    let executor = modoExecutor;
    let jev = null;
    if (modoModelo === "automatico" || modoExecutor === "automatico") {
      const rota = await rotear(texto, { ...config, modo_executor: modoExecutor });
      modelo = rota.modelo;
      executor = rota.executor;
      jev = rota.jev;
      if (rota.aviso) avisos.push(rota.aviso);
    }
    if (modoModelo !== "automatico" && executor === "claude_code") modelo = modoModelo;
    const ambienteAgy = executor === "antigravity" ? await verificarAgy() : null;
    if (executor === "antigravity" && !ambienteAgy.disponivel) {
      if (modoExecutor === "antigravity") throw new Error(ambienteAgy.aviso);
      avisos.push(`${ambienteAgy.aviso} Usando Claude Code.`);
      executor = "claude_code";
      modelo = modoModelo === "automatico" ? "sonnet" : modoModelo;
    }
    if (executor === "antigravity" && !modelo) throw new Error("Configure os rótulos dos modelos do Antigravity antes de executar.");

    const minutos = Number(timeoutMin);
    const timeoutMs = Number.isFinite(minutos) && minutos >= 1 && minutos <= 240 ? minutos * 60 * 1000 : TIMEOUT_PADRAO_MS;

    const prompt = montarPrompt(texto, anexos);
    const criarProcesso = (qual, modeloEscolhido) => qual === "antigravity"
      ? executarAgy({ cwd: projeto.caminho, prompt, modelo: modeloEscolhido, permitirSemConfirmacao: config.agy_sem_confirmacao, suportaModelo: ambienteAgy?.suportaModelo ?? true, timeoutMs })
      : executarClaude({ cwd: projeto.caminho, prompt, diretorios: [...new Set(anexos.map((a) => dirname(a.caminho)))], modelo: modeloEscolhido, modoPermissao: config.permission_mode, sessionId: conversa.session_id, ferramentas: [...new Set([...(config.allowed_tools ?? []), ...aprovadas])], timeoutMs });
    if (executor === "antigravity" && !config.agy_sem_confirmacao) avisos.push("No Antigravity, tarefas que editam arquivos ou rodam comandos podem aguardar confirmação até o tempo limite.");
    let processo = criarProcesso(executor, modelo);
    ativas.set(projetoId, processo);

    let saida = await processo.promessa;
    let fallbackDe = null;
    if (saida.status === "erro") {
      const outro = executor === "antigravity" ? "claude_code" : "antigravity";
      const outroAmbiente = outro === "antigravity" ? await verificarAgy() : null;
      if (outro !== "antigravity" || outroAmbiente.disponivel) {
        fallbackDe = executor;
        executor = outro;
        modelo = outro === "claude_code" ? "sonnet" : config.agy_modelos?.flash;
        avisos.push(`Falha no executor inicial. Executando fallback com ${executor}.`);
        processo = criarProcesso(executor, modelo);
        ativas.set(projetoId, processo);
        saida = await processo.promessa;
      }
    }

    if (saida.status === "concluida" && saida.sessionId) {
      try {
        await banco.definirSessionConversa(conversa.id, saida.sessionId);
      } catch (erro) {
        avisos.push(`Não foi possível salvar a sessão do projeto: ${erro.message}`);
      }
    }

    const textoResultado = saida.status === "concluida" ? saida.resultado : saida.erro;

    let execucao = null;
    try {
      execucao = await banco.inserirExecucao({
        projeto_id: projetoId,
        conversa_id: conversa.id,
        tarefa: anexos.length ? `${texto}\n\n[Anexos: ${anexos.map((a) => a.nome).join(", ")}]` : texto,
        modelo,
        modo_modelo: modoModelo,
        executor,
        fallback_de: fallbackDe,
        jev,
        status: saida.status,
        resultado: textoResultado,
        duracao_ms: saida.duracaoMs
      });
    } catch (erro) {
      avisos.push(`Erro ao gravar o histórico: ${erro.message}`);
    }
    try {
      await banco.tocarConversa(conversa.id);
    } catch {}

    return {
      conversaId: conversa.id,
      modelo,
      executor,
      fallbackDe,
      status: saida.status,
      resultado: textoResultado,
      duracaoMs: saida.duracaoMs,
      custoUsd: saida.custoUsd ?? null,
      uso: saida.uso ?? null,
      tipoErro: saida.tipoErro ?? null,
      aprovacoes: saida.negacoes ?? [],
      jev,
      avisos,
      execucao
    };
  } finally {
    ativas.delete(projetoId);
  }
}
