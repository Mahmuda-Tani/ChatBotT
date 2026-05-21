# Tbot

A full-stack AI chat assistant with a React frontend and a FastAPI backend. Choose between **Anthropic (Claude)** and **Google Gemini** in the sidebar; responses stream in real time via Server-Sent Events (SSE).

## Tech stack

| Layer    | Stack |
|----------|--------|
| Frontend | React 18, Vite, Tailwind CSS |
| Backend  | FastAPI, Uvicorn, LangChain |
| LLMs     | Anthropic Claude Sonnet 4.6, Google Gemini 1.5 Flash |

## Project structure

```
Tbot/
├── backend/
│   ├── main.py           # FastAPI app and /chat endpoint
│   ├── requirements.txt
│   ├── .env              # API keys (create locally; not committed)
│   └── venv/             # Python virtual environment
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/   # Sidebar, ChatWidget
│   │   └── hooks/
│   ├── package.json
│   └── vite.config.js
└── README.md
```

## Prerequisites

- **Node.js** 18+ and **npm**
- **Python** 3.10+ (project venv uses 3.12)
- API keys for at least one provider:
  - [Anthropic](https://console.anthropic.com/)
  - [Google AI (Gemini)](https://aistudio.google.com/apikey)

## Environment variables

Create `backend/.env` with the keys for the providers you plan to use:

```env
GEMINI_API_KEY=your_gemini_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

You only need the key for the provider you select in the UI. If a key is missing when that provider is chosen, the API returns an error.

## Getting started

Run the **backend** and **frontend** in separate terminals. The UI talks to `http://localhost:8000`.

### Backend

```bash
cd backend

# Create and activate a virtual environment (first time only)
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# Install dependencies (first time or after requirements change)
pip install -r requirements.txt

# Start the API server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API is available at **http://localhost:8000**. Interactive docs: **http://localhost:8000/docs**.

### Frontend

```bash
cd frontend

# Install dependencies (first time only)
npm install

# Start the dev server
npm run dev
```

Open the URL Vite prints (usually **http://localhost:5173**). Use the floating chat widget and pick **Anthropic** or **Gemini** in the sidebar.

## Production build (frontend)

```bash
cd frontend
npm run build
npm run preview
```

`preview` serves the built app locally; point it at a backend URL if you change the API host in `frontend/src/App.jsx`.

## API

| Method | Path   | Description |
|--------|--------|-------------|
| `POST` | `/chat` | Stream a chat completion (SSE) |

**Request body:**

```json
{
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "provider": "anthropic"
}
```

- `provider`: `"anthropic"` or `"gemini"`
- `messages`: roles `"user"`, `"assistant"`, or `"system"`

**Response:** `text/event-stream` with `data: "<chunk>"` lines and a final `data: [DONE]`.

## Usage notes

1. Start the **backend** before sending messages from the UI.
2. CORS is open (`*`) for local development.
3. Default models (configured in `backend/main.py`):
   - Gemini: `gemini-1.5-flash`
   - Anthropic: `claude-sonnet-4-6`

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| `GEMINI_API_KEY is not set` / `ANTHROPIC_API_KEY is not set` | `backend/.env` exists and contains the key for the selected provider |
| Network / CORS errors in the browser | Backend is running on port 8000 |
| `Failed to fetch` | Backend started; firewall not blocking localhost |
| Module not found (Python) | Virtualenv activated and `pip install -r requirements.txt` completed |
