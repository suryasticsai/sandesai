<div align="center">
  <img src="sandesai-logo.png" alt="Sandesai Logo" width="120" height="120" style="border-radius: 50%;" />
  <h1>🧠 Sandesai — AI Messenger</h1>
  <p><em>Production‑grade communication, reimagined for the AI era</em></p>
  <p><strong>Live Demo:</strong> <a href="https://suryasticsai.github.io/sandesai">suryasticsai.github.io/sandesai</a></p>
  <p><strong>Concierge Demo:</strong> <a href="https://suryasticsai.github.io/sandesai/concierge.html">suryasticsai.github.io/sandesai/concierge.html</a></p>
</div>

---

<div align="center">

![Version](https://img.shields.io/badge/version-0.3--beta-purple?style=flat-square&labelColor=0a0a1a)
![Status](https://img.shields.io/badge/status-active-2fd992?style=flat-square&labelColor=0a0a1a)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square&labelColor=0a0a1a)
![PRs](https://img.shields.io/badge/PRs-welcome-ffb648?style=flat-square&labelColor=0a0a1a)
![PWA](https://img.shields.io/badge/PWA-ready-6ee7ff?style=flat-square&labelColor=0a0a1a)

</div>

---

## ✨ The Vision

Sandesai is not just another messaging app. It's a **unified AI-native communication platform** that blends **real-time chat, WebRTC voice/video calling, an AI voice agent with persistent memory, and a deployable AI concierge for businesses** — all running on a **zero-backend architecture** powered by GitHub Pages, Firebase, PeerJS, and Google Sheets.

Built for the AI era: no servers to run, no monthly bills, no vendor lock-in.

---

## 🚀 Key Features

### 💬 Communication Core
| Feature | Description |
|---------|-------------|
| **Real‑time Chat** | Firestore‑backed instant messaging with presence detection and full message history. |
| **WebRTC Voice & Video Calls** | True peer‑to‑peer calls via PeerJS — media never touches a central server. |
| **Firestore Call Signaling** | Reliable call ringing even when PeerJS is slow — a Firestore signal reaches the receiver first. |
| **Call Recording** | Record your own audio during calls; auto-saved as `.webm`. |
| **Live Transcription** | Real‑time speech‑to‑text of every call, saved with the log. |
| **Chunked File Transfer** | Images, videos, PDFs, and documents up to 100 MB sent peer‑to‑peer in 16 KB chunks. |
| **Adaptive Media** | Small files (≤ 700 KB) auto‑inlined as base64 — instant cross‑device delivery. |

### 🤖 RAGina — AI Voice Agent
| Feature | Description |
|---------|-------------|
| **Natural Voice Conversations** | Real‑time TTS + STT with sentence-level streaming — the AI starts talking while still generating. |
| **Barge-In** | Interrupt the AI mid-sentence and it stops immediately and listens — the hallmark of a truly conversational agent. |
| **Latency Tracking** | Every turn is measured; console shows avg response time per call. |
| **Echo Rejection** | Filters out the AI's own voice coming back through the mic. |
| **Persistent Memory** | Remembers your name, past questions, and previous calls — with explicit user consent. |
| **Chat Context** | Optionally reads your recent chats so it can answer "What did Priya say about the meeting?" |
| **Per-User Sessions** | Every user's conversations are isolated and logged. |

### 🏢 RAGina Concierge — Deployable AI Receptionist
| Feature | Description |
|---------|-------------|
| **Public AI Chat Page** | `concierge.html` — a standalone page businesses can share with customers. |
| **Business-Configured** | Non-technical staff edit a Google Sheet tab to change branding, hours, contact info. |
| **Knowledge Base** | Q&A pairs in a Sheet become the bot's brain — no code changes needed. |
| **Auto Logging** | Every conversation logged to a `Conversations` tab with session ID + email. |
| **Email Capture** | Optional modal after 6 seconds to capture visitor emails for follow-up. |
| **Suggested Chips** | Auto-generated from the Knowledge tab as quick-tap prompts. |

### 🎟️ Invite & Onboarding Flow
| Feature | Description |
|---------|-------------|
| **One-Click Registration** | Full-screen signup with Name, Username, Phone, OTP (demo). |
| **Shareable Invite Links** | Deep-linked URLs that auto-open the chat on click. |
| **Auto-Register from Invite** | New users register in ~8 seconds via a single welcome screen. |
| **Trap Mode** | If someone opens an invite meant for another number, they register but the sender is never revealed. |
| **Animated Welcome Popup** | Logo hero + beating heart badge + drifting sparkles + shimmer title. |
| **Native Share Sheet** | Works with WhatsApp, Telegram, SMS, Gmail — one message, one link, no duplication. |

### 🧠 Memory & Privacy
| Feature | Description |
|---------|-------------|
| **Two-Toggle Consent** | Users explicitly choose: "Remember my calls" and "Use my chats as context". |
| **Both Off by Default** | Chat context is opt-in only — the safest default. |
| **Per-User Memory** | RAGina greets you by name and recalls your previous conversations. |
| **Right to Forget** | Toggle off in settings and all future calls are stateless. |

### 📊 Admin & Analytics
| Feature | Description |
|---------|-------------|
| **User Dashboard** | `admin.html` — password-protected list of all registrations. |
| **Search & Filter** | By name, username, or phone number. |
| **CSV Export** | One-tap download of the full user list. |
| **Live Stats** | Total users · Joined today · Joined this week. |
| **Conversation Analytics** | Server-side stats from the Google Sheet. |
| **Email Notifications** | New registration → email alert to the admin instantly. |

### 🎨 UI/UX
| Feature | Description |
|---------|-------------|
| **Adaptive Themes** | Light, Dark, and Neon modes with instant switching. |
| **Desktop Split Layout** | WhatsApp-Web style sidebar + conversation pane on real desktops. |
| **Edge-to-Edge Mobile** | Safe-area aware, notch-friendly, true fullscreen on phones. |
| **Cross-Platform** | Works on Android, iOS, tablets, desktop Chrome, Firefox, Safari, Edge. |
| **Debug Console** | In-app terminal with copy-to-clipboard and visibility toggle. |
| **Toasts & Haptics** | Non-blocking notifications + vibration feedback on Android. |

---

## 🎯 Unique Selling Propositions

### 1. **Zero-Backend Architecture**
No servers, no monthly bills, no DevOps. Everything runs on free tiers:
- **GitHub Pages** hosts the app
- **Firebase Firestore** syncs messages & presence
- **PeerJS** handles WebRTC signaling
- **Google Sheets + Apps Script** powers analytics, admin, and AI memory
- **RAGina** provides the AI brain

You can fork this repo and have a production app running in 15 minutes — for $0.

### 2. **AI-Native by Design**
RAGina isn't a bolt-on chatbot. It's woven into the core:
- **Voice calls** with real barge-in, latency tracking, streaming TTS
- **Persistent memory** across calls (with consent)
- **Business concierge** deployable as a public URL
- **Knowledge-grounded** answers from a Sheet anyone can edit

### 3. **Deployable AI Receptionist**
Turn any Google Sheet into a customer-facing AI agent:
- Universities → admissions, courses, hostel fees
- Hospitals → departments, timings, insurance
- Hotels → rooms, rates, amenities
- Any business → FAQ-driven support

Every conversation logged. Every email captured. Every Q answered from your approved knowledge base.

### 4. **True P2P Privacy**
Chats are encrypted end-to-end via WebRTC. Media streams never touch our servers. **Only metadata** (who called whom, when) flows through Firestore.

### 5. **Consent-First Memory**
Unlike other AI assistants that silently remember everything, Sandesai:
- Shows a consent dialog on first use
- Has two separate toggles (memory + chats)
- Both default to OFF
- One tap to disable everything

---

## 🏢 Business Use Cases

| Industry | How Sandesai Helps |
|----------|-------------------|
| **Customer Support** | Deploy `concierge.html` as a public AI agent. Handles FAQs 24/7. Captures emails for follow-up. Logs every question. |
| **Education** | University admissions bot answering course, hostel, and fee queries. Voice + chat both supported. |
| **Healthcare** | Department routing, appointment info, insurance questions — all from a Sheet anyone can edit. |
| **Sales & Lead Gen** | Outbound AI voice calls with auto-transcripts and summaries. |
| **Telehealth** | Encrypted voice/video consultations with AI-generated patient summaries. |
| **Remote Teams** | Self-hosted team communication — chat, calls, files, AI, and analytics. |

---

## 🧰 Tech Stack

```

┌─────────────────────────────────────────────────────────────┐
│  Frontend           : HTML5, CSS3, Vanilla JS (no build)    │
│  Real‑time DB       : Firebase Firestore                    │
│  WebRTC             : PeerJS                                │
│  AI Brain           : RAGina (custom RAG agent)             │
│  Voice (STT)        : Web Speech API                        │
│  Voice (TTS)        : Web Speech Synthesis                  │
│  Media Storage      : IndexedDB (sandesaiMedia)             │
│  Analytics          : Google Sheets + Apps Script           │
│  Hosting            : GitHub Pages                          │
│  PWA                : Service Worker + Manifest             │
│  Offline            : Full localStorage fallback            │
└─────────────────────────────────────────────────────────────┘

```

---

## 🏗️ Architecture

```

┌──────────┐      ┌────────────┐     ┌──────────────┐
│ Firestore│      │  PeerJS    │     │  Google      │
│ ──────── │      │  ────────  │     │  Sheets      │
│ Messages │      │  WebRTC    │     │  ────────    │
│ Presence │      │  Signaling │     │  Admin       │
│ Profiles │      │  P2P Data  │     │  Analytics   │
│ Call Log │      │  Channels  │     │  Concierge   │
│ Signals  │      └────────────┘     │  Memory      │
└──────────┘                          └──────────────┘
│
▼
┌──────────┐
│  RAGina  │
│ ──────── │
│  RAG LLM │
└──────────┘

```

---

## 📦 Project Structure

```

sandesai/
├── index.html              # Main messenger app
├── admin.html              # Admin dashboard (view all users)
├── concierge.html          # Public AI receptionist page
├── style.css               # All styles (themes, layout, animations)
├── script.js               # UI, chat, contacts, Firebase messaging
├── app.js                  # Calling core — PeerJS, RAGina voice, video
├── js/
│   ├── enhancements.js     # Boot gate, invite, welcome popup, settings
│   ├── raginaMemory.js     # Persistent memory + context builder
│   ├── voiceAgentSkills.js # Barge-in, latency, streaming TTS
│   ├── mediaStorage.js     # IndexedDB blob storage
│   ├── fileTransfer.js     # Chunked PeerJS file transfer
│   └── aiAgent.js          # AI chat overlay logic
├── sandesai-logo.png
├── README.md
└── LICENSE

```

---

## 👨‍💻 About the Creator

**Surya (suryasticsai)** is a **Techno Agilist, Dev Engineer, and Strategic Consultant** with over **6+ years of experience** at **Tata Consultancy Services**.

He specialises in:
- Building **scalable web applications** with modern JavaScript
- Integrating **AI/ML pipelines** into production systems
- Designing **user-centric interfaces** that blend form and function
- Leading **cross-functional teams** to deliver high-impact solutions

---

## 🔗 Connect with Surya

<div align="center">

[![Gmail](https://img.shields.io/badge/Gmail-D14836?style=for-the-badge&logo=gmail&logoColor=white)](mailto:suryasticsai@gmail.com)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/suryasticsai)
[![Hugging Face](https://img.shields.io/badge/HuggingFace-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black)](https://huggingface.co/suryasticsai)
[![Medium](https://img.shields.io/badge/Medium-000000?style=for-the-badge&logo=medium&logoColor=white)](https://medium.com/@suryasticsai)
[![Instagram](https://img.shields.io/badge/Instagram-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://instagram.com/suryasticsai)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/suryasticsai)

</div>

---

## 🚦 Getting Started

### Prerequisites
- A modern browser (Chrome, Firefox, Edge, or Safari)
- Internet connection for Firebase and WebRTC signaling

### Quick Start
1. Clone the repository:
   ```
   git clone https://github.com/suryasticsai/sandesai.git

2. Open index.html in your browser — or deploy to GitHub Pages for a live URL
3. Register with a 10-digit phone number (OTP demo: 1234)
4. Start chatting, calling, and talking to RAGina

Deploying Your Own Concierge

1. Create a Google Sheet with three tabs: Business, Knowledge, Conversations
2. Add your business info to the Business tab (key/value pairs)
3. Add FAQs to the Knowledge tab (Question / Answer / Category)
4. Deploy the Apps Script as a Web App (Execute as: Me, Access: Anyone)
5. Paste the /exec URL into concierge.html
6. Share concierge.html with your customers

---

🧪 Beta Status

Sandesai is currently in Beta v0.3. We're actively shipping new features and refining existing ones.

Known Limitations

· WebRTC calling requires both peers to be online simultaneously
· OTP verification is demo-only (use 1234)
· Voice agent barge-in requires Chrome or Edge (Web Speech API)
· Google Sheets API has a 20,000 request/day free tier

Roadmap

☑ Real-time chat + WebRTC voice/video calling
☑ AI voice agent with barge-in
☑ Deployable AI concierge
☑ Admin dashboard
☑ Google Sheets integration
☑ Persistent memory + consent
☑ Invite links with auto-registration
☑ Media file transfer (chunked P2P)
☐ End-to-end encryption for chats
☐ Group calling and group messaging
☐ Custom AI agent training per user
☐ Native mobile apps (React Native)
☐ Enterprise SSO integration
☐ WhatsApp/SMS gateway integration for real invites

---

🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

1. Fork the repository
2. Create a feature branch (git checkout -b feature/amazing-feature)
3. Commit your changes (git commit -m 'Add amazing feature')
4. Push to the branch (git push origin feature/amazing-feature)
5. Open a Pull Request

---

📄 License

This project is licensed under the MIT License — see the LICENSE file for details.

---

🙏 Acknowledgements

· PeerJS — for making WebRTC simple
· Firebase — for real-time sync without a backend
· Google Sheets + Apps Script — for zero-cost analytics and AI memory
· RAGina — for the AI brain
· Font Awesome — for beautiful icons
· Google Fonts — for the Inter and Space Grotesk typefaces
· The open-source community — for endless inspiration

---

📬 Feedback

Have a suggestion or found a bug? Open an issue or reach out to Surya directly via GitHub.

---

<div align="center">

Sandesai — Where AI meets communication.

Built with ♥ by Surya

⬆ Back to top

</div>
