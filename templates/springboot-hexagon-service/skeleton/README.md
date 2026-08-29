# ${{ values.name }}

${{ values.description }}

A Spring Boot service in **hexagonal (ports & adapters)** architecture,
pre-configured with **Adhar Kit** and shipped through Adhar's secure supply
chain (build → scan → sign → verify → Argo Rollouts).

## Architecture

```
adapter/in/web ──▶ port/in (GreetingUseCase) ──▶ application (GreetingService)
                                                        │
                                                        ▼
                                             port/out (GreetingRepository)
                                                        ▲
                              adapter/out/persistence ──┘
                              (InMemory  ·  Jdbc when a DB is provisioned)
```

The domain (`domain/model`, `domain/port`) has **zero framework dependencies**;
web and persistence are swappable adapters behind ports. Provisioning a database
swaps the outbound adapter from in-memory to JDBC (`@Primary`) with no change to
the domain or use case.

```
src/main/java/io/adhar/service/
├── domain/
│   ├── model/Greeting.java
│   └── port/{in/GreetingUseCase, out/GreetingRepository}.java
├── application/GreetingService.java
└── adapter/
    ├── in/web/GreetingController.java
    └── out/persistence/{InMemory,Jdbc}GreetingRepository.java
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Service info |
| GET | `/healthz` | Health check |
| POST | `/greet?name=…` | Create a greeting |
| GET | `/greetings` | List greetings |

Observability (OTLP traces + metrics), Adhar Kit config, and the Gitea Maven
registry are wired exactly as in `springboot-web-service`.
