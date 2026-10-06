const raiz = document.getElementById("raiz");
const api = window.api;

const estado = {
  email: null,
  projetos: [],
  projetoId: null,
  conversas: [],
  conversaId: null,
  historico: [],
  pendente: null,
  execucaoAtual: null,
  executando: new Set(),
  modoModelo: "automatico",
  modoExecutor: "automatico",
  modoPermissao: "acceptEdits",
  configuracao: null,
  timeoutMin: 30,
  tarefa: "",
  anexos: [],
  avisoAmbiente: null
};

const CHAVE_TEMA = "doomsday.tema";

function lerTema() {
  try {
    return localStorage.getItem(CHAVE_TEMA) === "claro" ? "claro" : "escuro";
  } catch {
    return "escuro";
  }
}

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
}

function alternarTema() {
  const novo = lerTema() === "claro" ? "escuro" : "claro";
  try {
    localStorage.setItem(CHAVE_TEMA, novo);
  } catch {
    estado.avisoAmbiente = "Não foi possível salvar a preferência de tema.";
  }
  aplicarTema(novo);
  renderPrincipal();
}

aplicarTema(lerTema());

function el(tag, props = {}, ...filhos) {
  const no = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props)) {
    if (chave === "class") no.className = valor;
    else if (chave.startsWith("on")) no.addEventListener(chave.slice(2), valor);
    else if (valor === true) no.setAttribute(chave, "");
    else if (valor !== false && valor != null) no.setAttribute(chave, valor);
  }
  for (const filho of filhos.flat()) {
    if (filho == null || filho === false) continue;
    no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  return no;
}

function montar(...nos) {
  raiz.replaceChildren(...nos);
}

async function chamar(promessa) {
  const resposta = await promessa;
  if (!resposta.ok) throw new Error(resposta.erro);
  return resposta.dados;
}

