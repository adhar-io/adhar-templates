package io.adhar.service.security;

import java.util.List;
import java.util.Map;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Path-level access rules, under Adhar Kit's property names so they read the same
 * as in every other Adhar Spring service.
 *
 * @param permitAll   path patterns anyone may call, without a token
 * @param authorities path pattern → the authorities that may call it, checked in
 *                    order, e.g. {@code "[/api/admin/**]": [ROLE_admin]}
 */
@ConfigurationProperties("adhar.security.authorization")
record AuthorizationProperties(
        @DefaultValue List<String> permitAll,
        @DefaultValue Map<String, List<String>> authorities) {
}
