# Security and Data Handling

Never commit secrets. Use environment variables or secret stores.
Default to local/offline backends. Cloud/HW backends must be explicit opt-in.
Logs must not include PII or raw subject identifiers; redact tokens and IDs.
Record software versions and seeds for reproducibility.
Validate inputs and deny dangerous configurations (e.g., disallow unknown backends by default).
