// src/scheduler.js
const config = require('./config');
const base44 = require('./base44');
const { enviarTexto } = require('./evolution');
const { buscarLembretesParaEnviar, marcarEnviado } = require('./tools/lembretes');

// Preferências em memória
const preferencias = {
  '5511947436391': { resumoDiario: false, horaResumo: '08:00', lembretes: true, minutosAntes: 15 },
  '5511995692963': { resumoDiario: false, horaResumo: '08:00', lembretes: true, minutosAntes: 10 },
  '5511963268694': { resumoDiario: false, horaResumo: '08:00', lembretes: true, minutosAntes: 10 },
  '5511932219189': { resumoDiario: false, horaResumo: '08:00', lembretes: true, minutosAntes: 10 },
};

const notificacoesEnviadas = new Set();

// Cache de eventos por diretor para reduzir chamadas ao Base44
const cacheEventos = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

// Intervalo do scheduler: 3 minutos (era 60s — causava rate limit no Base44)
const SCHEDULER_INTERVAL_MS = 3 * 60 * 1000;

function getPrefs(numero) {
  return preferencias[numero] || { resumoDiario: false, horaResumo: '08:00', lembretes: true, minutosAntes: 10 };
}

function setPrefs(numero, novasPrefs) {
  preferencias[numero] = { ...getPrefs(numero), ...novasPrefs };
  return preferencias[numero];
}

function formatarHorario(isoString) {
  return new Date(isoString).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}

async function buscarEventosHoje(diretor) {
  const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const inicioHoje = new Date(agoraSP.getFullYear(), agoraSP.getMonth(), agoraSP.getDate(), 0, 0, 0);
  const fimHoje = new Date(agoraSP.getFullYear(), agoraSP.getMonth(), agoraSP.getDate(), 23, 59, 59);

  // Verificar cache
  const cacheKey = `${diretor}_${inicioHoje.toDateString()}`;
  const cached = cacheEventos[cacheKey];
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.dados;
  }

  try {
    const todos = await base44.list('EventoAgenda', { diretor, concluido: false }, 100);
    const filtrados = todos.filter(e => {
      const data = new Date(e.data_inicio);
      return data >= inicioHoje && data <= fimHoje;
    }).sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));

    // Salvar no cache
    cacheEventos[cacheKey] = { ts: Date.now(), dados: filtrados };
    return filtrados;
  } catch (err) {
    console.error('[scheduler] Erro ao buscar eventos:', err.message);
    // Retorna cache antigo se houver, para não deixar o agente cair
    return cached ? cached.dados : [];
  }
}

async function enviarResumoDiario(numero, diretor) {
  const eventos = await buscarEventosHoje(diretor);
  const usuario = config.USUARIOS[numero];
  if (eventos.length === 0) {
    await enviarTexto(numero, `📅 *Bom dia, ${usuario.nome}!*\n\nSua agenda de hoje está livre. ✨`);
    return;
  }
  const linhas = eventos.map(e => {
    const hora = e.dia_todo ? 'Dia todo' : formatarHorario(e.data_inicio);
    const local = e.local ? ` 📍 ${e.local}` : '';
    const tipo = { reuniao: '🤝', compromisso: '📌', lembrete: '🔔', viagem: '✈️', pessoal: '👤', outro: '📋' }[e.tipo] || '📋';
    return `${tipo} *${hora}* — ${e.titulo}${local}`;
  });
  await enviarTexto(numero, `📅 *Bom dia, ${usuario.nome}!*\n\nSua agenda de hoje:\n\n${linhas.join('\n')}\n\n_${eventos.length} compromisso(s)_`);
}

