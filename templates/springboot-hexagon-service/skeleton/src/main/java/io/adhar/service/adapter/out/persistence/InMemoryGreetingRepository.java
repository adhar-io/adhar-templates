package io.adhar.service.adapter.out.persistence;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.stereotype.Repository;

import io.adhar.service.domain.model.Greeting;
import io.adhar.service.domain.port.out.GreetingRepository;

/** Outbound (driven) adapter — in-memory persistence (default). */
@Repository
public class InMemoryGreetingRepository implements GreetingRepository {

    private final List<Greeting> store = new CopyOnWriteArrayList<>();
    private final AtomicLong seq = new AtomicLong();

    @Override
    public Greeting save(String message) {
        Greeting g = new Greeting(seq.incrementAndGet(), message);
        store.add(g);
        return g;
    }

    @Override
    public List<Greeting> findAll() {
        return List.copyOf(store);
    }
}
