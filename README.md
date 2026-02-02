# CopywriteAI - AI-Powered Ad Script Generator

An AI-powered copywriter platform focused on generating winning ad scripts for social media using the Grok API.

## Features

- **AI-Powered Script Generation**: Uses Grok API to generate high-conversion ad scripts
- **Structured Interview Process**: 5 targeted questions to understand your business
- **Multiple Script Angles**: Generates 5 unique scripts (Direct Sale, Discredit Competitors, Process Certainty, Pain/Solution, Social Proof)
- **User Authentication**: Secure login/signup via Supabase Auth
- **Conversation History**: Store and manage all past conversations
- **Script Management**: Save, export, and organize generated scripts
- **Responsive Design**: Works on desktop and mobile

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS
- **Backend**: Supabase (Auth, PostgreSQL)
- **AI**: Grok API (xAI)
- **Hosting**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- Supabase account
- Grok API key from xAI

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd copywrite
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_GROK_API_KEY=your_grok_api_key
```

4. Set up Supabase database:
   - Go to your Supabase project
   - Open SQL Editor
   - Run the contents of `supabase/schema.sql`

5. Start development server:
```bash
npm run dev
```

## Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Settings > API** to get your URL and anon key
3. Run the SQL schema in **SQL Editor** (see `supabase/schema.sql`)
4. Enable Email auth in **Authentication > Providers**

## Deployment to Vercel

1. Push code to GitHub
2. Connect repository to Vercel
3. Add environment variables in Vercel dashboard:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_GROK_API_KEY`
4. Deploy

## Project Structure

```
src/
├── components/       # Reusable UI components
│   ├── Layout.tsx
│   └── ProtectedRoute.tsx
├── contexts/         # React contexts
│   └── AuthContext.tsx
├── lib/              # Third-party configs
│   └── supabase.ts
├── pages/            # Page components
│   ├── Chat.tsx
│   ├── Dashboard.tsx
│   ├── History.tsx
│   ├── Login.tsx
│   ├── Scripts.tsx
│   ├── Settings.tsx
│   └── Signup.tsx
├── services/         # API services
│   ├── database.ts
│   └── grokApi.ts
├── types/            # TypeScript types
│   └── index.ts
├── App.tsx
├── main.tsx
└── index.css
```

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm test` - Run tests

## License

MIT
