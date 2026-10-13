{%- if values.withKafka %}
package io.adhar.service.events;

import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedDeque;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Round-trips events through Kafka: {@code POST /events} produces to the topic,
 * the {@link KafkaListener} below consumes it, and {@code GET /events} shows
 * what this replica received most recently.
 */
@RestController
@RequestMapping("/events")
public class EventController {

    private static final int RECENT = 20;

    private final KafkaTemplate<String, String> kafka;
    private final String topic;
    private final Deque<String> received = new ConcurrentLinkedDeque<>();

    public EventController(KafkaTemplate<String, String> kafka,
                           @Value("${app.kafka.topic}") String topic) {
        this.kafka = kafka;
        this.topic = topic;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, String> publish(@RequestBody String payload) {
        kafka.send(topic, payload);
        return Map.of("topic", topic, "status", "sent");
    }

    @GetMapping
    public List<String> recent() {
        return new ArrayList<>(received);
    }

    @KafkaListener(topics = "${app.kafka.topic}")
    void onEvent(String payload) {
        received.addFirst(payload);
        while (received.size() > RECENT) {
            received.pollLast();
        }
    }
}
{%- endif %}
