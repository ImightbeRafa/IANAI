# CopywriteAI - Development Progress

## Last Updated: February 2, 2026 at 12:08 PM (UTC-06:00)

---

## Project Overview

**CopywriteAI** is an AI-powered ad script generator using Grok API. The platform generates high-conversion ad scripts for social media based on Ian's copywriting methodology.

---

## Architecture Restructure (Current Work)

### Previous Approach (DEPRECATED)
- AI conducted a 5-question interview through chat
- Users answered questions one by one in the chat
- AI generated scripts after collecting all answers

### New Approach (CURRENT)
- Users create Products/Services via a **form** with all business context
- Product context is stored in database and passed to AI automatically
- Chat is used **only** for script generation and refinement
- Users can provide additional context per session
- Feedback mechanism allows iterating on generated scripts

---

## Account Types

### 1. Single User (Individual)
**Hierarchy:**
```
User
└── Products/Services
    └── Chat Sessions (Script Generation)
        └── Generated Scripts
```

### 2. Team Account
**Hierarchy:**
```
Team
└── Clients
    └── Products/Services
        └── Chat Sessions (Script Generation)
            └── Generated Scripts
```

Teams can organize products/services under different clients for better management when handling multiple clients.

---

## UI Structure

### Dashboard
- **Single User**: Shows list of Products/Services
- **Team User**: Shows list of Clients, each expandable to show their Products/Services
- Stats cards showing: Total Products, Total Scripts, Total Sessions, Scripts This Month

### ProductWorkspace (Chat Interface)
```
+------------------+------------------------+-------------------+
|                  |                        |                   |
|  SESSION LIST    |      CHAT AREA         |   PRODUCT INFO    |
|  (Left Panel)    |      (Center)          |   (Right Panel)   |
|                  |                        |                   |
|  - New Session   |  Messages display      |  - Editable info  |
|  - Session 1     |  here with AI          |  - Description    |
|  - Session 2     |  responses             |  - Offer          |
|  - ...           |                        |  - Values         |
|                  |                        |                   |
|                  |  [Generate Script]     |  EXTRA CONTEXT    |
|                  |                        |  - Session-specific|
|                  |  [Input + Send]        |    context        |
|                  |                        |  - Feedback       |
+------------------+------------------------+-------------------+
```

---

## Database Schema

Using the NEW schema from `supabase/migrations/001_teams_restructure.sql`:

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles (extends auth.users) |
| `teams` | Team accounts |
| `team_members` | Users belonging to teams |
| `clients` | Clients (team accounts only) |
| `products` | Products/Services with all business context |
| `chat_sessions` | Chat sessions per product |
| `messages` | Chat messages |
| `scripts` | Saved/generated scripts |

---

## Files Structure

### Active/Current Files
- `src/App.tsx` - Main router
- `src/pages/Dashboard.tsx` - Dashboard for both account types
- `src/pages/ProductWorkspace.tsx` - Main chat/script interface
- `src/pages/Login.tsx` - Login page
- `src/pages/Signup.tsx` - Signup page
- `src/pages/Settings.tsx` - User settings
- `src/components/Layout.tsx` - App layout with navigation
- `src/components/ProductForm.tsx` - Form for creating/editing products
- `src/components/ProtectedRoute.tsx` - Auth guard
- `src/components/ThinkingAnimation.tsx` - AI loading animation
- `src/services/database.ts` - Supabase database functions
- `src/services/grokApi.ts` - Grok API integration
- `src/contexts/AuthContext.tsx` - Authentication context
- `src/contexts/LanguageContext.tsx` - i18n language context
- `src/types/index.ts` - TypeScript types
- `api/chat.ts` - Vercel serverless function for Grok API

### Removed (Feb 2, 2026)
- ~~`src/pages/Chat.tsx`~~ - DELETED (old interview-based chat)
- ~~`src/pages/History.tsx`~~ - DELETED (old conversation history)
- ~~`src/pages/Scripts.tsx`~~ - DELETED (old scripts page)

---

## Change Log

