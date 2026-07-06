import { Router } from 'express';
import { getAuthUrl, handleOAuthCallback, isGoogleAuthorized, isGoogleConfigured } from '../lib/google.js';

export const authRouter = Router();

authRouter.get('/google', (_req, res) => {
  if (!isGoogleConfigured()) {
    return res.status(503).send('Google OAuth is not configured yet. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI in server/.env.');
  }
  res.redirect(getAuthUrl());
});

authRouter.get('/google/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) return res.status(400).send('Missing ?code from Google.');
  await handleOAuthCallback(code);
  res.send('Google Calendar connected — you can close this tab and go back to the dashboard.');
});

authRouter.get('/google/status', (_req, res) => {
  res.json({ configured: isGoogleConfigured(), authorized: isGoogleAuthorized() });
});
