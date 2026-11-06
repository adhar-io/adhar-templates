FROM mcr.microsoft.com/devcontainers/java:3-25-trixie

ARG BASE_IMAGE
ARG CLIENT_PACKAGES

FROM ${BASE_IMAGE}

RUN apt-get update \
    && apt-get install -y --no-install-recommends ${CLIENT_PACKAGES} \
    && rm -rf /var/lib/apt/lists/*
