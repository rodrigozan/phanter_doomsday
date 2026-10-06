import { createClient } from "@supabase/supabase-js";

let cliente = null;
let aoAtualizarSessao = () => {};

function obter() {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_ANON_KEY;
  if (!url || !chave) throw new Error("SUPABASE_URL e SUPABASE_ANON_KEY precisam estar definidas no arquivo .env.");
  cliente = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } });
  cliente.auth.onAuthStateChange((evento, sessao) => {
    if (sessao?.refresh_token && evento === "TOKEN_REFRESHED") aoAtualizarSessao(sessao.refresh_token);
  });
  return cliente;
}

function checar({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export function definirPersistencia(fn) {
  aoAtualizarSessao = fn;
}

export async function entrar(email, senha) {
  const dados = checar(await obter().auth.signInWithPassword({ email, password: senha }));
  return { usuario: dados.user, refreshToken: dados.session.refresh_token };
}

export async function cadastrar(email, senha) {
  const dados = checar(await obter().auth.signUp({ email, password: senha }));
  if (!dados.session) return { usuario: dados.user, refreshToken: null, confirmarEmail: true };
  return { usuario: dados.user, refreshToken: dados.session.refresh_token, confirmarEmail: false };
}

export async function restaurar(refreshToken) {
  const dados = checar(await obter().auth.refreshSession({ refresh_token: refreshToken }));
  if (!dados.session) throw new Error("Sessão expirada.");
  return { usuario: dados.user, refreshToken: dados.session.refresh_token };
}

export async function sair() {
  if (!cliente) return;
  await cliente.auth.signOut({ scope: "local" });
}

export async function usuarioAtual() {
  if (!cliente) return null;
  const { data } = await cliente.auth.getSession();
  return data.session?.user ?? null;
}

export async function listarProjetos() {
  return checar(await obter().from("projetos").select("*").order("created_at", { ascending: false }));
}

export async function obterProjeto(id) {
  return checar(await obter().from("projetos").select("*").eq("id", id).single());
}

export async function criarProjeto(nome, caminho) {
  return checar(await obter().from("projetos").insert({ nome, caminho }).select().single());
}

export async function renomearProjeto(id, nome) {
  return checar(await obter().from("projetos").update({ nome }).eq("id", id).select().single());
}

export async function removerProjeto(id) {
  checar(await obter().from("projetos").delete().eq("id", id));
}

export async function listarConversas(projetoId) {
  return checar(await obter().from("conversas").select("*").eq("projeto_id", projetoId).order("updated_at", { ascending: false }).limit(200));
}

export async function obterConversa(id) {
  return checar(await obter().from("conversas").select("*").eq("id", id).single());
}

export async function criarConversa(projetoId, titulo) {
  return checar(await obter().from("conversas").insert({ projeto_id: projetoId, titulo }).select().single());
}

export async function renomearConversa(id, titulo) {
  return checar(await obter().from("conversas").update({ titulo }).eq("id", id).select().single());
}

export async function removerConversa(id) {
  checar(await obter().from("conversas").delete().eq("id", id));
}

export async function definirSessionConversa(id, sessionId) {
  checar(await obter().from("conversas").update({ session_id: sessionId }).eq("id", id));
}

export async function tocarConversa(id) {
  checar(await obter().from("conversas").update({ updated_at: new Date().toISOString() }).eq("id", id));
}

export async function inserirExecucao(dados) {
  return checar(await obter().from("execucoes").insert(dados).select().single());
}

export async function listarExecucoes(conversaId) {
  return checar(
    await obter().from("execucoes").select("*").eq("conversa_id", conversaId).order("created_at", { ascending: true }).limit(500)
  );
}

export async function obterConfiguracao() {
  const usuario = await usuarioAtual();
  const existente = checar(await obter().from("configuracoes").select("*").eq("user_id", usuario.id).maybeSingle());
  if (existente) return existente;
  return checar(await obter().from("configuracoes").insert({}).select().single());
}

export async function salvarConfiguracao(config) {
  const usuario = await usuarioAtual();
  const registro = {
    user_id: usuario.id,
    limiar_confianca: config.limiar_confianca,
    permission_mode: config.permission_mode,
    allowed_tools: config.allowed_tools,
    updated_at: new Date().toISOString()
  };
  return checar(await obter().from("configuracoes").upsert(registro).select().single());
}
