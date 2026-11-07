// Sends a test notification to the signed-in person's phone. Requires their Firebase ID token.
import { memberEmailFromToken, sendTestPush } from '../lib/push-server.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }
  const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  let email;
  try {
    email = await memberEmailFromToken(token);
  } catch {
    res.status(401).json({ error: 'Sign in again, then try once more.' });
    return;
  }
  try {
    const outcome = await sendTestPush(email);
    if (outcome === 'none') {
      res.status(404).json({ error: 'Turn on notifications on this phone first.' });
      return;
    }
    res.status(200).json({ ok: outcome === 'sent' });
  } catch (err) {
    console.error('test push failed:', /** @type {any} */ (err)?.message);
    res.status(500).json({ error: 'The test could not be sent.' });
  }
}
