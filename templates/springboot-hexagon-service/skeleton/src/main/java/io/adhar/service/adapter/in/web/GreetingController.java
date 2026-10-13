package io.adhar.service.adapter.in.web;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.adhar.service.domain.model.Greeting;
import io.adhar.service.domain.port.in.GreetingUseCase;

/** Inbound (driving) adapter — translates HTTP to the inbound port. */
@RestController
public class GreetingController {

    private final GreetingUseCase useCase;

    public GreetingController(GreetingUseCase useCase) {
        this.useCase = useCase;
    }

    @GetMapping("/")
    public Map<String, String> index() {
        return Map.of("service", "${{ values.name }}", "status", "ok");
    }

    @PostMapping("/greet")
    public Greeting greet(@RequestParam(required = false) String name) {
        return useCase.greet(name);
    }

    @GetMapping("/greetings")
    public List<Greeting> greetings() {
        return useCase.history();
    }
}
