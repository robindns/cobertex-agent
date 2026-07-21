// src/monitor.js — Monitor de saúde do cobertex-agent
// Verifica WhatsApp, crédito Anthropic e Base44 sem afetar o agente principal

const config = require('./config');
const { enviarTexto } = require('./evolution');

const ROBINSON = '5511995692963';

// Intervalos
const INTERVALO_WHATSAPP_MS  = 5  * 60 * 1000; // 5 min
const INTERVALO_CREDITO_MS   = 60 * 60 * 1000; // 1 hora
const INTERVALO_BASE44_MS    = 10 * 60 * 1000; // 10 min

// Controle de alertas — evita spam (só avisa 1x por problema)
const alertasEnviados = new Set();
let whatsappConectado = true;
let creditoOk = true;
let base44Ok = true;
let tentativasReconexao = 0;
const MAX_TENTATIVAS_RECONEXAO = 3;

function agora() {
  return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}

async function enviarAlerta(chave, mensagem) {
  if (alertasEnviados.has(chave)) return; // já avisou, não repete
  alertasEnviados.add(chave);
  try {
    await enviarTexto(ROBINSON, mensagem);
    console.log(`[monitor] ⚠️ Alerta enviado: ${chave}`);
  } catch (err) {
    console.error('[monitor] Erro ao enviar alerta:', err.message);
  }
}

async function enviarRecuperacao(chave, mensagem) {
  alertasEnviados.delete(chave); // limpa para poder alertar novamente se recair
  try {
    await enviarTexto(ROBINSON, mensagem);
    console.log(`[monitor] ✅ Recuperação enviada: ${chave}`);
  } catch (err) {
    console.error('[monitor] Erro ao enviar recuperação:', err.message);
  }
}

// ── 1. Verificar WhatsApp ─────────────────────────────────────────────────────
async function verificarWhatsApp() {
  try {
    const res = await fetch(
      `${config.EVOLUTION_API_URL}/instance/connectionState/${config.EVOLUTION_INSTANCE}`,
      { headers: { apikey: config.EVOLUTION_API_KEY }, signal: AbortSignal.timeout(10000) }
    );
    const data = await res.json();
    const state = data?.instance?.state;

    if (state === 'open') {
      if (!whatsappConectado) {
        // Recuperou!
        whatsappConectado = true;
        tentativasReconexao = 0;
        await enviarRecuperacao('whatsapp_close',
          `✅ *WhatsApp reconectado!*\n\nO agente Cobertex voltou a funcionar normalmente.\n🕐 ${agora()}`
        );
      }
      return;
    }

    // Desconectado
    console.warn(`[monitor] WhatsApp state: ${state}`);

    if (whatsappConectado) {
      whatsappConectado = false;
      await enviarAlerta('whatsapp_close',
        `⚠️ *ALERTA — WhatsApp desconectado!*\n\nO agente Cobertex parou de receber mensagens.\nTentando reconectar automaticamente...\n🕐 ${agora()}`
      );
    }

    // Tenta reconectar automaticamente
    if (tentativasReconexao < MAX_TENTATIVAS_RECONEXAO) {
      tentativasReconexao++;
      console.log(`[monitor] Tentativa de reconexão ${tentativasReconexao}/${MAX_TENTATIVAS_RECONEXAO}...`);
      try {
        await fetch(
          `${config.EVOLUTION_API_URL}/instance/connect/${config.EVOLUTION_INSTANCE}`,
          { headers: { apikey: config.EVOLUTION_API_KEY }, signal: AbortSignal.timeout(15000) }
        );
        console.log('[monitor] Pedido de reconexão enviado à Evolution API');
      } catch (e) {
        console.error('[monitor] Falha ao tentar reconectar:', e.message);
      }
    } else {
      // Esgotou tentativas — avisa para ação manual
      await enviarAlerta('whatsapp_manual',
        `🚨 *AÇÃO NECESSÁRIA — WhatsApp*\n\nNão consegui reconectar automaticamente após ${MAX_TENTATIVAS_RECONEXAO} tentativas.\n\nVocê precisa gerar um novo QR Code:\n\n1. Acesse: ${config.EVOLUTION_API_URL}/manager\n2. Instância: *cobertex*\n3. Clique em conectar e escaneie o QR\n\n🕐 ${agora()}`
      );
    }

  } catch (err) {
    console.error('[monitor] Erro ao verificar WhatsApp:', err.message);
  }
}

