#!/usr/bin/env bash
set -euo pipefail

mvn -s settings.xml test
mvn -s settings.xml verify