function formatarDuracao(ms) {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

function formatarData(iso) {
  return iso ? new Date(iso).toLocaleString("pt-BR") : "-";
}

function formatarTamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function enviarArquivos(arquivos) {
  for (const arquivo of arquivos) {
    try {
      estado.anexos = await chamar(api.anexos.adicionarBytes(arquivo.name || "colado", await arquivo.arrayBuffer()));
    } catch (erro) {
      estado.avisoAmbiente = erro.message;
    }
  }
  renderPrincipal();
}

async function selecionarAnexos() {
  try {
    estado.anexos = await chamar(api.anexos.selecionar());
  } catch (erro) {
    estado.avisoAmbiente = erro.message;
  }
  renderPrincipal();
}

async function removerAnexo(id) {
  try {
    estado.anexos = await chamar(api.anexos.remover(id));
  } catch (erro) {
    estado.avisoAmbiente = erro.message;
  }
  renderPrincipal();
}

function projetoAtual() {
  return estado.projetos.find((p) => p.id === estado.projetoId) ?? null;
}

function telaOrientacaoClaude() {
  montar(
    el("div", { class: "centro" },
      el("div", { class: "cartao largo" },
        el("h1", { class: "titulo-gradiente" }, "Claude Code não encontrado"),
        el("p", {}, "O comando ", el("code", {}, "claude"), " não está disponível no PATH deste computador."),
        el("p", { class: "fog" }, "Instale o Claude Code, abra um terminal, execute ", el("code", {}, "claude"), " e faça o login com ", el("code", {}, "/login"), ". Depois reabra este aplicativo."),
        el("button", { class: "primario", onclick: iniciar }, "Verificar novamente")
      )
    )
  );
}

function telaLogin(mensagem = null, tipo = "erro") {
  const email = el("input", { type: "email", placeholder: "voce@exemplo.com", autocomplete: "username" });
  const senha = el("input", { type: "password", placeholder: "Senha", autocomplete: "current-password" });
  const aviso = el("div", { class: mensagem ? tipo : "" }, mensagem ?? "");
  const entrar = el("button", { class: "primario" }, "Entrar");
  const criar = el("button", {}, "Criar conta");

  async function enviar(acao) {
    aviso.className = "fog";
    aviso.textContent = "Aguarde...";
    entrar.disabled = true;
    criar.disabled = true;
    try {
      const dados = await chamar(acao === "entrar" ? api.auth.entrar(email.value.trim(), senha.value) : api.auth.cadastrar(email.value.trim(), senha.value));
      if (dados.confirmarEmail) {
        telaLogin("Conta criada. Confirme o e-mail recebido e depois entre.", "ok");
        return;
      }
      estado.email = dados.email;
      await abrirPrincipal();
    } catch (erro) {
      aviso.className = "erro";
      aviso.textContent = erro.message;
      entrar.disabled = false;
      criar.disabled = false;
    }
  }

  entrar.addEventListener("click", () => enviar("entrar"));
  criar.addEventListener("click", () => enviar("cadastrar"));
  senha.addEventListener("keydown", (e) => { if (e.key === "Enter") enviar("entrar"); });

  montar(
    el("div", { class: "centro" },
      el("div", { class: "cartao" },
        el("h1", { class: "titulo-gradiente" }, "Doomsday"),
        el("div", { class: "fog" }, "Phanter AI · Claude Code"),
        el("div", { class: "campo" }, el("label", {}, "E-mail"), email),
        el("div", { class: "campo" }, el("label", {}, "Senha"), senha),
        aviso,
        el("div", { class: "linha" }, entrar, criar)
      )
    )
  );
}

async function carregarProjetos() {
  estado.projetos = await chamar(api.projetos.listar());
  if (!estado.projetos.some((p) => p.id === estado.projetoId)) estado.projetoId = estado.projetos[0]?.id ?? null;
}

async function carregarConversas() {
  const projeto = projetoAtual();
  estado.conversas = projeto ? await chamar(api.conversas.listar(projeto.id)) : [];
  if (estado.conversaId && !estado.conversas.some((c) => c.id === estado.conversaId)) estado.conversaId = null;
}

async function carregarHistorico() {
  estado.historico = estado.conversaId ? await chamar(api.historico.listar(estado.conversaId)) : [];
}

async function carregarTudo() {
  await carregarProjetos();
  await carregarConversas();
  await carregarHistorico();
}

async function abrirPrincipal() {
  try {
    await Promise.all([
      carregarTudo(),
      chamar(api.config.obter()).then((config) => {
        estado.configuracao = config;
        estado.modoPermissao = config.permission_mode ?? "acceptEdits";
      })
    ]);
  } catch (erro) {
    estado.avisoAmbiente = erro.message;
  }
  renderPrincipal();
}

async function selecionarProjeto(id) {
  estado.projetoId = id;
  estado.conversaId = null;
  estado.execucaoAtual = null;
  try {
    await carregarConversas();
    await carregarHistorico();
  } catch (erro) {
    estado.conversas = [];
    estado.historico = [];
    estado.avisoAmbiente = erro.message;
  }
  renderPrincipal();
}

async function selecionarConversa(id) {
  if (estado.conversaId === id) return;
  estado.conversaId = id;
  estado.execucaoAtual = null;
  try {
    await carregarHistorico();
  } catch (erro) {
    estado.historico = [];
    estado.avisoAmbiente = erro.message;
  }
  renderPrincipal();
}

function novaConversa() {
  estado.conversaId = null;
  estado.historico = [];
  estado.execucaoAtual = null;
  renderPrincipal();
}

function dialogoTexto({ titulo, valor, acao, rotulo }) {
  const campo = el("input", { value: valor });
  const aviso = el("div", { class: "erro" });
  const sobre = el("div", { class: "centro sobreposicao" },
    el("div", { class: "cartao" },
      el("h2", {}, titulo),
      campo,
      aviso,
      el("div", { class: "linha" },
        el("button", {
          class: "primario",
          onclick: async () => {
            try {
              await acao(campo.value);
              sobre.remove();
            } catch (erro) {
              aviso.textContent = erro.message;
            }
          }
        }, rotulo),
        el("button", { onclick: () => sobre.remove() }, "Cancelar")
      )
    )
  );
  document.body.append(sobre);
  campo.focus();
}

function renomearConversa(conversa) {
  dialogoTexto({
    titulo: "Renomear conversa",
    valor: conversa.titulo,
    rotulo: "Salvar",
    acao: async (valor) => {
      await chamar(api.conversas.renomear(conversa.id, valor));
      await carregarConversas();
      renderPrincipal();
    }
  });
}

function removerConversa(conversa) {
  const sobre = el("div", { class: "centro sobreposicao" },
    el("div", { class: "cartao" },
      el("h2", {}, "Remover conversa"),
      el("p", { class: "fog" }, `A conversa "${conversa.titulo}" e suas mensagens serão removidas. Nenhum arquivo em disco será alterado.`),
      el("div", { class: "linha" },
        el("button", {
          class: "perigo",
          onclick: async () => {
            sobre.remove();
            try {
              await chamar(api.conversas.remover(conversa.id));
              if (estado.conversaId === conversa.id) {
                estado.conversaId = null;
                estado.historico = [];
                estado.execucaoAtual = null;
              }
              await carregarConversas();
            } catch (erro) {
              estado.avisoAmbiente = erro.message;
            }
            renderPrincipal();
          }
        }, "Remover"),
        el("button", { onclick: () => sobre.remove() }, "Cancelar")
      )
    )
  );
  document.body.append(sobre);
}

async function adicionarProjeto() {
  try {
    const novo = await chamar(api.projetos.adicionar());
    if (!novo) return;
    estado.projetoId = novo.id;
    estado.conversaId = null;
    await carregarTudo();
    estado.execucaoAtual = null;
    renderPrincipal();
  } catch (erro) {
    estado.avisoAmbiente = erro.message;
    renderPrincipal();
  }
}

async function renomearProjeto(projeto) {
  const campo = el("input", { value: projeto.nome });
  const aviso = el("div", { class: "erro" });
  const sobre = el("div", { class: "centro sobreposicao" },
    el("div", { class: "cartao" },
      el("h2", {}, "Renomear projeto"),
      campo,
      aviso,
      el("div", { class: "linha" },
        el("button", {
          class: "primario",
          onclick: async () => {
            try {
              await chamar(api.projetos.renomear(projeto.id, campo.value));
              sobre.remove();
              await carregarProjetos();
              renderPrincipal();
            } catch (erro) {
              aviso.textContent = erro.message;
            }
          }
        }, "Salvar"),
        el("button", { onclick: () => sobre.remove() }, "Cancelar")
      )
    )
  );
  document.body.append(sobre);
  campo.focus();
}

async function removerProjeto(projeto) {
  const sobre = el("div", { class: "centro sobreposicao" },
    el("div", { class: "cartao" },
      el("h2", {}, "Remover projeto"),
      el("p", { class: "fog" }, `O projeto "${projeto.nome}" e todo o histórico dele serão removidos. Nenhum arquivo em disco será alterado.`),
      el("div", { class: "linha" },
        el("button", {
          class: "perigo",
          onclick: async () => {
            sobre.remove();
            try {
              await chamar(api.projetos.remover(projeto.id));
              estado.projetoId = null;
              estado.execucaoAtual = null;
              await carregarTudo();
            } catch (erro) {
              estado.avisoAmbiente = erro.message;
            }
            renderPrincipal();
          }
        }, "Remover"),
        el("button", { onclick: () => sobre.remove() }, "Cancelar")
      )
    )
  );
  document.body.append(sobre);
}

async function executar(continuacao = null) {
  const projeto = projetoAtual();
  if (!projeto) return;
  const tarefa = continuacao ? continuacao.tarefa : estado.tarefa.trim();
  if (!tarefa) {
    estado.execucaoAtual = { status: "erro", resultado: "Digite a tarefa a ser executada.", avisos: [] };
    renderPrincipal();
    return;
  }
  if (estado.executando.has(projeto.id)) {
    estado.execucaoAtual = { status: "erro", resultado: "Já existe uma execução em andamento neste projeto.", avisos: [] };
    renderPrincipal();
    return;
  }
  const conversaOrigem = estado.conversaId;
  const anexoIds = continuacao ? [] : estado.anexos.map((a) => a.id);
  estado.executando.add(projeto.id);
  estado.execucaoAtual = null;
  estado.pendente = { projetoId: projeto.id, conversaId: conversaOrigem, tarefa: continuacao ? "Aprovado. Prosseguir com as ações pendentes." : tarefa };
  if (!continuacao) estado.tarefa = "";
  renderPrincipal();
  let resposta;
  try {
    resposta = await chamar(api.tarefa.executar({ projetoId: projeto.id, conversaId: conversaOrigem, tarefa, modoModelo: estado.modoModelo, modoExecutor: estado.modoExecutor, modoPermissao: estado.modoPermissao, timeoutMin: Number(estado.timeoutMin), anexoIds, aprovadas: continuacao ? continuacao.aprovadas : [] }));
  } catch (erro) {
    resposta = { status: "erro", resultado: erro.message, avisos: [], modelo: null };
  }
  estado.executando.delete(projeto.id);
  estado.pendente = null;
  estado.anexos = [];
  if (!continuacao && resposta.status === "erro" && !resposta.execucao && !estado.tarefa) estado.tarefa = tarefa;
  if (projeto.id !== estado.projetoId) return;
  const mesmaConversa = estado.conversaId === conversaOrigem;
  if (resposta.conversaId && mesmaConversa) estado.conversaId = resposta.conversaId;
  if (mesmaConversa) estado.execucaoAtual = resposta;
  try {
    await carregarTudo();
  } catch (erro) {
    estado.avisoAmbiente = erro.message;
  }
  renderPrincipal();
}

function aprovar(exec) {
  executar({
    tarefa: "Aprovado. Prossiga com as ações que foram negadas por falta de permissão e conclua a tarefa.",
    aprovadas: exec.aprovacoes.map((a) => a.regra)
  });
}

function negar() {
  if (estado.execucaoAtual) estado.execucaoAtual = { ...estado.execucaoAtual, aprovacoes: [], avisos: [...(estado.execucaoAtual.avisos ?? []), "Aprovação negada. Nenhuma permissão adicional foi concedida."] };
  renderPrincipal();
}

function blocoAprovacao(exec) {
  if (!exec.aprovacoes?.length) return null;
  return el("div", { class: "aprovacao" },
    el("div", { class: "aviso" }, "O Claude Code precisa da sua aprovação para continuar:"),
    exec.aprovacoes.map((a) => el("div", { class: "aprovacao-item" },
      el("span", { class: "selo" }, a.regra),
      a.descricao ? el("span", { class: "fog" }, a.descricao) : null
    )),
    el("div", { class: "linha" },
      el("button", { class: "primario", onclick: () => aprovar(exec) }, "Aprovar e continuar"),
      el("button", { class: "perigo", onclick: negar }, "Negar")
    )
  );
}

async function cancelar() {
  const projeto = projetoAtual();
  if (!projeto) return;
  try {
    await chamar(api.tarefa.cancelar(projeto.id));
  } catch (erro) {
    estado.avisoAmbiente = erro.message;
  }
}

function blocoJev(jev) {
  if (!jev) return null;
  return el("pre", { class: "codigo" }, JSON.stringify(jev, null, 2));
}

function mensagemUsuario(texto) {
  return el("div", { class: "msg usuario" }, el("div", { class: "balao" }, texto));
}

function mensagemClaude(h) {
  return el("div", { class: "msg claude" },
    el("div", { class: "linha quebra meta" },
      h.modelo ? el("span", { class: `selo ${h.modelo}` }, h.modelo) : null,
      h.executor ? el("span", { class: "selo" }, h.executor) : null,
      h.fallback_de ? el("span", { class: "aviso" }, `fallback de ${h.fallback_de}`) : null,
      el("span", { class: `selo ${h.status}` }, h.status),
      h.created_at ? el("span", { class: "fog" }, formatarData(h.created_at)) : null,
      h.duracao_ms != null ? el("span", { class: "fog" }, formatarDuracao(h.duracao_ms)) : null
    ),
    el("div", { class: "resultado" }, h.resultado ?? ""),
    h.jev ? el("details", {}, el("summary", { class: "fog" }, `Roteamento Jev · modo ${h.modo_modelo}`), blocoJev(h.jev)) : null
  );
}

function blocoAtual(exec) {
  if (!exec) return null;
  const mensagens = [];
  for (const aviso of exec.avisos ?? []) mensagens.push(el("div", { class: "aviso" }, aviso));
  if (exec.tipoErro === "autenticacao") {
    mensagens.push(el("div", { class: "aviso" }, "O Claude Code não está autenticado. Abra um terminal, execute claude e faça o login com /login."));
  }
  const rodape = [];
  if (exec.custoUsd != null) rodape.push(`Custo: US$ ${Number(exec.custoUsd).toFixed(4)}`);
  if (exec.uso) rodape.push(`Tokens: ${exec.uso.input_tokens ?? 0} entrada / ${exec.uso.output_tokens ?? 0} saída`);
  return el("div", { class: "msg claude" },
    mensagens,
    exec.execucao ? null : el("div", { class: exec.status === "erro" ? "erro" : "fog" }, exec.resultado ?? ""),
    rodape.length ? el("div", { class: "fog" }, rodape.join(" · ")) : null,
    blocoAprovacao(exec)
  );
}

function painelConversa(projeto) {
  const rodando = estado.executando.has(projeto.id);
  const conversa = estado.conversas.find((c) => c.id === estado.conversaId) ?? null;
  const itens = [];
  for (const h of estado.historico) {
    itens.push(mensagemUsuario(h.tarefa), mensagemClaude(h));
  }
  if (estado.pendente && estado.pendente.projetoId === projeto.id && estado.pendente.conversaId === estado.conversaId) {
    itens.push(mensagemUsuario(estado.pendente.tarefa), el("div", { class: "msg claude" }, el("div", { class: "ok" }, "Executando...")));
  } else {
    itens.push(blocoAtual(estado.execucaoAtual));
  }
  const vazio = !itens.some(Boolean);
  return el("div", { class: "thread" },
    el("div", { class: "cabecalho-conversa" },
      el("div", {},
        el("h2", {}, conversa ? conversa.titulo : "Nova conversa"),
        el("div", { class: "fog" }, `${projeto.nome} · ${projeto.caminho}`)
      ),
      el("span", { class: "selo" }, conversa?.session_id ? "Contexto preservado" : "Sem contexto")
    ),
    vazio
      ? el("div", { class: "vazio fog" }, "Descreva a tarefa abaixo para iniciar a conversa. Depois você pode continuar daqui a qualquer momento.")
      : el("div", { class: "mensagens" }, itens)
  );
}

function compositor(projeto) {
  const rodando = estado.executando.has(projeto.id);
  const campo = el("textarea", { placeholder: estado.conversaId ? "Continue a conversa..." : "Descreva a tarefa para o Claude Code...", disabled: rodando, rows: "3" }, "");
  campo.value = estado.tarefa;
  campo.addEventListener("input", () => { estado.tarefa = campo.value; });
  campo.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter" && !evento.shiftKey && !evento.isComposing) {
      evento.preventDefault();
      if (!rodando) executar();
    }
  });
  campo.addEventListener("paste", (evento) => {
    const arquivos = [...(evento.clipboardData?.files ?? [])];
    if (arquivos.length === 0 || rodando) return;
    evento.preventDefault();
    enviarArquivos(arquivos);
  });

  const chips = estado.anexos.map((a) =>
    el("span", { class: "chip" },
      el("span", { class: "chip-nome" }, a.nome),
      el("span", { class: "fog" }, formatarTamanho(a.tamanho)),
      el("button", { class: "chip-remover", title: "Remover anexo", disabled: rodando, onclick: () => removerAnexo(a.id) }, "×")
    )
  );

  const modelosGemini = [
    ["flash", "Gemini Flash"],
    ["flash_alto", "Gemini Flash (alto)"],
    ["pro", "Gemini Pro"]
  ].map(([chave, padrao]) => [chave, estado.configuracao?.agy_modelos?.[chave] || padrao]);
  const opcoesModelo = estado.modoExecutor === "antigravity"
    ? [["automatico", "Automático (Gemini)"], ...modelosGemini]
    : [["automatico", "Automático (Jev)"], ["haiku", "haiku"], ["sonnet", "sonnet"], ["opus", "opus"]];
  const modelo = el("select", { disabled: rodando, title: "Modelo" },
    opcoesModelo.map(([valor, rotulo]) => {
      const opcao = el("option", { value: valor }, rotulo);
      if (valor === estado.modoModelo) opcao.selected = true;
      return opcao;
    })
  );
  modelo.addEventListener("change", () => { estado.modoModelo = modelo.value; });

  const executor = el("select", { disabled: rodando },
    [["automatico", "Executor automático"], ["claude_code", "Claude Code"], ["antigravity", "Antigravity"]].map(([valor, rotulo]) => {
      const opcao = el("option", { value: valor }, rotulo);
      if (valor === estado.modoExecutor) opcao.selected = true;
      return opcao;
    })
  );
  executor.addEventListener("change", () => {
    estado.modoExecutor = executor.value;
    estado.modoModelo = "automatico";
    renderPrincipal();
  });

  const modo = el("select", { disabled: rodando, title: "Modo de execução" },
    [["acceptEdits", "Automático"], ["default", "Edição manual"], ["plan", "Plano"]].map(([valor, rotulo]) => {
      const opcao = el("option", { value: valor }, rotulo);
      if (valor === estado.modoPermissao) opcao.selected = true;
      return opcao;
    })
  );
  modo.addEventListener("change", () => { estado.modoPermissao = modo.value; });

  const tempo = el("input", { type: "number", min: "1", max: "240", value: String(estado.timeoutMin), class: "curto", title: "Tempo limite (min)", disabled: rodando });
  tempo.addEventListener("input", () => { estado.timeoutMin = tempo.value; });

  const caixa = el("div", { class: "compositor" },
    chips.length ? el("div", { class: "linha quebra" }, chips) : null,
    campo,
    estado.modoExecutor === "antigravity" ? el("div", { class: "aviso" }, "Nova conversa não reinicia o contexto do Antigravity.") : null,
    el("div", { class: "linha quebra" },
      el("button", { onclick: selecionarAnexos, disabled: rodando }, "Anexar"),
      executor,
      modelo,
      modo,
      el("span", { class: "fog" }, "min"),
      tempo,
      el("div", { class: "expande" }),
      rodando
        ? el("button", { class: "perigo", onclick: cancelar }, "Cancelar")
        : el("button", { class: "primario", onclick: () => executar() }, "Enviar")
    )
  );

  caixa.addEventListener("dragover", (evento) => {
    evento.preventDefault();
    if (!rodando) caixa.classList.add("soltar");
  });
  caixa.addEventListener("dragleave", () => caixa.classList.remove("soltar"));
  caixa.addEventListener("drop", (evento) => {
    evento.preventDefault();
    caixa.classList.remove("soltar");
    const arquivos = [...(evento.dataTransfer?.files ?? [])];
    if (arquivos.length > 0 && !rodando) enviarArquivos(arquivos);
  });

  return caixa;
}