### February 2, 2026 - 12:08 PM (UTC-06:00)
- [x] Created PROGRESS.md for tracking
- [x] Fixed API parameter mismatch (`productContext` → `businessDetails`) in `src/services/grokApi.ts`
- [x] Updated `supabase/schema.sql` to use new teams/products structure (replaced old conversations schema)
- [x] Removed deprecated pages from codebase:
  - Deleted `src/pages/Chat.tsx` (old interview-based chat)
  - Deleted `src/pages/History.tsx` (old conversation history)
  - Deleted `src/pages/Scripts.tsx` (old scripts page)
- [x] Removed legacy types from `src/types/index.ts` (Conversation, BusinessDetails)
- [x] Updated `src/pages/ProductWorkspace.tsx` with proper 3-panel layout:
  - Left: Session list with New Session button
  - Center: Chat area with Generate Script button (empty state), messages, Save Script on AI responses
  - Right: Editable product info (all fields) + Additional Context section
- [x] Added script generation button with `Sparkles` icon
- [x] Added regenerate button with `RefreshCw` icon in input area
- [x] Added save script functionality with `BookmarkPlus` icon on AI messages
- [x] Added bilingual labels for all new features (ES/EN)
- [x] Dashboard already supports single users with "Upgrade to Team" option

### February 2, 2026 - 12:26 PM (UTC-06:00)
- [x] Updated sidebar menu in `src/components/Layout.tsx`:
  - Removed: New Script, History, My Scripts (old pages that no longer exist)
  - Kept: Dashboard, Settings
  - Added bilingual labels (ES/EN)
- [x] Created migration `supabase/migrations/002_make_all_accounts_team.sql`:
  - Updates all existing profiles to `account_type = 'team'`
  - Creates teams for users who don't have one
  - Adds owners as team admins

---

## TODO / Next Steps

### High Priority
1. **Team Dashboard UI** - Client management for team accounts
   - Create/edit/delete clients
   - Products organized under clients
   - Team member invitation and management

### Medium Priority
2. **Script Library** - Dedicated page to view all saved scripts
3. **Script Export** - Export scripts as PDF/TXT/Copy to clipboard
4. **Toast Notifications** - User feedback for save actions

### Low Priority / Future
5. **Subscription/Billing** - Paid plans with usage limits
6. **Analytics** - Track script performance/engagement
7. **Templates** - Pre-built script templates by industry

---

## Testing Steps

### 1. Apply Database Migration
Run this in your Supabase SQL Editor:
```sql
-- First, check current state
SELECT id, email, account_type FROM profiles;

-- Then run the migration
UPDATE profiles 
SET account_type = 'team', updated_at = NOW()
WHERE account_type = 'single';

-- Create teams for users who don't have one
INSERT INTO teams (name, owner_id)
SELECT 
  COALESCE(p.full_name, p.email) || '''s Team' as name,
  p.id as owner_id
FROM profiles p
WHERE p.account_type = 'team'
  AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.owner_id = p.id);

-- Verify
SELECT * FROM profiles;
SELECT * FROM teams;
```

### 2. Start Dev Server
```bash
npm run dev
```

### 3. Test New Workflow
1. Login to existing account (should now be team type)
2. Go to Dashboard - verify clean sidebar (only Dashboard + Settings)
3. Create a new Product/Service using the form
4. Navigate to the product workspace
5. Click "Generate Script" button
6. Verify AI generates 5 scripts
7. Test "Save Script" button on AI response
8. Test "Regenerate" button
9. Edit product info in right panel
10. Add session context and save

### 4. Verify Database
In Supabase dashboard, check:
- `profiles` table has `account_type = 'team'`
- `products` table has your new products
- `chat_sessions` has new sessions
- `messages` has chat messages
- `scripts` has saved scripts (if you saved any)

---

## API Notes

### Grok API Endpoint
- URL: `https://api.x.ai/v1/chat/completions`
- Model: `grok-4-1-fast-reasoning`
- The system prompt includes Ian's copywriting methodology with examples

### Request Body
```json
{
  "messages": [...],
  "businessDetails": { ... product context ... },
  "language": "en" | "es"
}
```

---

## Environment Variables

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
GROK_API_KEY=your_grok_api_key (server-side only)
```
