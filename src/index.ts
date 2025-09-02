import express from 'express';

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'bookmaker', ts: new Date().toISOString() });
});

app.get('/', (_req, res) => {
  res.send('bookmaker: Hello, world!');
});

app.listen(port, () => {
  console.log(`bookmaker listening on http://localhost:${port}`);
});