function renderPrincipal() {
  const projeto = projetoAtual();
  const lista = estado.projetos.map((p) => {
    const ativo = p.id === estado.projetoId;
    return el("div", { class: "grupo-projeto" },
      el("div", { class: `item-projeto${ativo && !estado.conversaId ? " ativo" : ""}`, onclick: () => selecionarProjeto(p.id) },
        el("strong", {}, p.nome),
        el("span", { class: "caminho" }, p.caminho),
        ativo
          ? el("div", { class: "linha" },
              el("button", { class: "pequeno", onclick: (e) => { e.stopPropagation(); renomearProjeto(p); } }, "Renomear"),
              el("button", { class: "pequeno perigo", onclick: (e) => { e.stopPropagation(); removerProjeto(p); } }, "Remover")
            )
          : null
      ),
      ativo
        ? el("div", { class: "conversas" },
            el("button", { class: "pequeno", onclick: novaConversa }, "+ Nova conversa"),
            estado.conversas.map((c) =>
              el("div", { class: `item-conversa${c.id === estado.conversaId ? " ativa" : ""}`, title: c.titulo, onclick: () => selecionarConversa(c.id) },
                el("span", { class: "titulo-conversa" }, c.titulo),
                el("span", { class: "acoes-conversa" },
                  el("button", { class: "icone", title: "Renomear", onclick: (e) => { e.stopPropagation(); renomearConversa(c); } }, "✎"),
                  el("button", { class: "icone", title: "Remover", onclick: (e) => { e.stopPropagation(); removerConversa(c); } }, "×")
                )
              )
            ),
            estado.conversas.length ? null : el("div", { class: "fog" }, "Nenhuma conversa ainda.")
          )
        : null
    );
  });

  const lateral = el("aside", { class: "lateral" },
    el("h2", { class: "titulo-gradiente" }, "Doomsday"),
    el("button", { class: "primario", onclick: adicionarProjeto }, "Adicionar projeto"),
    el("div", { class: "lista" }, lista.length ? lista : el("div", { class: "fog" }, "Nenhum projeto adicionado.")),
    el("div", { class: "fog" }, estado.email),
    el("div", { class: "linha quebra" },
      el("button", { class: "pequeno", onclick: telaConfiguracoes }, "Configurações"),
      el("button", { class: "pequeno", onclick: sair }, "Sair"),
      el("button", { class: "pequeno", title: "Alternar entre tema claro e escuro", onclick: alternarTema }, lerTema() === "claro" ? "☾ Tema escuro" : "☀ Tema claro")
    )
  );

  const principal = el("main", { class: "principal" },
    estado.avisoAmbiente ? el("div", { class: "aviso faixa" }, estado.avisoAmbiente) : null,
    projeto ? painelConversa(projeto) : el("div", { class: "thread" }, el("div", { class: "vazio fog" }, "Selecione ou adicione um projeto")),
    projeto ? compositor(projeto) : null
  );

  montar(el("div", { class: "app" }, lateral, principal));
  const mensagens = raiz.querySelector(".thread");
  if (mensagens) mensagens.scrollTop = mensagens.scrollHeight;
  const campo = raiz.querySelector(".compositor textarea");
  if (campo && !campo.disabled) campo.focus();
}

