package io.adhar.service;

import java.util.Map;
{%- if values.withDatabase %}
import javax.sql.DataSource;
{%- endif %}

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HelloController {

{%- if values.withDatabase %}
    private final DataSource dataSource;

    public HelloController(DataSource dataSource) {
        this.dataSource = dataSource;
    }
{%- endif %}

    @GetMapping("/")
    public Map<String, String> index() {
        return Map.of("service", "${{ values.name }}", "status", "ok");
    }

{%- if values.withDatabase %}
    @GetMapping("/db")
    public Map<String, String> db() {
        try (var conn = dataSource.getConnection();
             var st = conn.createStatement();
             var rs = st.executeQuery("SELECT now()")) {
            rs.next();
            return Map.of("db", "ok", "now", rs.getString(1));
        } catch (Exception e) {
            return Map.of("db", "error", "error", e.getMessage());
        }
    }
{%- endif %}
}
