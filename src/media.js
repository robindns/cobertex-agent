// src/media.js
const axios = require('axios');
const FormData = require('form-data');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

/**
 * Baixa mídia da Evolution API e retorna como Buffer
 */
async function downloadMedia(messageKey, instanceName) {
  try {
    const url = `${config.EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${instanceName}`;
    const res = await axios.post(
      url,
      { message: { key: messageKey } },
      { headers: { apikey: config.EVOLUTION_API_KEY } }
    );
    // Retorna base64 string
    return res.data?.base64 || null;
  } catch (err) {
    console.error('[media] Erro ao baixar mídia:', err.message);
    return null;
  }
}

/**
 * Transcreve áudio usando Whisper (OpenAI)
 * Recebe base64 do arquivo de áudio
 */
async function transcreverAudio(base64Data, mimeType = 'audio/ogg') {
  try {
    if (!config.OPENAI_API_KEY) {
      return '[Transcrição indisponível: OPENAI_API_KEY não configurada]';
    }

    // Converte base64 para Buffer
    const buffer = Buffer.from(base64Data, 'base64');

    const form = new FormData();
    // Whisper aceita ogg, mp3, mp4, webm, wav
    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'ogg';
    form.append('file', buffer, { filename: `audio.${ext}`, contentType: mimeType });
    form.append('model', 'whisper-1');
    form.append('language', 'pt');

    const res = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      },
      timeout: 30000,
    });

    return res.data?.text || '[Sem transcrição]';
  } catch (err) {
    console.error('[media] Erro ao transcrever áudio:', err.response?.data || err.message);
    return '[Erro na transcrição do áudio]';
  }
}

/**
 * Analisa imagem usando Claude Vision
 * Recebe base64 da imagem e instrução opcional
 */
async function analisarImagem(base64Data, mimeType = 'image/jpeg', instrucao = '') {
  try {
    const prompt = instrucao ||
      'Descreva o que está nesta imagem de forma objetiva e detalhada. ' +
      'Se houver equipamentos, veículos, obras ou estruturas, identifique-os. ' +
      'Se houver texto visível, transcreva-o.';

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: base64Data,
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    return response.content[0]?.text || '[Sem descrição]';
  } catch (err) {
    console.error('[media] Erro ao analisar imagem:', err.message);
    return '[Erro na análise da imagem]';
  }
}

/**
 * Gera áudio TTS via ElevenLabs
 * Retorna Buffer com o áudio em MP3 ou null se indisponível
 */
async function gerarAudio(texto) {
  try {
    if (!config.ELEVENLABS_API_KEY) return null;

    // Limita a 500 chars para não esgotar créditos nem dar timeout
    const textoLimitado = texto.length > 500 ? texto.substring(0, 497) + '...' : texto;
    console.log(`[media] ElevenLabs: gerando áudio (${textoLimitado.length} chars), voice: ${config.ELEVENLABS_VOICE_ID}`);

    const res = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${config.ELEVENLABS_VOICE_ID}`,
      {
        text: textoLimitado,
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
      {
        headers: {
          'xi-api-key': config.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        responseType: 'arraybuffer',
        timeout: 20000,
      }
    );

    return Buffer.from(res.data);
  } catch (err) {
    console.error('[media] Erro ao gerar áudio TTS:', err.message, err.response?.status, err.response?.data?.toString?.());
    return null;
  }
}

module.exports = { downloadMedia, transcreverAudio, analisarImagem, gerarAudio };
