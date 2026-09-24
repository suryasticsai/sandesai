// ================================================================
// config.js — Sandesai shared configuration
// Edit values HERE. Every other file reads from window.SANDESAI.
// ================================================================
window.SANDESAI = {
    // ── Google Apps Script Web App (/exec URL) ──
    // SHEET_API_URL: 'https://script.google.com/macros/s/AKfycbwgv2ko4WgWQOJzKh3h0VdXZsETaZIHF7cM0Dxv5PM/exec',
SHEET_API_URL: 'https://script.google.com/macros/s/AKfycbxUWIDfjJ7XebOq8WGpDVWyw1De5OBgEPjWYTZEOxW8Eem4eTw4tGOds8pekkHKUGg/exec',

    // ── Shared secret (must match Apps Script SECRET) ──
    SHEET_WEBHOOK_SECRET: 'sandesai-webhook-2026',
ADMIN_PASSWORD: 'sandesai-admin-2026',

    // ── RAGina LLM endpoint ──
    RAGINA_ASK_URL: 'https://ragina-crawler-ragina.vercel.app/api/ask',

    // ── App branding ──
    APP_NAME: 'Sandesai',
    LOGO_URL: 'sandesai-logo.png',
};

console.log('⚙️ config.js loaded — all URLs from window.SANDESAI');