async function verificarLembretes() {
  const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));

  for (const [numero, usuario] of Object.entries(config.USUARIOS)) {
    if (!usuario.diretor) continue;
    const prefs = getPrefs(numero);
    if (!prefs.lembretes) continue;

    const eventos = await buscarEventosHoje(usuario.diretor);
    for (const evento of eventos) {
      const dataEvento = new Date(evento.data_inicio);
      const diffMin = Math.floor((dataEvento - agoraSP) / 60000);

      const chaveAviso = `${evento.id}_aviso_${prefs.minutosAntes}`;
      if (diffMin <= prefs.minutosAntes && diffMin > 0 && !notificacoesEnviadas.has(chaveAviso)) {
        notificacoesEnviadas.add(chaveAviso);
        const local = evento.local ? `\n📍 ${evento.local}` : '';
        await enviarTexto(numero,
          `⏰ *Lembrete — em ${diffMin} min*\n\n*${evento.titulo}*\n🕐 ${formatarHorario(evento.data_inicio)}${local}${evento.descricao ? `\n📝 ${evento.descricao}` : ''}`
        );
      }

      const chaveChegada = `${evento.id}_chegada`;
      if (diffMin <= 2 && diffMin >= 0 && !notificacoesEnviadas.has(chaveChegada)) {
        notificacoesEnviadas.add(chaveChegada);
        await enviarTexto(numero, `🔔 *Agora!* — ${evento.titulo} está começando.`);
      }
    }
  }
}

async function verificarResumoDiario() {
  const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const horaAtual = `${String(agoraSP.getHours()).padStart(2, '0')}:${String(agoraSP.getMinutes()).padStart(2, '0')}`;
  const diaAtual = agoraSP.toDateString();

  for (const [numero, usuario] of Object.entries(config.USUARIOS)) {
    if (!usuario.diretor) continue;
    const prefs = getPrefs(numero);
    if (!prefs.resumoDiario) continue;

    const chaveResumo = `resumo_${numero}_${diaAtual}`;
    if (horaAtual === prefs.horaResumo && !notificacoesEnviadas.has(chaveResumo)) {
      notificacoesEnviadas.add(chaveResumo);
      await enviarResumoDiario(numero, usuario.diretor);
    }
  }
}

// Cache de lembretes para reduzir chamadas
let ultimaVerificacaoLembretes = 0;
const LEMBRETES_INTERVAL_MS = 5 * 60 * 1000; // Lembretes só verificam a cada 5 min

async function verificarLembretesAgente() {
  const agora = Date.now();
  if (agora - ultimaVerificacaoLembretes < LEMBRETES_INTERVAL_MS) return;
  ultimaVerificacaoLembretes = agora;

  try {
    const lembretesParaEnviar = await buscarLembretesParaEnviar();

    for (const lembrete of lembretesParaEnviar) {
      const chave = `lembrete_${lembrete.id}`;
      if (notificacoesEnviadas.has(chave)) continue;
      notificacoesEnviadas.add(chave);

      const mensagem =
        `🔔 *Lembrete enviado por ${lembrete.remetente_nome}*\n\n` +
        `${lembrete.mensagem}`;

      await enviarTexto(lembrete.destinatario_numero, mensagem);
      await marcarEnviado({ lembrete_id: lembrete.id });

      console.log(`[scheduler] Lembrete enviado: ${lembrete.remetente_nome} → ${lembrete.destinatario_nome}`);
    }
  } catch (err) {
    console.error('[lembretes] Erro ao buscar:', err.message);
  }
}

function iniciarScheduler() {
  console.log(`[scheduler] ✅ Iniciado — verificando a cada ${SCHEDULER_INTERVAL_MS / 1000}s (com cache de ${CACHE_TTL_MS / 1000}s)`);

  setInterval(async () => {
    try {
      await verificarResumoDiario();
      await verificarLembretes();
      await verificarLembretesAgente();
    } catch (err) {
      console.error('[scheduler] Erro no loop:', err.message);
    }
  }, SCHEDULER_INTERVAL_MS);
}

module.exports = { iniciarScheduler, getPrefs, setPrefs, enviarResumoDiario };
