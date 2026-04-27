// src/scheduler.js
const config = require('./config');
const base44 = require('./base44');
const { enviarTexto } = require('./evolution');
const { buscarLembretesParaEnviar, marcarEnviado } = require('./tools/lembretes');

// Preferências em memória (fallback enquanto não carrega do Base44)
const preferencias = {
  '5511947436391': { resumoDiario: false, horaResumo: '08:00', lembretes: true, minutosAntes: 15 },
  '5511995692963': { resumoDiario: false, horaResumo: '08:00', lembretes: true, minutosAntes: 10 },
  '5511963268694': { resumoDiario: false, horaResumo: '08:00', lembretes: true, minutosAntes: 10 },
  '5511932219189': { resumoDiario: false, horaResumo: '08:00', lembretes: true, minutosAntes: 10 },
};

const notificacoesEnviadas = new Set();

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

async function verificarLembretesAgente() {
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
    console.error('[scheduler] Erro ao verificar lembretes agente:', err.message);
  }
}

function iniciarScheduler() {
  console.log('[scheduler] ✅ Iniciado — verificando a cada 60s');

  setInterval(async () => {
    try {
      await verificarResumoDiario();
      await verificarLembretes();
      await verificarLembretesAgente();
    } catch (err) {
      console.error('[scheduler] Erro no loop:', err.message);
    }
  }, 60 * 1000);
}

module.exports = { iniciarScheduler, getPrefs, setPrefs, enviarResumoDiario };
