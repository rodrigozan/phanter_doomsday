import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { executarClaude, TIMEOUT_PADRAO_MS } from "./claude.js";
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

export async function executar({ projetoId, conversaId = null, tarefa, modoModelo = "automatico", timeoutMin, anexos = [], aprovadas = [] }) {
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
    let jev = null;
    if (modoModelo === "automatico") {
      const rota = await rotear(texto, Number(config.limiar_confianca));
      modelo = rota.modelo;
      jev = rota.jev;
      if (rota.aviso) avisos.push(rota.aviso);
    }

    const minutos = Number(timeoutMin);
    const timeoutMs = Number.isFinite(minutos) && minutos >= 1 && minutos <= 240 ? minutos * 60 * 1000 : TIMEOUT_PADRAO_MS;

    const processo = executarClaude({
      cwd: projeto.caminho,
      prompt: montarPrompt(texto, anexos),
      diretorios: [...new Set(anexos.map((a) => dirname(a.caminho)))],
      modelo,
      modoPermissao: config.permission_mode,
      sessionId: conversa.session_id,
      ferramentas: [...new Set([...(config.allowed_tools ?? []), ...aprovadas])],
      timeoutMs
    });
    ativas.set(projetoId, processo);

    const saida = await processo.promessa;

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
