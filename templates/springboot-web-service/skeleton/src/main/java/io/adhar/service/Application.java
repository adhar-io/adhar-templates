package io.adhar.service;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
{%- if values.withCache %}
import org.springframework.cache.annotation.EnableCaching;
{%- endif %}

@SpringBootApplication
{%- if values.withCache %}
@EnableCaching
{%- endif %}
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
