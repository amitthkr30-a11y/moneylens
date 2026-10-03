# Supabase Cloud Sync: complete setup (about 10 minutes, free)

1. **Create the project.** Go to https://supabase.com, choose **Start your project** and sign in with GitHub. Then choose **New project**:
   - Name: `moneylens`
   - Region: **South Asia (Mumbai)**
   - Plan: **Free**
   - Database password: choose **Generate** and save it. MoneyLens never needs it.
2. **Create the table and storage.** Go to **SQL Editor → New query**. Paste all of `supabase/setup.sql` and choose **Run**. You should see `Success`.
   - Check: **Table Editor** shows a `user_data` table with "RLS enabled".
   - Check: **Storage** shows a `statements` bucket marked **Private**.
3. **Set the site address.** Go to **Authentication → URL Configuration** and set **Site URL** and **Redirect URLs** to `https://amitthkr30-a11y.github.io/moneylens/`.
4. **Turn off email confirmation.** Go to **Authentication → Sign In / Providers → Email** and turn **OFF** "Confirm email". This is simplest for personal use.
   - After you have created your own account, you can also turn off "Allow new users to sign up" so no one else can join.
5. **Copy the two public values.** Go to **Project Settings → API**. Copy the **Project URL** and the **anon public** key (or the **publishable** key).
   - Never copy **service_role** or any **secret** key. The app refuses them.
6. **Add them to the app.** Edit `js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```
7. **Publish.** Run `git add -A`, `git commit -m "enable cloud sync"` and `git push`. Then open the site and press Ctrl + Shift + R.
8. **Create your account.** On the laptop, go to **Cloud Sync → Create account**. This is a MoneyLens password, not your bank password.
9. **Sign in on the iPhone.** Open the same URL in Safari and go to **Cloud Sync → Sign in**. Your data appears without re-uploading anything.

| Message | Fix |
|---|---|
| "Cloud database is not set up yet" | Run `supabase/setup.sql` again. |
| "Please confirm your email first" | Click the link in the email, or turn off "Confirm email". |
| "That is the SECRET service_role key" | Use the anon/publishable key instead. |
| Free project paused (after about 7 days without use) | In the Supabase dashboard, choose **Restore**. Your data is kept. |
