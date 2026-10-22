package io.adhar.service.web;

import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The gateway's landing page, so its route visibly answers in a browser. It is
 * open without a token for the same reason; everything it serves is routed.
 */
@RestController
class GatewayInfoController {

    private final Map<String, String> info;

    GatewayInfoController(@Value("${spring.application.name}") String name) {
        this.info = Map.of("service", name, "status", "ok");
    }

    @GetMapping("/")
    Map<String, String> index() {
        return info;
    }
}