// ── 2. Verificar crédito Anthropic ───────────────────────────────────────────
async function verificarCredito() {
  try {
    // Faz uma chamada mínima à API para testar o crédito
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ok' }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 400) {
      // 400 com resposta válida = API funcionando, crédito ok
      if (!creditoOk) {
        creditoOk = true;
        await enviarRecuperacao('credito_baixo',
          `✅ *Crédito Anthropic restaurado!*\n\nO agente voltou a funcionar normalmente.\n🕐 ${agora()}`
        );
      }
      return;
    }

    if (res.ok) {
      if (!creditoOk) {
        creditoOk = true;
        await enviarRecuperacao('credito_baixo',
          `✅ *Crédito Anthropic restaurado!*\n\nO agente voltou a funcionar normalmente.\n🕐 ${agora()}`
        );
      }
      return;
    }

    const data = await res.json().catch(() => ({}));
    const msg = data?.error?.message || '';

    if (res.status === 400 && msg.includes('credit balance')) {
      creditoOk = false;
      await enviarAlerta('credito_baixo',
        `⚠️ *ALERTA — Crédito Anthropic esgotado!*\n\nO agente parou de responder por falta de crédito na API.\n\nAcesse: https://console.anthropic.com → Plans & Billing → Add credits\n\nConta atual: cultiva@cultivaweb.com.br\n🕐 ${agora()}`
      );
    }

  } catch (err) {
    console.error('[monitor] Erro ao verificar crédito:', err.message);
  }
}

// ── 3. Verificar Base44 ───────────────────────────────────────────────────────
async function verificarBase44() {
  try {
    const res = await fetch(
      `https://cobertex-crm-dc1fb74c.base44.app/api/AgenteMemoria?limit=1`,
      {
        headers: { api_key: config.BASE44_API_KEY },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (res.ok) {
      if (!base44Ok) {
        base44Ok = true;
        await enviarRecuperacao('base44_down',
          `✅ *Base44 voltou ao normal!*\n\nO CRM está respondendo normalmente.\n🕐 ${agora()}`
        );
      }
      return;
    }

    if (res.status === 429 || res.status === 503) {
      base44Ok = false;
      await enviarAlerta('base44_down',
        `⚠️ *ALERTA — Base44 com problemas!*\n\nO CRM (Base44) está retornando erro ${res.status}.\nO agente pode estar lento ou sem salvar dados.\n\nIsso costuma se resolver sozinho em alguns minutos.\n🕐 ${agora()}`
      );
    }

  } catch (err) {
    if (err.name === 'TimeoutError' || err.message.includes('timeout')) {
      base44Ok = false;
      await enviarAlerta('base44_down',
        `⚠️ *ALERTA — Base44 sem resposta!*\n\nO CRM não respondeu em 15 segundos.\nO agente pode estar com dificuldades para salvar dados.\n🕐 ${agora()}`
      );
    } else {
      console.error('[monitor] Erro ao verificar Base44:', err.message);
    }
  }
}

// ── Iniciar monitor ───────────────────────────────────────────────────────────
function iniciarMonitor() {
  console.log('[monitor] ✅ Iniciado — WhatsApp: 5min | Crédito: 1h | Base44: 10min');

  // Primeira verificação após 1 minuto (deixa o agente subir primeiro)
  setTimeout(async () => {
    await verificarWhatsApp();
    await verificarCredito();
    await verificarBase44();
  }, 60 * 1000);

  // Intervalos contínuos
  setInterval(verificarWhatsApp, INTERVALO_WHATSAPP_MS);
  setInterval(verificarCredito, INTERVALO_CREDITO_MS);
  setInterval(verificarBase44, INTERVALO_BASE44_MS);
}

module.exports = { iniciarMonitor };
