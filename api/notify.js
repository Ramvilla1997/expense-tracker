// Daily job, called by Vercel Cron (see vercel.json). Vercel sends the CRON_SECRET as a bearer token.
import { runDailyReminders } from '../lib/push-server.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Not allowed.' });
    return;
  }
  try {
    res.status(200).json(await runDailyReminders(new Date()));
  } catch (err) {
    console.error('daily reminders failed:', /** @type {any} */ (err)?.message);
    res.status(500).json({ error: 'Reminders could not be sent.' });
  }
}
