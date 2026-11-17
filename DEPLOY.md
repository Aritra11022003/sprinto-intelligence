# Deploying Sprinto Intelligence: step by step

You need **3 things**: a GitHub account, an email inbox (Gmail, or any address via Resend), and a Vercel account (free, sign in with GitHub).
Total time: about 15 minutes. Do the steps in order, and tick each box as you go.

---

## Part 1: Put the code on GitHub (public repo)

- [ ] **1.1** Open a terminal **in the project folder** (`sprinto-intelligence`).
- [ ] **1.2** Check you're logged in to GitHub:
  ```bash
  gh auth status
  ```
  If it says "not logged in", run `gh auth login`, choose **GitHub.com → HTTPS → Login with a web browser**, and follow the code it shows.
- [ ] **1.3** Create the public repo and push the code in one command:
  ```bash
  gh repo create sprinto-intelligence --public --source=. --remote=origin --push
  ```
- [ ] **1.4** Open the link it prints (e.g. `https://github.com/<you>/sprinto-intelligence`). You should see the code and README.
  ✅ **This is your GitHub link for submission.**

> No `gh`? On github.com click **New repository** → name `sprinto-intelligence` → **Public** → *don't* add a README → **Create**. Then run the two commands GitHub shows under "…push an existing repository" (`git remote add origin …` and `git push -u origin main`).

---

## Part 2: Set up email to yourself (free)

The app emails the draft **only to you**. Do **Option A**. Use Option B only if A doesn't work for your account.

### Option A (preferred): Gmail app password

- [ ] **2.1** Go to **https://myaccount.google.com/security**.
- [ ] **2.2** Under "How you sign in to Google", turn on **2-Step Verification** if it's off (follow Google's prompts).
- [ ] **2.3** Go to **https://myaccount.google.com/apppasswords**.
- [ ] **2.4** In "App name" type `Sprinto Intelligence` and click **Create**.
- [ ] **2.5** Google shows a 16-letter password like `abcd efgh ijkl mnop`. **Copy it now** (it is shown only once). Spaces don't matter.

You'll add `GMAIL_USER_EMAIL` and `GMAIL_APP_PASSWORD` in Part 3.

> **"The setting you are looking for is not available for your account"?** That usually means a school/work account where the admin disabled app passwords. Either use a personal `@gmail.com` account for Option A, or go to Option B.

### Option B (backup): Resend free tier

- [ ] **2.6** Go to **https://resend.com/signup** and sign up **with the email address you want the drafts delivered to** (this matters: on the free test sender, Resend only delivers to your own sign-up address).
- [ ] **2.7** Confirm your email, then open **API Keys → Create API Key**. Name it `sprinto`, permission **Sending access**, then **Add**.
- [ ] **2.8** Copy the key (starts with `re_`). It is shown only once.

You'll add `GMAIL_USER_EMAIL` (your sign-up email) and `RESEND_API_KEY` in Part 3. No domain setup is needed.

---

## Part 3: Deploy on Vercel

- [ ] **3.1** Go to **https://vercel.com/signup** and choose **Continue with GitHub**.
- [ ] **3.2** On the dashboard click **Add New… → Project**.
- [ ] **3.3** Find `sprinto-intelligence` in the list and click **Import**. (If it's missing, click "Adjust GitHub App Permissions" and give Vercel access to the repo.)
- [ ] **3.4** Leave everything as detected (Framework: **Next.js**). Open **Environment Variables** and add the variables for the option you chose (two in total):

  | Name | Value |
  |---|---|
  | `GMAIL_USER_EMAIL` | your inbox, e.g. `you@gmail.com` (Option B: your Resend sign-up email) |
  | `GMAIL_APP_PASSWORD` | **Option A:** the 16-letter app password from step 2.5 |
  | `RESEND_API_KEY` | **Option B only:** the `re_…` key from step 2.8 (skip if you did Option A) |

- [ ] **3.5** Click **Deploy** and wait about 1 minute for "Congratulations!".
- [ ] **3.6** Click **Continue to Dashboard → Visit**. Copy the URL (e.g. `https://sprinto-intelligence.vercel.app`).
  ✅ **This is your live link for submission.**

### Make sure the link opens with no login wall (rubric item 1)
- [ ] **3.7** Open the live URL in an **incognito/private window**. You should see the dashboard immediately.
  If you see a Vercel login page instead: Project → **Settings → Deployment Protection** → set **Vercel Authentication** to **Disabled** (or "Only Preview Deployments") → **Save**, then try incognito again.

---

## Part 4: Test it end to end

- [ ] **4.1** Visit `https://<your-url>/api/health`. You should see `"email": true` and `"provider": "gmail"` (or `"resend"`). If `"email": false`, re-check the variables (Settings → Environment Variables), then go to **Deployments → ⋯ on the latest → Redeploy**. Variables only apply after a redeploy.
- [ ] **4.2** On the homepage click **Use example input → Start research**. Watch the stages tick through live.
- [ ] **4.3** Open your Gmail. Each QUALIFIED company (and flagged MANUAL REVIEW one) produces one email. **Check the Spam folder too** the first time, and mark it "Not spam".
- [ ] **4.4** Try an invalid input (e.g. `not a domain`, `localhost`, `foo@bar.com`): you should get clear errors, no crash.

---

## Part 5: Before you submit

- [ ] **5.1** The Vercel deployment must run the same code as GitHub (rubric item 7). In Vercel → **Deployments**, the top deployment should show the latest commit message from your repo. Vercel redeploys automatically on every `git push`.
- [ ] **5.2** Submit: **GitHub repo URL** + **Vercel URL** + your demo video.

### If you change code later
```bash
git add -A
git commit -m "describe the change"
git push
```
Vercel redeploys automatically in about a minute.

---

## Demo video: a suggested 3-minute script

1. **(20s) The problem:** 15–20 min of manual research per prospect; this does it in seconds with evidence.
2. **(40s) Run it live:** paste 3–4 domains (one certified, one qualified, one with `| Name | Title`, one invalid). Point out the stages ticking and "Hit 2/5: …" with the reason for each page.
3. **(60s) Defend the decisions:** open a QUALIFIED company. Show the Qualification tab (each gate + quote + link), the Evidence tab, and the Research log (why each page was fetched, never more than 5).
4. **(30s) Contact & pain points:** why this person (role ranking, source quote), and the two hypotheses tied to evidence.
5. **(30s) Email:** show the draft, then the same email arriving in Gmail with the "why it qualified" footer. Mention it only ever sends to you.
6. **(20s) Edge cases:** the invalid input errors and a DISQUALIFIED (already certified) company stopping after 1–2 pages.
