package io.adhar.service.domain.port.out;

import java.util.List;

import io.adhar.service.domain.model.Greeting;

/** Outbound port — what the application needs from driven adapters (persistence). */
public interface GreetingRepository {

    Greeting save(String message);

    List<Greeting> findAll();
}
