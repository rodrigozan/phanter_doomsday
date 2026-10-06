import { TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";
import { modeloAntigravity } from "./modelos.js";

export const MODELOS = ["haiku", "sonnet", "opus"];
export const LIMIAR_PADRAO = 0.5;
export const LIMIAR_NOUL_PADRAO = 0.7;

export function decidirModelo(respostas, limiar = LIMIAR_PADRAO) {
  const { tipo, complexidade } = respostas;
  if (tipo.confidence < limiar || complexidade.confidence < limiar) return "sonnet";
  const nivel = Math.round(complexidade.score);
  if (nivel >= 2 || tipo.choice === "refatoracao") return "opus";
  if (tipo.choice === "ajuste_simples" && nivel === 0) return "haiku";
  return "sonnet";
}

function valorNoul(resposta) { return Number(resposta?.noul ?? resposta?.score ?? resposta?.probability ?? 0); }

export function decidirRota(respostas, config = {}) {
  const limiar = Number(config.limiar_confianca ?? LIMIAR_PADRAO);
  const limiarNoul = Number(config.limiar_noul ?? LIMIAR_NOUL_PADRAO);
  const automatico = respostas.tipo.confidence < limiar || respostas.complexidade.confidence < limiar ? "claude_code" : [respostas.interface_visual, respostas.multimodal, respostas.contexto_grande].some((r) => valorNoul(r) > limiarNoul) ? "antigravity" : "claude_code";
  const executor = config.modo_executor === "claude_code" || config.modo_executor === "antigravity" ? config.modo_executor : automatico;
  return { executor, modelo: executor === "antigravity" ? modeloAntigravity(config.agy_modelos, respostas.complexidade.score) : decidirModelo(respostas, limiar) };
}

export function extrairBruto(respostas) {
  return { tipo: respostas.tipo.choice, tipo_confianca: respostas.tipo.confidence, complexidade: respostas.complexidade.score, complexidade_confianca: respostas.complexidade.confidence, interface_visual: valorNoul(respostas.interface_visual), multimodal: valorNoul(respostas.multimodal), contexto_grande: valorNoul(respostas.contexto_grande) };
}

const perguntas = {
  tipo: choice("Qual é o tipo principal desta tarefa de desenvolvimento?", { ajuste_simples: "renomear, formatar, mudança pequena e localizada", feature: "implementar funcionalidade ou corrigir bug em poucos arquivos", refatoracao: "refatoração ampla, arquitetura ou mudança em muitos arquivos", investigacao: "entender código, depurar problema difícil ou analisar causa raiz" }),
  complexidade: score("Qual é a complexidade desta tarefa de desenvolvimento?", ["trivial, poucos minutos de trabalho", "moderada, exige entender vários trechos de código", "alta, exige planejamento e raciocínio profundo"]),
  interface_visual: noul("A tarefa envolve interface, layout, CSS, componente visual ou design de tela?"),
  multimodal: noul("A tarefa depende de imagem, captura de tela, vídeo ou navegação em navegador?"),
  contexto_grande: noul("A tarefa exige ler e relacionar uma grande parte do código do projeto?")
};

let cliente = null;
function obterCliente() {
  const chave = process.env.TYPESAFE_API_KEY;
  if (!chave) return null;
  if (!cliente) cliente = new TypeSafeClient({ apiKey: chave });
  return cliente;
}

export async function rotear(tarefa, config = {}) {
  const configuracao = typeof config === "number" ? { limiar_confianca: config } : config;
  const c = obterCliente();
  if (!c) return { executor: "claude_code", modelo: "sonnet", jev: null, fallback: true, aviso: "TYPESAFE_API_KEY ausente. Usando sonnet como padrão." };
  try {
    const resposta = await c.systemOne({ state: { tarefa }, questions: perguntas }, { timeout: 8000, retry: { maxRetries: 1 } });
    const respostas = resposta.answers;
    return { ...decidirRota(respostas, configuracao), jev: { ...extrairBruto(respostas), limiar: configuracao.limiar_confianca ?? LIMIAR_PADRAO, limiar_noul: configuracao.limiar_noul ?? LIMIAR_NOUL_PADRAO }, fallback: false, aviso: null };
  } catch (erro) {
    return { executor: "claude_code", modelo: "sonnet", jev: { erro: String(erro?.message ?? erro) }, fallback: true, aviso: "Falha ao consultar o Jev. Usando sonnet como padrão." };
  }
}
