package io.adhar.service;

import java.util.Map;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
{%- if values.withDatabase %}
import javax.sql.DataSource;

import jakarta.inject.Inject;
{%- endif %}

@Path("/")
public class GreetingResource {

{%- if values.withDatabase %}
    @Inject
    DataSource dataSource;
{%- endif %}

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Map<String, String> index() {
        return Map.of("service", "${{ values.name }}", "status", "ok");
    }

    @GET
    @Path("/healthz")
    @Produces(MediaType.TEXT_PLAIN)
    public String healthz() {
        return "ok";
    }

{%- if values.withDatabase %}
    @GET
    @Path("/db")
    @Produces(MediaType.APPLICATION_JSON)
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
