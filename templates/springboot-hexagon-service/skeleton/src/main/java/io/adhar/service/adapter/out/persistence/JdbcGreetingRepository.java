{%- if values.withDatabase %}
package io.adhar.service.adapter.out.persistence;

import java.util.List;

import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import io.adhar.service.domain.model.Greeting;
import io.adhar.service.domain.port.out.GreetingRepository;

/** Outbound (driven) adapter — JDBC persistence; @Primary when a DB is present. */
@Repository
@Primary
public class JdbcGreetingRepository implements GreetingRepository {

    private final JdbcTemplate jdbc;

    public JdbcGreetingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Greeting save(String message) {
        Long id = jdbc.queryForObject(
                "INSERT INTO greeting(message) VALUES (?) RETURNING id", Long.class, message);
        return new Greeting(id, message);
    }

    @Override
    public List<Greeting> findAll() {
        return jdbc.query("SELECT id, message FROM greeting ORDER BY id",
                (rs, i) -> new Greeting(rs.getLong("id"), rs.getString("message")));
    }
}
{%- endif %}
