{%- if values.withDatabase %}
CREATE TABLE IF NOT EXISTS greeting (
    id      BIGSERIAL PRIMARY KEY,
    message TEXT NOT NULL
);
{%- endif %}