async function telaConfiguracoes() {
  let config;
  try {
    config = await chamar(api.config.obter());
  } catch (erro) {
    estado.avisoAmbiente = erro.message;
    renderPrincipal();
    return;
  }
  const limiar = el("input", { type: "number", min: "0", max: "1", step: "0.05", value: String(config.limiar_confianca) });
  const limiarNoul = el("input", { type: "number", min: "0", max: "1", step: "0.05", value: String(config.limiar_noul ?? 0.7) });
  const modoExecutor = el("select", {}, ["automatico", "claude_code", "antigravity"].map((m) => { const opcao = el("option", { value: m }, m); if (m === (config.modo_executor ?? "automatico")) opcao.selected = true; return opcao; }));
  const semConfirmacao = el("input", { type: "checkbox" });
  semConfirmacao.checked = Boolean(config.agy_sem_confirmacao);
  const modelosAgy = el("textarea", { placeholder: "flash=\nflash_alto=\npro=" });
  modelosAgy.value = Object.entries(config.agy_modelos ?? {}).map(([chave, valor]) => `${chave}=${valor}`).join("\n");
  const modo = el("select", {},
    [["acceptEdits", "Automático"], ["default", "Edição manual"], ["plan", "Plano"]].map(([valor, rotulo]) => {
      const opcao = el("option", { value: valor }, rotulo);
      if (valor === config.permission_mode) opcao.selected = true;
      return opcao;
    })
  );
  const ferramentas = el("textarea", { placeholder: "Uma por linha. Ex.: Edit, Write, Bash(git *)" });
  ferramentas.value = (config.allowed_tools ?? []).join("\n");
  const aviso = el("div", {});

  montar(
    el("div", { class: "centro" },
      el("div", { class: "cartao largo" },
        el("h1", { class: "titulo-gradiente" }, "Configurações"),
        el("div", { class: "campo" }, el("label", {}, "Limiar de confiança do Jev (0 a 1)"), limiar),
        el("div", { class: "campo" }, el("label", {}, "Limiar do Noul (0 a 1)"), limiarNoul),
        el("div", { class: "campo" }, el("label", {}, "Executor padrão"), modoExecutor),
        el("div", { class: "campo" }, el("label", {}, "Modelos do Antigravity (chave=rótulo exibido pelo agy models)"), modelosAgy),
        el("div", { class: "linha" }, semConfirmacao, el("label", {}, "Permitir ações sem confirmação no Antigravity")),
        el("div", { class: "campo" }, el("label", {}, "Modo de permissão"), modo),
        el("div", { class: "campo" }, el("label", {}, "Ferramentas permitidas"), ferramentas),
        aviso,
        el("div", { class: "linha" },
          el("button", {
            class: "primario",
            onclick: async () => {
              try {
                const agyModelos = Object.fromEntries(modelosAgy.value.split(/\r?\n/).map((linha) => linha.split(/=(.*)/s)).filter(([chave, valor]) => chave && valor != null).map(([chave, valor]) => [chave.trim(), valor.trim()]));
                await chamar(api.config.salvar({
                  limiar_confianca: Number(limiar.value),
                  limiar_noul: Number(limiarNoul.value),
                  modo_executor: modoExecutor.value,
                  agy_sem_confirmacao: semConfirmacao.checked,
                  agy_modelos: agyModelos,
                  permission_mode: modo.value,
                  allowed_tools: ferramentas.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
                }));
                estado.configuracao = { ...config, agy_modelos: agyModelos, permission_mode: modo.value };
                estado.modoPermissao = modo.value;
                aviso.className = "ok";
                aviso.textContent = "Configurações salvas.";
              } catch (erro) {
                aviso.className = "erro";
                aviso.textContent = erro.message;
              }
            }
          }, "Salvar"),
          el("button", { onclick: renderPrincipal }, "Voltar")
        )
      )
    )
  );
}

async function sair() {
  await api.auth.sair();
  await api.anexos.limpar();
  estado.anexos = [];
  estado.email = null;
  estado.projetos = [];
  estado.projetoId = null;
  estado.conversas = [];
  estado.conversaId = null;
  estado.historico = [];
  estado.pendente = null;
  estado.execucaoAtual = null;
  estado.avisoAmbiente = null;
  telaLogin();
}

async function iniciar() {
  montar(el("div", { class: "centro" }, el("div", { class: "fog" }, "Carregando...")));
  try {
    const ambiente = await chamar(api.ambiente.verificar());
    if (!ambiente.claude.disponivel) {
      telaOrientacaoClaude();
      return;
    }
    estado.avisoAmbiente = [!ambiente.typesafe ? "Chave do Jev ausente. O modo automático usará sonnet como padrão." : null, ambiente.agy.aviso].filter(Boolean).join(" ") || null;
    const sessao = await chamar(api.auth.restaurar());
    if (sessao) {
      estado.email = sessao.email;
      await abrirPrincipal();
    } else {
      telaLogin();
    }
  } catch (erro) {
    telaLogin(erro.message);
  }
}

iniciar();
