import { TypeSafeClient, choice, score } from "@typesafe-ai/sdk";

export const MODELOS = ["haiku", "sonnet", "opus"];
export const LIMIAR_PADRAO = 0.5;

export function decidirModelo(respostas, limiar = LIMIAR_PADRAO) {
  const { tipo, complexidade } = respostas;
  if (tipo.confidence < limiar || complexidade.confidence < limiar) return "sonnet";
  const nivel = Math.round(complexidade.score);
  if (nivel >= 2 || tipo.choice === "refatoracao") return "opus";
  if (tipo.choice === "ajuste_simples" && nivel === 0) return "haiku";
  return "sonnet";
}

export function extrairBruto(respostas) {
  return {
    tipo: respostas.tipo.choice,
    tipo_confianca: respostas.tipo.confidence,
    complexidade: respostas.complexidade.score,
    complexidade_confianca: respostas.complexidade.confidence
  };
}

const perguntas = {
  tipo: choice("Qual é o tipo principal desta tarefa de desenvolvimento?", {
    ajuste_simples: "renomear, formatar, mudança pequena e localizada",
    feature: "implementar funcionalidade ou corrigir bug em poucos arquivos",
    refatoracao: "refatoração ampla, arquitetura ou mudança em muitos arquivos",
    investigacao: "entender código, depurar problema difícil ou analisar causa raiz"
  }),
  complexidade: score("Qual é a complexidade desta tarefa de desenvolvimento?", [
    "trivial, poucos minutos de trabalho",
    "moderada, exige entender vários trechos de código",
    "alta, exige planejamento e raciocínio profundo"
  ])
};

let cliente = null;

function obterCliente() {
  const chave = process.env.TYPESAFE_API_KEY;
  if (!chave) return null;
  if (!cliente) cliente = new TypeSafeClient({ apiKey: chave });
  return cliente;
}

export async function rotear(tarefa, limiar = LIMIAR_PADRAO) {
  const c = obterCliente();
  if (!c) {
    return { modelo: "sonnet", jev: null, fallback: true, aviso: "TYPESAFE_API_KEY ausente. Usando sonnet como padrão." };
  }
  try {
    const resposta = await c.systemOne(
      { state: { tarefa }, questions: perguntas },
      { timeout: 8000, retry: { maxRetries: 1 } }
    );
    const respostas = resposta.answers;
    return {
      modelo: decidirModelo(respostas, limiar),
      jev: { ...extrairBruto(respostas), limiar },
      fallback: false,
      aviso: null
    };
  } catch (erro) {
    return {
      modelo: "sonnet",
      jev: { erro: String(erro?.message ?? erro) },
      fallback: true,
      aviso: "Falha ao consultar o Jev. Usando sonnet como padrão."
    };
  }
}
