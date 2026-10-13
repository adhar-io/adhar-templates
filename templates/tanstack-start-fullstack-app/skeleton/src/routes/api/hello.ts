import { createFileRoute } from '@tanstack/react-router'
{%- if values.withDatabase %}
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
{%- endif %}

// Server route — runs only on the server (a real API endpoint at /api/hello).
export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: async () => {
{%- if values.withDatabase %}
        try {
          const { rows } = await pool.query('SELECT now() AS now')
          return Response.json({ service: ${{ values.name | dump }}, status: 'ok', db: rows[0].now })
        } catch {
          return Response.json({ service: ${{ values.name | dump }}, status: 'ok', db: 'error' })
        }
{%- else %}
        return Response.json({ service: ${{ values.name | dump }}, status: 'ok' })
{%- endif %}
      },
    },
  },
})
