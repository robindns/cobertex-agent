// src/tools/memoria.js — Memória persistente do agente no Base44
const base44 = require('../base44');

/**
 * Carrega a memória de um usuário pelo número
 */
async function carregarMemoria(numero, usuario_id) {
  try {
    const registros = await base44.list('AgenteMemoria', { numero_whatsapp: numero }, 1);
    if (registros && registros.length > 0) {
      return registros[0];
    }
    // Cria registro inicial se não existir
    const novo = await base44.create('AgenteMemoria', {
      usuario_id,
      numero_whatsapp: numero,
    });
    return novo;
  } catch (err) {
    console.error('[memoria] Erro ao carregar:', err.message);
    return null;
  }
}

/**
 * Salva/atualiza memória do usuário
 */
async function salvarMemoria(memoriaId, campos) {
  try {
    return await base44.update('AgenteMemoria', memoriaId, campos);
  } catch (err) {
    console.error('[memoria] Erro ao salvar:', err.message);
    return null;
  }
}

/**
 * Aplica correções de transcrição ao texto
 */
function aplicarCorrecoes(texto, correcoes) {
  if (!correcoes || !texto) return texto;
  let resultado = texto;
  for (const [errado, correto] of Object.entries(correcoes)) {
    const regex = new RegExp(errado, 'gi');
    resultado = resultado.replace(regex, correto);
  }
  return resultado;
}

module.exports = { carregarMemoria, salvarMemoria, aplicarCorrecoes };
