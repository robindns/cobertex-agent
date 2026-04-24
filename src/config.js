// src/config.js
require('dotenv').config();

const config = {
  PORT: process.env.PORT || 3000,

  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',

  EVOLUTION_API_URL: process.env.EVOLUTION_API_URL,
  EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY,
  EVOLUTION_INSTANCE: process.env.EVOLUTION_INSTANCE || 'cobertex',

  BASE44_APP_ID: process.env.BASE44_APP_ID || '689c9b61f29b5c46dc1fb74c',
  BASE44_API_KEY: process.env.BASE44_API_KEY,
  BASE44_BASE_URL: 'https://cobertex-crm-dc1fb74c.base44.app/api',

  // Mapeamento número → usuário do sistema
  USUARIOS: {
    '5511947436391': {
      nome: 'Gustavo',
      user_id: '69414c74045c6d5de75ac756',
      role: 'operacional',
      diretor: 'gustavo', // chave da agenda
    },
    '5511995692963': {
      nome: 'Robinson',
      user_id: '689c9b61f29b5c46dc1fb74d',
      role: 'admin',
      diretor: null, // Robinson não tem agenda de diretor
    },
    '5511925122380': {
      nome: 'Cobertex',
      user_id: '6929eebfc55d4c143e481370',
      role: 'equipe',
      diretor: null,
    },
    '5511963268694': {
      nome: 'Ana Carolina',
      user_id: '698358d6de066a3621ac314e',
      role: 'diretora',
      diretor: 'ana',
    },
    '5511932219189': {
      nome: 'Eduardo',
      user_id: '69c516ff17e8612b965960ae',
      role: 'diretor',
      diretor: 'eduardo',
    },
  },

  ROBINSON_NUMBER: '5511995692963',
};

const required = ['ANTHROPIC_API_KEY', 'EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'BASE44_API_KEY'];
for (const key of required) {
  if (!config[key]) {
    console.error(`❌ Variável obrigatória não definida: ${key}`);
    process.exit(1);
  }
}

module.exports = config;
