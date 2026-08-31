# Security Policy

## Supported versions

Only the latest published release receives security fixes.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: **Security tab → Report a
vulnerability** on this repository. Please do not open a public issue for
anything security-sensitive. You should hear back within a few days.

## What counts as a vulnerability here

This library builds prompts and parses untrusted model output, so beyond the
usual (dependency issues, prototype pollution, ReDoS in the parsers), these are
in scope:

- A way to make `parseReply` leak the report block, secret tags, or delimiters
  into `visible` text.
- A way to bypass a secret's `requires` gate — anything that puts a `concrete`
  payload into a prompt whose gates have not passed.
- A crafted model reply that corrupts state parsing (accepts a malformed vector
  instead of failing closed) or registers reveals for secrets that were never
  unlocked.

A jailbreak that talks a character out of an *emotionally unlocked* secret is
not a vulnerability — once the payload is in the prompt, keeping it in-character
is the model's job, not a security boundary. That line is drawn in
[docs/design.md](docs/design.md).
