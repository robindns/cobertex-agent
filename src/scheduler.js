// src/scheduler.js
// Serviço de lembretes e notificações proativas da agenda

const config = require('./config');
const base44 = require('./base44');
const { enviarTexto } = require('./evolution');

// ─── Preferências por diretor (persistidas em memória, resetam no redeploy)
// Para persistência real, seria necessário salvar no Base44
// Estrutura: { numero: { resumoDiario: true, horaResumo: '08:00', lembretes: true, minutosAntes: 10 } }
const preferencias = {
  '5511947436391': { // Gustavo
    resumoDiario: false,
    horaResumo: '08:00',
    lembretes: true,
    minutosAntes: 15,
  },
  '5511963268694': { // Ana Carolina
    resumoDiario: false,
    horaResumo: '08:00',
    lembretes: true,
    minutosAntes: 10,
  },
  '5511932219189': { // Eduardo
    resumoDiario: false,
    horaResumo: '08:00',
    lembretes: true,
    minutosAntes: 10,
  },
};

// Controla quais eventos já foram notificados (evita duplicatas)
const notificacosEnviadas = new Set();

/**
 * Retorna preferências do usuário (com defaults)
 */
function getPrefs(numero) {
  return preferencias[numero] || {
    resumoDiario: false,
    horaResumo: '08:00',
    lembretes: true,
    minutosAntes: 10,
  };
}

/**
 * Atualiza preferências de um usuário
 */
function setPrefs(numero, novasPrefs) {
  preferencias[numero] = { ...getPrefs(numero), ...novasPrefs };
  console.log(`[scheduler] Prefs atualizadas para ${numero}:`, preferencias[numero]);
  return preferencias[numero];
}

/**
 * Formata horário de evento para exibição
 */
function formatarHorario(isoString) {
  return new Date(isoString).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}

function formatarDataHora(isoString) {
  return new Date(isoString).toLocaleString('pt-BR', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}

/**
 * Busca eventos do dia de um diretor
 */
async function buscarEventosHoje(diretor) {
  const agoraLocal = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const inicioHoje = new Date(agoraLocal.getFullYear(), agoraLocal.getMonth(), agoraLocal.getDate(), 0, 0, 0);
  const fimHoje = new Date(agoraLocal.getFullYear(), agoraLocal.getMonth(), agoraLocal.getDate(), 23, 59, 59);

  try {
    const todos = await base44.list('EventoAgenda', { diretor, concluido: false }, 100);
    return todos.filter(e => {
      const data = new Date(e.data_inicio);
      return data >= inicioHoje && data <= fimHoje;
    }).sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
  } catch (err) {
    console.error('[scheduler] Erro ao buscar eventos:', err.message);
    return [];
  }
}

/**
 * Envia resumo diário da agenda
 */
async function enviarResumoDiario(numero, diretor) {
  const eventos = await buscarEventosHoje(diretor);
  const usuario = config.USUARIOS[numero];

  if (eventos.length === 0) {
    await enviarTexto(numero,
      `📅 *Bom dia, ${usuario.nome}!*\n\nSua agenda de hoje está livre. ✨`
    );
    return;
  }

  const linhas = eventos.map(e => {
    const hora = e.dia_todo ? 'Dia todo' : formatarHorario(e.data_inicio);
    const local = e.local ? ` 📍 ${e.local}` : '';
    const tipo = { reuniao: '🤝', compromisso: '📌', lembrete: '🔔', viagem: '✈️', pessoal: '👤', outro: '📋' }[e.tipo] || '📋';
    return `${tipo} *${hora}* — ${e.titulo}${local}`;
  });

  await enviarTexto(numero,
    `📅 *Bom dia, ${usuario.nome}!*\n\nSua agenda de hoje:\n\n${linhas.join('\n')}\n\n_${eventos.length} compromisso(s)_`
  );
}

/**
 * Verifica e envia lembretes de eventos próximos
 */
async function verificarLembretes() {
  const agoraUTC = new Date();
  const agoraBRT = new Date(agoraUTC.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));

  for (const [numero, usuario] of Object.entries(config.USUARIOS)) {
    if (!usuario.diretor) continue;

    const prefs = getPrefs(numero);
    if (!prefs.lembretes) continue;

    const eventos = await buscarEventosHoje(usuario.diretor);

    for (const evento of eventos) {
      const dataEvento = new Date(evento.data_inicio);
      const diffMs = dataEvento - agoraBRT;
      const diffMin = Math.floor(diffMs / 60000);

      // Lembrete configurado pelo usuário (ex: 10 min antes)
      const chaveAviso = `${evento.id}_aviso_${prefs.minutosAntes}`;
      if (
        diffMin <= prefs.minutosAntes &&
        diffMin > 0 &&
        !notificacosEnviadas.has(chaveAviso)
      ) {
        notificacosEnviadas.add(chaveAviso);
        const local = evento.local ? `\n📍 ${evento.local}` : '';
        await enviarTexto(numero,
          `⏰ *Lembrete — em ${diffMin} min*\n\n*${evento.titulo}*\n🕐 ${formatarHorario(evento.data_inicio)}${local}${evento.descricao ? `\n📝 ${evento.descricao}` : ''}`
        );
        console.log(`[scheduler] Lembrete enviado: ${evento.titulo} → ${numero}`);
      }

      // Aviso de chegada — 2 min antes
      const chaveChegada = `${evento.id}_chegada`;
      if (
        diffMin <= 2 &&
        diffMin >= 0 &&
        !notificacosEnviadas.has(chaveChegada)
      ) {
        notificacosEnviadas.add(chaveChegada);
        await enviarTexto(numero,
          `🔔 *Agora!* — ${evento.titulo} está começando.`
        );
      }
    }
  }
}

/**
 * Verifica se é hora de enviar resumo diário
 */
async function verificarResumoDiario() {
  const agoraBRT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const horaAtual = `${String(agoraBRT.getHours()).padStart(2, '0')}:${String(agoraBRT.getMinutes()).padStart(2, '0')}`;
  const diaAtual = agoraBRT.toDateString();

  for (const [numero, usuario] of Object.entries(config.USUARIOS)) {
    if (!usuario.diretor) continue;

    const prefs = getPrefs(numero);
    if (!prefs.resumoDiario) continue;

    const chaveResumo = `resumo_${numero}_${diaAtual}`;
    if (horaAtual === prefs.horaResumo && !notificacosEnviadas.has(chaveResumo)) {
      notificacosEnviadas.add(chaveResumo);
      await enviarResumoDiario(numero, usuario.diretor);
      console.log(`[scheduler] Resumo diário enviado para ${usuario.nome}`);
    }
  }
}

/**
 * Loop principal do scheduler — roda a cada 60 segundos
 */
function iniciarScheduler() {
  console.log('[scheduler] ✅ Iniciado — verificando a cada 60s');

  setInterval(async () => {
    try {
      await verificarResumoDiario();
      await verificarLembretes();
    } catch (err) {
      console.error('[scheduler] Erro no loop:', err.message);
    }
  }, 60 * 1000); // 60 segundos
}

module.exports = { iniciarScheduler, getPrefs, setPrefs, enviarResumoDiario };
