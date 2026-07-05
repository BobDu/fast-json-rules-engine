# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub Security Advisories
(the "Report a vulnerability" button on the repository's Security tab), not a
public issue.

## Threat model

- **Rules and compile options are trusted configuration.** Custom operators and
  the `pathResolver` are arbitrary functions you supply — never pass
  attacker-controlled functions to them.
- **Rule JSON from semi-trusted sources** is bounded at compile time: nesting
  depth is capped (a `CompileError`, not a stack overflow) and named-condition
  fan-out is memoized. Even so, treat rule documents as code you run.
- **Facts are data** — they are read, never evaluated as code.
- The published package has **zero runtime dependencies**.
