# The development container's image.
#
# The SAME file in every application created from an Adhar template (the
# templates' test suite keeps the copies identical). What differs per
# application comes in as build.args from devcontainer.json:
#
#   BASE_IMAGE           an official Dev Containers image carrying the language
#                        toolchain at the version the repository declares: the
#                        version app-ci tests on and the buildpack build ships
#   CLIENT_PACKAGES      command-line clients for the backing services the
#                        application was created with (Debian packages)
#   NPM_GLOBAL_PACKAGES  Node.js only: command-line tools installed with npm -g
#   WITH_GOPLS           Go only: the Go language server (see below)
#
# Everything a Dev Container Feature can install comes from one, in
# devcontainer.json. This file adds only what no feature can:
#   - trivy and gitleaks, copied out of the very images app-ci runs its gates
#     with, so a finding here is a finding there (trivy 0.58.1 is published
#     only as that image any more);
#   - the Adhar CLI, from its release image, for this container's architecture;
#   - kustomize at the version Argo CD renders deploy/ with;
#   - the clients, the npm tools and gopls.
ARG BASE_IMAGE=mcr.microsoft.com/devcontainers/base:trixie
# `latest` follows the platform's releases; set it (e.g. 0.1.67) to hold one.
ARG ADHAR_VERSION=latest

# app-ci's scanners (adhar-supply-chain 72-app-ci-stages.yaml), pinned by the
# digest of the multi-architecture image. Move them together with app-ci.
FROM docker.io/aquasec/trivy:0.58.1@sha256:ab70a02200597efa04748f210f793936eb647cbcdb0ea69cc30b226d6f5a22c7 AS trivy
FROM ghcr.io/gitleaks/gitleaks:v8.21.2@sha256:0e99e8821643ea5b235718642b93bb32486af9c8162c8b8731f7cbdc951a7f46 AS gitleaks
FROM ghcr.io/adhar-io/adhar:${ADHAR_VERSION} AS adhar

FROM ${BASE_IMAGE}
COPY --from=adhar /adhar /usr/local/bin/adhar
COPY --from=trivy /usr/local/bin/trivy /usr/local/bin/trivy
COPY --from=gitleaks /usr/bin/gitleaks /usr/local/bin/gitleaks

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# kustomize at the version Argo CD 3.5 bundles, so `kustomize build
# deploy/envs/dev` shows exactly what Argo CD applies. Its release image is
# amd64-only, so the release archive is downloaded and checked against the
# checksum pinned here.
ARG KUSTOMIZE_VERSION=5.8.1
ARG KUSTOMIZE_SHA256_AMD64=029a7f0f4e1932c52a0476cf02a0fd855c0bb85694b82c338fc648dcb53a819d
ARG KUSTOMIZE_SHA256_ARM64=0953ea3e476f66d6ddfcd911d750f5167b9365aa9491b2326398e289fef2c142
RUN arch="$(dpkg --print-architecture)" \
 && case "${arch}" in \
      amd64) sum="${KUSTOMIZE_SHA256_AMD64}" ;; \
      arm64) sum="${KUSTOMIZE_SHA256_ARM64}" ;; \
      *) echo "kustomize: unsupported architecture ${arch}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL --retry 3 -o /tmp/kustomize.tgz \
      "https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2Fv${KUSTOMIZE_VERSION}/kustomize_v${KUSTOMIZE_VERSION}_linux_${arch}.tar.gz" \
 && echo "${sum}  /tmp/kustomize.tgz" | sha256sum -c - \
 && tar -xzf /tmp/kustomize.tgz -C /usr/local/bin kustomize \
 && rm /tmp/kustomize.tgz

# psql, valkey-cli and kcat, for exactly the backing services devcontainer.json names.
ARG CLIENT_PACKAGES=""
RUN if [ -n "${CLIENT_PACKAGES// /}" ]; then \
      apt-get update \
      && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${CLIENT_PACKAGES} \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# Global npm tools (tsx, to run any TypeScript file directly). Installed into
# the image's npm prefix, which belongs to the npm group the container's user
# is in, so `npm update -g` keeps working afterwards.
ARG NPM_GLOBAL_PACKAGES=""
RUN if [ -n "${NPM_GLOBAL_PACKAGES// /}" ]; then \
      npm install -g --no-audit --no-fund ${NPM_GLOBAL_PACKAGES} \
      && chmod -R g+rwX "$(npm config get prefix)" \
      && npm cache clean --force > /dev/null 2>&1; \
    fi

# The Go image's own gopls install fails when the newest gopls needs a newer Go
# than the image carries (its GOTOOLCHAIN=local forbids the download), which
# leaves the editors without a language server. Built here with the toolchain
# gopls asks for, which is then removed again: the project keeps its own Go.
ARG WITH_GOPLS=false
RUN if [ "${WITH_GOPLS}" = "true" ]; then \
      GOTOOLCHAIN=auto GOFLAGS=-modcacherw GOPATH=/tmp/gopls GOCACHE=/tmp/gopls/cache GOBIN=/usr/local/bin \
        go install golang.org/x/tools/gopls@latest \
      && rm -rf /tmp/gopls; \
    fi
