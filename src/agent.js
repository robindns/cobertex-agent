// src/agent.js
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const memorandoTools = require('./tools/memorando');
const crmTools = require('./tools/crm');
const agendaTools = require('./tools/agenda');
const lembretesTools = require('./tools/lembretes');
const memoriaTools = require('./tools/memoria');
const { gerarPDFBuffer } = require('./tools/relatorio');
const { getPrefs, setPrefs } = require('./scheduler');
const { gerarAudio } = require('./media');

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// Mapa nome → número para lookup
function encontrarNumero(nome) {
  const n = (nome || '').toLowerCase();
  const paraSimMesmo = ['eu', 'me', 'mim', 'mesmo', 'self', 'para mim'].includes(n);
  if (paraSimMesmo) return '__self__';
  for (const [num, usr] of Object.entries(config.USUARIOS)) {
    if (usr.nome.toLowerCase().includes(n) || (usr.diretor || '') === n) return num;
  }
  return null;
}

const TOOLS = [
  // ── Memorandos ────────────────────────────────────────────────────────────
  {
    name: 'criar_memorando',
    description: `Cria memorando operacional. Use para: saída/chegada de equipes, ocorrências, relatos de campo.
Se houver midiaUrl no contexto, inclua em anexos[].
Detecte urgência: urgente, emergência, acidente, quebrou.
tag_livro = Livro de Ocorrências, tag_eduardo = centro de custos Eduardo.`,
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        conteudo: { type: 'string' },
        criador_id: { type: 'string' },
        cliente_id: { type: 'string' },
        instalacao_id: { type: 'string' },
        urgente: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        anexos: { type: 'array', items: { type: 'string' } },
        tag_livro: { type: 'boolean' },
        tag_eduardo: { type: 'boolean' },
        tags_livro: { type: 'array', items: { type: 'string' } },
        tags_eduardo: { type: 'array', items: { type: 'string' } },
      },
      required: ['titulo', 'conteudo', 'criador_id'],
    },
  },
  {
    name: 'buscar_memorandos',
    description: `Busca memorandos por texto livre. SEMPRE use antes de dizer que não encontrou.
Busca em título, conteúdo e tags. Exemplos: "o que Pastel fez ontem?", "caminhão W2 hoje".`,
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string' },
        data: { type: 'string', description: '"hoje", "ontem", "23/04/2026"' },
        cliente_id: { type: 'string' },
        status: { type: 'string', enum: ['pendente', 'concluido'] },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'listar_memorandos',
    description: 'Lista memorandos recentes sem filtro.',
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: { type: 'string' },
        status: { type: 'string', enum: ['pendente', 'concluido'] },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'atualizar_memorando',
    description: 'Atualiza campos de um memorando existente.',
    input_schema: {
      type: 'object',
      properties: { memorando_id: { type: 'string' }, campos: { type: 'object' } },
      required: ['memorando_id', 'campos'],
    },
  },
  {
    name: 'excluir_memorando',
    description: 'Exclui memorando permanentemente. Só após confirmação explícita.',
    input_schema: {
      type: 'object',
      properties: { memorando_id: { type: 'string' } },
      required: ['memorando_id'],
    },
  },
  {
    name: 'adicionar_anexos_memorando',
    description: 'Adiciona imagens/arquivos a memorando existente.',
    input_schema: {
      type: 'object',
      properties: {
        memorando_id: { type: 'string' },
        novos_anexos: { type: 'array', items: { type: 'string' } },
      },
      required: ['memorando_id', 'novos_anexos'],
    },
  },
  {
    name: 'concluir_memorando',
    description: 'Marca memorando como concluído.',
    input_schema: {
      type: 'object',
      properties: { memorando_id: { type: 'string' } },
      required: ['memorando_id'],
    },
  },

  // ── Memória persistente ───────────────────────────────────────────────────
  {
    name: 'salvar_memoria',
    description: `Salva informações persistentes sobre o usuário no sistema.
Use quando o usuário disser:
- "me chame de X" / "meu nome é X" → salva nome_agente
- "lembre que..." → salva em contexto_livre
- "sempre responda de forma X" → salva em instrucoes_personalizadas
- "quando eu disser X, é Y" → salva correção em correcoes_transcricao`,
    input_schema: {
      type: 'object',
      properties: {
        nome_agente: { type: 'string', description: 'Nome que o usuário quer dar ao agente' },
        contexto_livre: { type: 'string', description: 'Informação para lembrar sobre o usuário' },
        instrucoes_personalizadas: { type: 'string', description: 'Como o agente deve se comportar' },
        correcoes_transcricao: { type: 'object', description: 'Ex: {"Pascal": "Pastel", "W dois": "W2"}' },
      },
      required: [],
    },
  },

  // ── CRM ───────────────────────────────────────────────────────────────────
  {
    name: 'listar_leads',
    description: 'Lista leads. Estágios: novo→contatado→qualificado→proposta_enviada→convertido→perdido.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['novo', 'contatado', 'qualificado', 'proposta_enviada', 'convertido', 'perdido'] },
        responsavel: { type: 'string' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'buscar_lead',
    description: 'Busca lead por nome, empresa ou telefone.',
    input_schema: {
      type: 'object',
      properties: { texto: { type: 'string' }, limit: { type: 'number' } },
      required: ['texto'],
    },
  },
  {
    name: 'atualizar_lead',
    description: 'Atualiza dados ou status de um lead.',
    input_schema: {
      type: 'object',
      properties: { lead_id: { type: 'string' }, campos: { type: 'object' } },
      required: ['lead_id', 'campos'],
    },
  },
  {
    name: 'listar_atendimentos',
    description: 'Lista atendimentos/contatos recebidos. Primeiros contatos — podem ou não virar leads.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['novo', 'em_analise', 'contatado', 'aguardando_retorno', 'convertido_lead', 'descartado'] },
        origem: { type: 'string' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'buscar_atendimento',
    description: 'Busca atendimento por nome, empresa ou local.',
    input_schema: {
      type: 'object',
      properties: { texto: { type: 'string' }, limit: { type: 'number' } },
      required: ['texto'],
    },
  },
  {
    name: 'listar_clientes',
    description: 'Lista clientes.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ativo', 'inativo', 'prospecto'] },
        cidade: { type: 'string' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'buscar_cliente',
    description: 'Busca cliente por nome ou documento.',
    input_schema: {
      type: 'object',
      properties: { nome: { type: 'string' } },
      required: ['nome'],
    },
  },
  {
    name: 'listar_instalacoes',
    description: 'Lista instalações.',
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: { type: 'string' },
        status: { type: 'string', enum: ['prevista', 'em_instalacao', 'ativa', 'encerrada', 'manutencao'] },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'listar_propostas',
    description: 'Lista propostas.',
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: { type: 'string' },
        status: { type: 'string', enum: ['rascunho', 'enviada', 'aprovada', 'rejeitada', 'expirada'] },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'resumo_estrategico',
    description: 'Resumo estratégico completo: clientes, leads, atendimentos, propostas, instalações, taxa de conversão.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  // ── Agenda ────────────────────────────────────────────────────────────────
  {
    name: 'criar_evento_agenda',
    description: 'Cria evento, reunião, compromisso ou lembrete na agenda pessoal.',
    input_schema: {
      type: 'object',
      properties: {
        diretor: { type: 'string', enum: ['ana', 'gustavo', 'eduardo', 'diego'] },
        titulo: { type: 'string' },
        descricao: { type: 'string' },
        data_inicio: { type: 'string' },
        data_fim: { type: 'string' },
        dia_todo: { type: 'boolean' },
        tipo: { type: 'string', enum: ['reuniao', 'compromisso', 'lembrete', 'viagem', 'pessoal', 'outro'] },
        local: { type: 'string' },
        lembrete_minutos: { type: 'number' },
        recorrente: { type: 'boolean' },
        recorrencia: { type: 'string', enum: ['diario', 'semanal', 'mensal', 'anual'] },
      },
      required: ['diretor', 'titulo', 'data_inicio'],
    },
  },
  {
    name: 'listar_eventos_agenda',
    description: 'Lista eventos da agenda.',
    input_schema: {
      type: 'object',
      properties: {
        diretor: { type: 'string', enum: ['ana', 'gustavo', 'eduardo', 'diego'] },
        data_inicio_partir: { type: 'string' },
        concluido: { type: 'boolean' },
        limit: { type: 'number' },
      },
      required: ['diretor'],
    },
  },
  {
    name: 'eventos_hoje',
    description: 'Lista eventos de hoje da agenda.',
    input_schema: {
      type: 'object',
      properties: { diretor: { type: 'string', enum: ['ana', 'gustavo', 'eduardo', 'diego'] } },
      required: ['diretor'],
    },
  },
  {
    name: 'atualizar_evento_agenda',
    description: 'Atualiza dados de um evento.',
    input_schema: {
      type: 'object',
      properties: { evento_id: { type: 'string' }, campos: { type: 'object' } },
      required: ['evento_id', 'campos'],
    },
  },
  {
    name: 'excluir_evento_agenda',
    description: 'Exclui evento permanentemente. Só após confirmação explícita.',
    input_schema: {
      type: 'object',
      properties: { evento_id: { type: 'string' } },
      required: ['evento_id'],
    },
  },

  // ── Lembretes entre usuários ──────────────────────────────────────────────
  {
    name: 'criar_lembrete_usuario',
    description: `Cria um lembrete para enviar a outro usuário numa data/hora específica.
NÃO entra na agenda pessoal — é enviado direto pelo WhatsApp no horário marcado.
Use quando: "lembra o Gustavo amanhã às 9h que...", "avisa a Ana na sexta às 14h sobre...", "me lembra hoje às 18h de...".
Diferente de criar_evento_agenda — este é um recado, não um evento da agenda.`,
    input_schema: {
      type: 'object',
      properties: {
        destinatario: { type: 'string', description: 'Nome do destinatário (Gustavo, Robinson, Ana, Eduardo, eu)' },
        mensagem: { type: 'string', description: 'Mensagem a enviar no lembrete' },
        data_envio: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
        hora_envio: { type: 'string', description: 'Hora no formato HH:mm' },
      },
      required: ['destinatario', 'mensagem', 'data_envio', 'hora_envio'],
    },
  },
  {
    name: 'listar_lembretes',
    description: 'Lista lembretes pendentes do usuário (que vai receber ou que criou).',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['todos', 'receber', 'enviei'], description: 'Filtrar por tipo' },
      },
      required: [],
    },
  },
  {
    name: 'cancelar_lembrete',
    description: 'Cancela um lembrete pendente.',
    input_schema: {
      type: 'object',
      properties: { lembrete_id: { type: 'string' } },
      required: ['lembrete_id'],
    },
  },

  // ── Comunicação entre usuários ────────────────────────────────────────────
  {
    name: 'enviar_mensagem_usuario',
    description: `Envia mensagem de texto ou áudio para qualquer usuário, incluindo a si mesmo.
Use quando: "envie boas-vindas ao Gustavo", "me manda um áudio", "avisa a Ana", "responde em áudio".
Para áudio: use tipo="audio" apenas quando explicitamente pedido.
Usuários: Gustavo, Robinson, Ana Carolina, Eduardo, eu (para si mesmo).`,
    input_schema: {
      type: 'object',
      properties: {
        destinatario: { type: 'string', description: 'Nome do destinatário ou "eu"' },
        mensagem: { type: 'string', description: 'Conteúdo da mensagem' },
        tipo: { type: 'string', enum: ['texto', 'audio'], description: 'texto (padrão) ou audio' },
      },
      required: ['destinatario', 'mensagem'],
    },
  },

  // ── PDF ───────────────────────────────────────────────────────────────────
  {
    name: 'gerar_pdf',
    description: 'Gera relatório em PDF e envia pelo WhatsApp.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        conteudo: { type: 'string' },
        dados: { type: 'array', items: { type: 'object' } },
      },
      required: ['titulo'],
    },
  },

  // ── Preferências ──────────────────────────────────────────────────────────
  {
    name: 'configurar_lembretes',
    description: 'Configura notificações de agenda (lembretes e resumo diário).',
    input_schema: {
      type: 'object',
      properties: {
        lembretes: { type: 'boolean' },
        minutosAntes: { type: 'number' },
        resumoDiario: { type: 'boolean' },
        horaResumo: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'ver_preferencias',
    description: 'Mostra configurações atuais.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  // ── Escalação ─────────────────────────────────────────────────────────────
  {
    name: 'notificar_robinson',
    description: 'Use para solicitações fora do escopo.',
    input_schema: {
      type: 'object',
      properties: { solicitante: { type: 'string' }, descricao: { type: 'string' } },
      required: ['solicitante', 'descricao'],
    },
  },
];

async function executarFerramenta(nome, input, numero, usuario, memoriaRecord) {
  console.log(`[agent] Tool: ${nome}`);

  switch (nome) {
    case 'criar_memorando': return memorandoTools.criarMemorando(input);
    case 'buscar_memorandos': return memorandoTools.buscarMemorandos(input);
    case 'listar_memorandos': return memorandoTools.listarMemorandos(input);
    case 'atualizar_memorando': {
      const mid = input.memorando_id || '';
      if (!mid || mid.length < 20 || !/^[a-f0-9]+$/i.test(mid))
        return { erro: 'ID inválido. Busque o memorando primeiro.' };
      return memorandoTools.atualizarMemorando(input);
    }
    case 'excluir_memorando': {
      const mid = input.memorando_id || '';
      if (!mid || mid.length < 20 || !/^[a-f0-9]+$/i.test(mid))
        return { erro: 'ID inválido. Busque o memorando primeiro.' };
      return memorandoTools.excluirMemorando(input);
    }
    case 'adicionar_anexos_memorando': {
      const mid = input.memorando_id || '';
      if (!mid || mid.length < 20 || !/^[a-f0-9]+$/i.test(mid))
        return { erro: 'ID inválido. Busque o memorando primeiro.' };
      return memorandoTools.adicionarAnexos(input);
    }
    case 'concluir_memorando': return memorandoTools.concluirMemorando(input);

    case 'salvar_memoria': {
      if (!memoriaRecord?.id) return { erro: 'Memória não disponível' };
      const campos = {};
      if (input.nome_agente) campos.nome_agente = input.nome_agente;
      if (input.contexto_livre) campos.contexto_livre = input.contexto_livre;
      if (input.instrucoes_personalizadas) campos.instrucoes_personalizadas = input.instrucoes_personalizadas;
      if (input.correcoes_transcricao) {
        const atual = memoriaRecord.correcoes_transcricao || {};
        campos.correcoes_transcricao = { ...atual, ...input.correcoes_transcricao };
      }
      return memoriaTools.salvarMemoria(memoriaRecord.id, campos);
    }

    case 'listar_leads': return crmTools.listarLeads(input);
    case 'buscar_lead': return crmTools.buscarLead(input);
    case 'atualizar_lead': return crmTools.atualizarLead(input);
    case 'listar_atendimentos': return crmTools.listarAtendimentos(input);
    case 'buscar_atendimento': return crmTools.buscarAtendimento(input);
    case 'listar_clientes': return crmTools.listarClientes(input);
    case 'buscar_cliente': return crmTools.buscarCliente(input);
    case 'listar_instalacoes':
      if (input.cliente_id) return crmTools.listarInstalacoesCliente(input);
      return crmTools.listarInstalacoes(input);
    case 'listar_propostas': return crmTools.listarPropostas(input);
    case 'resumo_estrategico': return crmTools.resumoEstrategico();

    case 'criar_evento_agenda': return agendaTools.criarEvento(input);
    case 'listar_eventos_agenda': return agendaTools.listarEventos(input);
    case 'eventos_hoje': return agendaTools.eventosHoje(input);
    case 'atualizar_evento_agenda': return agendaTools.atualizarEvento(input);
    case 'excluir_evento_agenda': return agendaTools.excluirEvento(input);

    case 'criar_lembrete_usuario': {
      const numDest = encontrarNumero(input.destinatario);
      const numeroDestino = numDest === '__self__' ? numero : numDest;
      const nomeDestino = numDest === '__self__' ? usuario.nome : (config.USUARIOS[numeroDestino]?.nome || input.destinatario);
      if (!numeroDestino) return { erro: `Usuário ${input.destinatario} não encontrado.` };
      return lembretesTools.criarLembrete({
        remetente_numero: numero,
        remetente_nome: usuario.nome,
        destinatario_numero: numeroDestino,
        destinatario_nome: nomeDestino,
        mensagem: input.mensagem,
        data_envio: input.data_envio,
        hora_envio: input.hora_envio,
      });
    }
    case 'listar_lembretes': return lembretesTools.listarLembretes({ numero, tipo: input.tipo || 'todos' });
    case 'cancelar_lembrete': return lembretesTools.cancelarLembrete(input);

    case 'enviar_mensagem_usuario': {
      const { enviarTexto, enviarAudio } = require('./evolution');
      const numDest = encontrarNumero(input.destinatario);
      const numeroDestino = numDest === '__self__' ? numero : numDest;
      if (!numeroDestino) return { erro: `Usuário ${input.destinatario} não encontrado.` };

      const tipo = input.tipo || 'texto';
      if (tipo === 'audio') {
        console.log(`[agent] Gerando áudio via ElevenLabs para: ${input.destinatario}`);
        const audioBuffer = await gerarAudio(input.mensagem);
        if (audioBuffer) {
          await enviarAudio(numeroDestino, audioBuffer);
          return { sucesso: true, tipo: 'audio', destinatario: input.destinatario };
        } else {
          await enviarTexto(numeroDestino, input.mensagem);
          return { sucesso: true, tipo: 'texto_fallback', aviso: 'ElevenLabs indisponível, enviado como texto' };
        }
      } else {
        await enviarTexto(numeroDestino, input.mensagem);
        return { sucesso: true, tipo: 'texto', destinatario: input.destinatario };
      }
    }

    case 'gerar_pdf': return { __pdf_pendente: true, ...input };
    case 'configurar_lembretes': return { sucesso: true, preferencias: setPrefs(numero, input) };
    case 'ver_preferencias': return getPrefs(numero);
    case 'notificar_robinson': return { __notificar_robinson: true, ...input };
    default: return { erro: `Ferramenta desconhecida: ${nome}` };
  }
}

// Cache de memória por número (atualizado a cada mensagem)
const memoriaCache = {};

async function processarMensagem({ numero, usuario, texto, midiaUrl, midiaInfo, descricaoImagem }) {
  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });

  const temAgenda = true; // todos os usuários têm acesso à agenda
  const prefs = getPrefs(numero);

  // Carrega memória persistente
  let memoriaRecord = memoriaCache[numero];
  if (!memoriaRecord) {
    memoriaRecord = await memoriaTools.carregarMemoria(numero, usuario.user_id);
    if (memoriaRecord) memoriaCache[numero] = memoriaRecord;
  }

  // Aplica correções de transcrição se houver
  if (texto && memoriaRecord?.correcoes_transcricao) {
    texto = memoriaTools.aplicarCorrecoes(texto, memoriaRecord.correcoes_transcricao);
  }

  // Nome personalizado do agente
  const nomeAgente = memoriaRecord?.nome_agente || 'Assistente Cobertex';
  const instrucoes = memoriaRecord?.instrucoes_personalizadas || '';
  const contexto = memoriaRecord?.contexto_livre || '';

  let contextoExtra = '';
  if (midiaUrl) {
    contextoExtra += `\n\n📎 MÍDIA RECEBIDA: ${midiaUrl} (${midiaInfo?.tipo})`;
    const ultimoMem = memoriaRecord?.ultimo_memorando_id;
    if (ultimoMem) {
      contextoExtra += `\n⚠️ Memorando recente: ID=${ultimoMem}, título="${memoriaRecord?.ultimo_memorando_titulo}". Pergunte se quer ANEXAR ao anterior ou CRIAR novo.`;
    }
  }
  if (descricaoImagem) contextoExtra += `\n🖼️ DESCRIÇÃO DA IMAGEM: ${descricaoImagem}`;

  const systemPrompt = `Você é ${nomeAgente}, assistente pessoal IA da Cobertex.
Hoje é ${hoje}.

## Usuário
- Nome: ${usuario.nome} | ID: ${usuario.user_id} | Perfil: ${usuario.role}
- Agenda: diretor="${usuario.diretor || usuario.nome.toLowerCase()}"
- Notificações: ${prefs.lembretes ? `lembretes ${prefs.minutosAntes}min antes` : 'sem lembretes'} | ${prefs.resumoDiario ? `resumo às ${prefs.horaResumo}` : 'sem resumo'}
${contexto ? `- Contexto: ${contexto}` : ''}
${instrucoes ? `- Instruções personalizadas: ${instrucoes}` : ''}

## Capacidades
1. Memorandos operacionais
2. CRM completo (leads, atendimentos, clientes, propostas, instalações)
3. Agenda pessoal (todos os usuários)
4. Lembretes entre usuários (via WhatsApp, fora da agenda)
5. Envio de mensagens e áudios para outros usuários
6. Memória persistente (aprende preferências e correções)
7. PDF pelo WhatsApp
8. Análise estratégica

## PROCESSAMENTO DE ÁUDIO — SIGA RIGOROSAMENTE

Quando receber uma mensagem de áudio transcrita ("[Mensagem de áudio transcrita]: ..."), siga este fluxo:

### PASSO 1 — Resolução de datas relativas
Antes de classificar, resolva TODAS as referências de tempo para datas absolutas:
- "hoje" → data atual
- "amanhã" → data atual + 1 dia
- "ontem" → data atual - 1 dia
- "terça-feira" / "segunda" / etc → próximo ou anterior dia da semana mais próximo ao contexto
- "semana que vem" → próxima semana
- "dia X" sem mês → mesmo mês atual, dia X
- "dia X de mês Y" → data exata mencionada (pode ser retroativa)
- Horários como "7 e meia" → 07:30, "8 e meia da noite" → 20:30
Guarde essas resoluções para usar nos registros.

### PASSO 2 — Classificação do conteúdo
Classifique cada trecho do áudio em uma ou mais categorias:

**LEMBRETE PESSOAL** — sinais: "me lembra", "lembrete para", "não esquecer", "me avisa", "você me lembra", horário específico + tarefa pessoal, afazeres domésticos, compromissos pessoais.
Exemplos: instalar máquina de lavar, consulta médica, ligar para alguém, pagar conta.

**MEMORANDO OPERACIONAL** — sinais: nome de cliente, equipe, veículo (doblo, caminhão, van), obra, galpão, desmontagem, montagem, funcionário (Naldo, Felipe, Cleberson, etc.), saída/chegada/retorno, acidente, ocorrência de campo.
Exemplos: equipe saindo para cliente X, veículo retornando, funcionário chegou tal hora, desmontagem de galpão.

**AGENDA** — sinais: compromisso, reunião, visita, viagem com data/hora, evento com horário definido.

Um áudio pode conter MÚLTIPLAS categorias. Separe cada uma.

### PASSO 3 — Ação por categoria

**Se contém APENAS lembrete(s):**
- Crie o lembrete diretamente usando criar_evento_agenda (para lembretes pessoais com horário) ou criar_lembrete_usuario (para enviar WhatsApp)
- Após gravar, confirme: "✅ Lembrete registrado para [data/hora resoluta]: [descrição]"

**Se contém APENAS memorando(s):**
- Crie o memorando com a data correta no título ou conteúdo
- Use a data resolvida do áudio (não a data de hoje se o áudio mencionar outra data)
- Após gravar, confirme: "✅ Memorando registrado: [título] — [data]"

**Se contém MISTURA (lembrete + memorando):**
- Apresente resumo separado de cada parte ANTES de gravar:
  ───────────────────────────
  🎙️ *ÁUDIO PROCESSADO — RESUMO*

  📝 *MEMORANDO:*
  Título: [título gerado]
  Data: [data resolvida]
  Conteúdo: [resumo]

  🔔 *LEMBRETE:*
  Para: [data/hora resolvida]
  Mensagem: [descrição]
  ───────────────────────────
  Confirma os dois? (sim / ajuste o que precisar)
- Aguarde confirmação antes de gravar.
- Se confirmar → grave ambos.
- Se pedir ajuste → corrija e mostre resumo novamente.

### PASSO 4 — Regras de data nos memorandos
- O título do memorando deve incluir a data do evento quando mencionada: "Saída de veículo - 25/05/2026"
- O conteúdo deve usar a data real resolvida, não "hoje" ou "amanhã"
- Se o áudio foi de um dia anterior mas menciona eventos de datas diferentes, cada evento vai com sua data correta

## REGRAS DE LANÇAMENTO NA AGENDA

- Se o usuário NÃO mencionar data → use HOJE
- Se disser "dia X" → usa esse dia, mesmo retroativo, mesmo mês se não mencionar mês
- Se disser "registro de hoje" / "cadastrar hoje" → sempre usa hoje
- Fluxo de confirmação obrigatório para agenda (resumo → aguardar sim → gravar)
- Aceita: "sim", "ok", "isso", "pode", "confirmo", "certo", "tá bom", "beleza"

## Funil Cobertex
ATENDIMENTO → LEAD → PROPOSTA → CLIENTE
- Atendimento: primeiro contato, não qualificado ainda
- Lead: passou pela triagem, tem potencial
- ⚠️ Atendimentos ≠ Leads!

## Regras gerais
- criador_id = "${usuario.user_id}" nos memorandos
- diretor = "${usuario.diretor || usuario.nome.toLowerCase()}" na agenda
- BUSCA: use buscar_memorandos IMEDIATAMENTE para qualquer nome/termo
- MÍDIA: inclua midiaUrl em anexos[] ao criar memorando
- ÁUDIO enviado explicitamente: use enviar_mensagem_usuario com tipo="audio"
- MEMÓRIA: quando usuário pedir para lembrar algo, use salvar_memoria
- LEMBRETE ENTRE USUÁRIOS: use criar_lembrete_usuario (não é agenda pessoal)
- EXCLUIR: confirme antes
- Sistema: ${config.SISTEMA_URL}${contextoExtra}`;

  let userContent = texto || '';
  if (midiaUrl) {
    userContent = `[Mídia: ${midiaUrl}. Tipo: ${midiaInfo?.tipo}. Descrição: ${descricaoImagem || 'N/A'}]\n\n${userContent}`;
  } else if (descricaoImagem) {
    userContent = `[Imagem. Descrição: ${descricaoImagem}]\n\n${userContent}`;
  }

  // Determina se é áudio — áudios NÃO entram no histórico para evitar duplicidade
  const ehAudio = texto && texto.startsWith('[Mensagem de áudio transcrita]');

  // Histórico em memória — só mensagens de texto (não áudios)
  if (!processarMensagem._historicos) processarMensagem._historicos = {};
  if (!processarMensagem._historicos[numero]) processarMensagem._historicos[numero] = [];
  const hist = processarMensagem._historicos[numero];

  if (!ehAudio) {
    hist.push({ role: 'user', content: userContent });
    // Mantém apenas as últimas 6 trocas (12 mensagens) para contexto de conversa
    if (hist.length > 12) processarMensagem._historicos[numero] = hist.slice(-12);
  }

  // Para áudios: processa sem histórico anterior para evitar reprocessamento
  // Para texto: usa histórico de conversa para contexto
  const messages = ehAudio
    ? [{ role: 'user', content: userContent }]
    : [...processarMensagem._historicos[numero]];

  let resposta = '';
  let notificarRobinson = null;
  let pdfPendente = null;
  let continuar = true;
  let mensagensAtuais = [...messages];

  while (continuar) {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 3000,
      system: systemPrompt,
      tools: TOOLS,
      messages: mensagensAtuais,
    });

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        const resultado = await executarFerramenta(toolUse.name, toolUse.input, numero, usuario, memoriaRecord);

        // Atualiza cache de memória após salvar
        if (toolUse.name === 'salvar_memoria' && resultado?.id) {
          memoriaCache[numero] = resultado;
        }

        // Salva último memorando na memória persistente
        if (toolUse.name === 'criar_memorando' && resultado?.id && memoriaRecord?.id) {
          memoriaTools.salvarMemoria(memoriaRecord.id, {
            ultimo_memorando_id: resultado.id,
            ultimo_memorando_titulo: resultado.titulo,
          });
          memoriaCache[numero] = { ...memoriaRecord, ultimo_memorando_id: resultado.id, ultimo_memorando_titulo: resultado.titulo };
        }

        if (resultado?.__notificar_robinson) notificarRobinson = resultado;
        if (resultado?.__pdf_pendente) {
          pdfPendente = resultado;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ sucesso: true, mensagem: 'PDF será gerado e enviado agora.' }),
          });
          continue;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(resultado),
        });
      }

      mensagensAtuais.push({ role: 'assistant', content: response.content });
      mensagensAtuais.push({ role: 'user', content: toolResults });

    } else {
      resposta = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      continuar = false;
    }
  }

  // Salva resposta no histórico apenas para mensagens de texto
  if (!ehAudio && resposta) {
    hist.push({ role: 'assistant', content: resposta });
  }

  // Proteção contra resposta vazia
  if (!resposta) {
    resposta = '✅ Processado com sucesso.';
  }

  return { resposta, notificarRobinson, pdfPendente };
}

module.exports = { processarMensagem };
