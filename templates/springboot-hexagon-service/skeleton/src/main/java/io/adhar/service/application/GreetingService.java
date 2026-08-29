package io.adhar.service.application;

import java.util.List;

import org.springframework.stereotype.Service;

import io.adhar.service.domain.model.Greeting;
import io.adhar.service.domain.port.in.GreetingUseCase;
import io.adhar.service.domain.port.out.GreetingRepository;

/**
 * Application service — the use case implementation. Depends only on ports, so
 * the domain stays independent of web and persistence frameworks.
 */
@Service
public class GreetingService implements GreetingUseCase {

    private final GreetingRepository repository;

    public GreetingService(GreetingRepository repository) {
        this.repository = repository;
    }

    @Override
    public Greeting greet(String name) {
        String who = (name == null || name.isBlank()) ? "World" : name;
        return repository.save("Hello, " + who + "!");
    }

    @Override
    public List<Greeting> history() {
        return repository.findAll();
    }
}
