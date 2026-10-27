module ${{ values.name }}

// The minimum language level. The toolchain that builds the image — and runs
// the tests in app-ci — is BP_GO_VERSION in project.toml.
go 1.25.0
