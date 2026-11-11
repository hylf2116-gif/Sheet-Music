# Deploying Unino online

Setup: **frontend on Vercel** (free) + **backend on Railway** (Hobby, about $5/month minimum,
plus about $0.15/GB/month for the volume). Supabase stays as it is (login + recent sessions).

You create the accounts and click the buttons; nothing here needs a password typed into the code.
Screen labels on Vercel/Railway may differ slightly from this guide (they change their dashboards).

---

## 0. Before you start

- The code you deploy is the `main` branch on GitHub (`hylf2116-gif/Sheet-Music`).
- Have your Supabase values ready (Supabase dashboard → Project Settings → API):
  - **Project URL** (looks like `https://xxxx.supabase.co`)
  - **anon public key** (a long text starting with `eyJ`)
  The anon key is meant to be public; never use the `service_role` key anywhere below.

## 1. Backend on Railway

1. Go to https://railway.com and sign in with GitHub.
2. **New Project → Deploy from GitHub repo →** pick `Sheet-Music`.
3. Open the new service → **Settings**:
   - **Root Directory:** `backend`
   - **Start command:** `npm start` (usually detected automatically)
   - **Healthcheck path:** `/health`
4. **Add a volume** (right-click the service or "+ New → Volume"), attach it to the service,
   **mount path:** `/data`. This is where rooms and PDFs are kept between restarts.
5. Service → **Variables**, add:

   | Name | Value |
   |---|---|
   | `DATA_DIR` | `/data` |
   | `ENABLE_OMR` | `false` |
   | `FRONTEND_ORIGIN` | `http://localhost:3000` for now (you change it in step 3) |
   | `SUPABASE_URL` | your Supabase Project URL |
   | `SUPABASE_ANON_KEY` | your Supabase anon public key |

   Do **not** set `PORT`; Railway sets it.
6. Service → **Settings → Networking → Generate Domain.** Copy the address,
   e.g. `https://sheet-music-production.up.railway.app`.
7. Check it: open `<that address>/health` in a browser. You should see `{"ok":true}`.

Keep the backend at **1 replica** (rooms are kept in memory; two copies would not see each other).

## 2. Frontend on Vercel

1. Go to https://vercel.com and sign in with GitHub.
2. **Add New → Project →** import `Sheet-Music`.
3. **Root Directory:** `frontend` (Framework: Next.js is detected).
4. **Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_BACKEND_URL` | the Railway address from step 1.6 (no slash at the end) |
   | `NEXT_PUBLIC_SUPABASE_URL` | your Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your Supabase anon public key |

5. **Deploy.** When it finishes, copy your site address, e.g. `https://sheet-music.vercel.app`.

If you change a `NEXT_PUBLIC_…` variable later, **redeploy** (they are built into the page).

## 3. Connect the two

1. Railway → backend service → Variables → set `FRONTEND_ORIGIN` to your Vercel address
   (e.g. `https://sheet-music.vercel.app`, no slash at the end). Railway restarts the backend.
   Several addresses can be listed with commas.
2. Supabase → **Authentication → URL Configuration**:
   - **Site URL:** your Vercel address
   - **Redirect URLs:** add your Vercel address (keep `http://localhost:3000` for local work)

## 4. Check it works

Open the Vercel address, then:

- [ ] Upload a PDF → a room opens, the score shows
- [ ] **Share** → the copied link starts with your Vercel address
- [ ] Open that link on another device / phone on mobile data → both see the same drawings live
- [ ] Draw, erase, undo; raise hand on the student side → the teacher hears the chime
- [ ] Measures panel says "only available in the local version" (expected)
- [ ] IMSLP search: works, or shows an error (IMSLP may limit cloud servers; then download the PDF manually and upload it)
- [ ] Railway → **Redeploy** the backend → the room and drawings are still there (proves the volume works)

## Settings reference (backend)

| Variable | Default (local) | Online |
|---|---|---|
| `PORT` | 3001 | set by Railway |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | your Vercel address |
| `DATA_DIR` | `backend/data` (uploads in `backend/uploads`) | `/data` (uploads in `/data/uploads`) |
| `ENABLE_OMR` | on | `false` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | from `backend/.env` | from Supabase |

## Limits built in

- PDF uploads: 200 MB each, 20 per hour per IP; new rooms: 60 per hour per IP
- IMSLP: 5 searches and 3 imports per minute per IP
- Rooms only accept PDFs uploaded to this server
- Students can only change or clear their own annotations; the host can change all
