// src/config.js
require('dotenv').config();

const config = {
  // Server
  PORT: process.env.PORT || 3000,

  // Anthropic
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,

  // OpenAI (Whisper para transcrição de áudio)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,

  // ElevenLabs (TTS)
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB', // voz padrão Adam

  // Evolution API
  EVOLUTION_API_URL: process.env.EVOLUTION_API_URL,
  EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY,
  EVOLUTION_INSTANCE: process.env.EVOLUTION_INSTANCE || 'cobertex',

  // Base44
  BASE44_APP_ID: process.env.BASE44_APP_ID || '689c9b61f29b5c46dc1fb74c',
  BASE44_API_KEY: process.env.BASE44_API_KEY,
  BASE44_BASE_URL: 'https://cobertex-crm-dc1fb74c.base44.app/api',

  // Números autorizados e mapeamento para usuários do sistema
  USUARIOS: {
    '5511947436391': {
      nome: 'Gustavo',
      user_id: '69414c74045c6d5de75ac756', // Gustavo Orteney - orteney@cobertex.com.br
      role: 'operacional',
    },
    '5511995692963': {
      nome: 'Robinson',
      user_id: '689c9b61f29b5c46dc1fb74d', // Robinson Donizete - robinson@cultivaweb.com.br
      role: 'admin',
    },
    '5511925122380': {
      nome: 'Cobertex',
      user_id: '6929eebfc55d4c143e481370', // Comercial Coberturas - número disponível da empresa
      role: 'equipe',
    },
  },

  // Robinson é notificado quando algo está fora do escopo
  ROBINSON_NUMBER: '5511995692963',
};

// Validações de variáveis obrigatórias
const required = ['ANTHROPIC_API_KEY', 'EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'BASE44_API_KEY'];
for (const key of required) {
  if (!config[key]) {
    console.error(`❌ Variável de ambiente obrigatória não definida: ${key}`);
    process.exit(1);
  }
}

// IDs dos usuários já estão hardcoded — não precisam de env vars

module.exports = config;
