const { contextBridge, ipcRenderer } = require("electron");

const chamar = (canal, ...args) => ipcRenderer.invoke(canal, ...args);

contextBridge.exposeInMainWorld("api", {
  ambiente: { verificar: () => chamar("ambiente:verificar") },
  auth: {
    restaurar: () => chamar("auth:restaurar"),
    entrar: (email, senha) => chamar("auth:entrar", email, senha),
    cadastrar: (email, senha) => chamar("auth:cadastrar", email, senha),
    sair: () => chamar("auth:sair")
  },
  projetos: {
    listar: () => chamar("projetos:listar"),
    adicionar: () => chamar("projetos:adicionar"),
    renomear: (id, nome) => chamar("projetos:renomear", id, nome),
    remover: (id) => chamar("projetos:remover", id)
  },
  conversas: {
    listar: (projetoId) => chamar("conversas:listar", projetoId),
    renomear: (id, titulo) => chamar("conversas:renomear", id, titulo),
    remover: (id) => chamar("conversas:remover", id)
  },
  tarefa: {
    executar: (dados) => chamar("tarefa:executar", dados),
    cancelar: (id) => chamar("tarefa:cancelar", id)
  },
  anexos: {
    selecionar: () => chamar("anexos:selecionar"),
    adicionarBytes: (nome, bytes) => chamar("anexos:adicionarBytes", nome, bytes),
    remover: (id) => chamar("anexos:remover", id),
    limpar: () => chamar("anexos:limpar")
  },
  historico: { listar: (conversaId) => chamar("historico:listar", conversaId) },
  config: {
    obter: () => chamar("config:obter"),
    salvar: (config) => chamar("config:salvar", config)
  }
});
