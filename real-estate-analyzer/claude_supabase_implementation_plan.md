# Supabase & Authentication Implementation Plan

## Objective
Migrate the existing backend of the Real Estate Analyzer project to Supabase, and implement user accounts with robust authentication.

## Instructions for Claude Code
Please follow this plan to move our backend data layer to Supabase and integrate a complete authentication flow. **Do not break existing core logic** like the AI underwriting and analysis; instead, update the data access layer to use Supabase and tie records to authenticated users.

### Phase 1: Supabase Setup & Configuration
1. **Dependencies**:
   - Install `@supabase/supabase-js` on the frontend.
   - Install the Supabase Python client (`supabase`) on the FastAPI backend.
2. **Environment Variables**:
   - Add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (if needed for backend admin tasks) to the `.env` file.
3. **Database Migration**:
   - Migrate data models from the current SQLite setup (`real_estate.db`) to Supabase Postgres.
   - Create necessary tables (Properties, Analyses, Saved Items) ensuring each table has a `user_id` column referencing Supabase's `auth.users` table.

### Phase 2: User Authentication Implementation
1. **Frontend Auth Interface**:
   - Create Sign Up, Log In, and Log Out components/pages.
   - Implement Supabase Auth API calls (Email/Password).
   - Set up an Auth Context/Provider in React to manage the user's session globally.
   - Create protected route wrappers for the Dashboard and Saved Analyses pages.
2. **Backend JWT Verification**:
   - Update the FastAPI backend to require and verify Supabase JWTs in the Authorization header.
   - Create a dependency in FastAPI to extract the current user's ID from the validated token.

### Phase 3: Wiring & Integration
1. **Refactor Data Access**:
   - Switch all CRUD operations in the FastAPI endpoints to query Supabase directly using the Python client.
   - Ensure all `INSERT` operations attach the authenticated user's ID.
   - Ensure all `SELECT`, `UPDATE`, and `DELETE` operations filter by the user's ID to prevent cross-account access.
2. **Frontend Network Layer**:
   - Update frontend API utility functions to automatically append the user's Supabase session token to the `Authorization` header for all backend requests.

### Phase 4: Testing & Verification
1. Verify user registration, login, and logout flows.
2. Verify that JWT tokens are correctly passed to the backend and validated.
3. Verify that running an AI analysis successfully stores the result in Supabase tied appropriately to the active user's ID.
4. Confirm Row Level Security (RLS) policies are configured in Supabase to restrict user data visibility natively.
