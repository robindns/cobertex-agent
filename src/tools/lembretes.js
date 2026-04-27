// src/tools/lembretes.js — Lembretes entre usuários via Base44
const base44 = require('../base44');

/**
 * Cria um lembrete para enviar a outro usuário numa data/hora específica
 */
async function criarLembrete({ remetente_numero, remetente_nome, destinatario_numero, destinatario_nome, mensagem, data_envio, hora_envio }) {
  return base44.create('LembreteAgente', {
    remetente_numero,
    remetente_nome,
    destinatario_numero,
    destinatario_nome,
    mensagem,
    data_envio,
    hora_envio,
    enviado: false,
    cancelado: false,
  });
}

/**
 * Lista lembretes pendentes de um usuário
 */
async function listarLembretes({ numero, tipo = 'todos' }) {
  const todos = await base44.list('LembreteAgente', { enviado: false, cancelado: false }, 50);
  
  if (tipo === 'receber') {
    return todos.filter(l => l.destinatario_numero === numero);
  } else if (tipo === 'enviei') {
    return todos.filter(l => l.remetente_numero === numero);
  }
  return todos.filter(l => l.destinatario_numero === numero || l.remetente_numero === numero);
}

/**
 * Cancela um lembrete
 */
async function cancelarLembrete({ lembrete_id }) {
  return base44.update('LembreteAgente', lembrete_id, { cancelado: true });
}

/**
 * Busca lembretes que devem ser enviados agora
 * Chamado pelo scheduler a cada minuto
 */
async function buscarLembretesParaEnviar() {
  try {
    const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const dataHoje = agoraSP.toISOString().split('T')[0];
    const horaAgora = `${String(agoraSP.getHours()).padStart(2, '0')}:${String(agoraSP.getMinutes()).padStart(2, '0')}`;

    const pendentes = await base44.list('LembreteAgente', { enviado: false, cancelado: false }, 100);
    
    return pendentes.filter(l => {
      return l.data_envio === dataHoje && l.hora_envio === horaAgora;
    });
  } catch (err) {
    console.error('[lembretes] Erro ao buscar:', err.message);
    return [];
  }
}

/**
 * Marca lembrete como enviado
 */
async function marcarEnviado({ lembrete_id }) {
  return base44.update('LembreteAgente', lembrete_id, { enviado: true });
}

module.exports = { criarLembrete, listarLembretes, cancelarLembrete, buscarLembretesParaEnviar, marcarEnviado };
