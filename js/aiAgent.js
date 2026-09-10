// js/aiAgent.js
import { createMediaURL, revokeMediaURL } from './mediaStorage.js'; // if needed

let ragina = null;
let recognition = null;
let isListening = false;
let synth = window.speechSynthesis;

/**
 * Initialize RAGina with custom knowledge about Sandesai.
 * You can build the knowledge base using ragina-crawler offline and load it here.
 */
export async function initAIAgent() {
  // Load RAGina Pro – assume it's available globally as RAGina
  if (typeof RAGina === 'undefined') {
    console.error('RAGina Pro not loaded. Include ragina-pro.js via CDN or locally.');
    return;
  }

  // Example knowledge base (replace with crawled data)
  const knowledge = [
    {
      id: 'about',
      text: 'Sandesai is a standalone, open-source messenger app. It uses PeerJS for peer-to-peer communication and AlaSQL for local storage.'
    },
    {
      id: 'media',
      text: 'You can send images, videos, audio, PDFs and documents. Files are stored locally in IndexedDB and transferred in chunks over WebRTC.'
    },
    {
      id: 'voice',
      text: 'The AI voice agent can answer questions about Sandesai using voice. Click the microphone button to start or stop listening.'
    }
  ];

  ragina = new RAGina({
    knowledge,
    // RAGina options – adjust as per its API
    model: 'default',
    temperature: 0.7
  });

  await ragina.init();

  // Setup speech recognition
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = async (event) => {
      const query = event.results[0][0].transcript;
      console.log('User said:', query);
      await processQuery(query);
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      stopListening();
    };

    recognition.onend = () => {
      if (isListening) {
        // Auto-restart if still supposed to be listening
        recognition.start();
      }
    };
  } else {
    console.warn('Speech recognition not supported in this browser.');
  }

  // Create UI button if not present
  createAgentUI();
}

/**
 * Create a floating button for the AI agent.
 */
function createAgentUI() {
  if (document.getElementById('ai-agent-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'ai-agent-btn';
  btn.textContent = '🎤 Ask AI';
  btn.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 1000;
    padding: 12px 20px; border-radius: 30px; background: #007bff;
    color: white; border: none; cursor: pointer; font-size: 16px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  `;
  btn.onclick = toggleListening;
  document.body.appendChild(btn);
}

/**
 * Toggle listening state.
 */
export function toggleListening() {
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
}

function startListening() {
  if (!recognition) {
    alert('Speech recognition not supported in your browser.');
    return;
  }
  isListening = true;
  recognition.start();
  document.getElementById('ai-agent-btn').textContent = '🔴 Listening...';
}

function stopListening() {
  isListening = false;
  if (recognition) recognition.stop();
  const btn = document.getElementById('ai-agent-btn');
  if (btn) btn.textContent = '🎤 Ask AI';
}

/**
 * Process a user query through RAGina and respond with voice.
 * @param {string} query
 */
async function processQuery(query) {
  if (!ragina) return;

  // Get answer from RAGina
  const answer = await ragina.query(query);
  console.log('AI answer:', answer);

  // Speak the answer
  speakResponse(answer);

  // Store conversation in AlaSQL
  storeConversation(query, answer);

  // Optionally broadcast over WebRTC (if you have a broadcast function)
  // broadcastAIMessage({ query, answer });
}

/**
 * Use TTS to speak the response.
 * @param {string} text
 */
function speakResponse(text) {
  if (!synth) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 1.0;
  synth.speak(utterance);
}

/**
 * Store conversation history in AlaSQL.
 * @param {string} query
 * @param {string} answer
 */
function storeConversation(query, answer) {
  try {
    alasql('CREATE TABLE IF NOT EXISTS ai_conversations (id INT AUTOINCREMENT, query STRING, answer STRING, timestamp STRING)');
    alasql('INSERT INTO ai_conversations (query, answer, timestamp) VALUES (?,?,?)',
      [query, answer, new Date().toISOString()]);
  } catch (e) {
    console.error('Failed to store AI conversation:', e);
  }
}

/**
 * Optional: retrieve past conversations.
 */
export function getConversationHistory(limit = 20) {
  try {
    return alasql('SELECT * FROM ai_conversations ORDER BY timestamp DESC LIMIT ?', [limit]);
  } catch (e) {
    console.error('Failed to fetch AI conversations:', e);
    return [];
  }
}