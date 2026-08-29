const express = require('express');
{%- if values.withDatabase %}
const { Pool } = require('pg');
{%- endif %}

const app = express();
const port = process.env.PORT || ${{ values.port }};

app.get('/', (req, res) => {
  res.json({ service: '${{ values.name }}', status: 'ok' });
});

app.get('/healthz', (req, res) => res.status(200).send('ok'));

{%- if values.withDatabase %}
// DATABASE_URL is injected from the CloudNativePG-generated secret.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get('/db', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT now() AS now');
    res.json({ db: 'ok', now: rows[0].now });
  } catch (err) {
    res.status(500).json({ db: 'error', error: err.message });
  }
});
{%- endif %}

app.listen(port, () => {
  console.log(`${{ values.name }} listening on port ${port}`);
});
