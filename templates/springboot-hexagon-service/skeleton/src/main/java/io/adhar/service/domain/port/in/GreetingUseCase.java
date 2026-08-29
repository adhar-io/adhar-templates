package io.adhar.service.domain.port.in;

import java.util.List;

import io.adhar.service.domain.model.Greeting;

/** Inbound port — what the application offers to driving adapters (e.g. web). */
public interface GreetingUseCase {

    Greeting greet(String name);

    List<Greeting> history();
}
