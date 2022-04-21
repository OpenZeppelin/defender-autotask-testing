# Compound Distribution Monitor

## Description

This agent monitors the Compound Finance Comptroller contract for distribution events
that exceed a configurable threshold.

## Alerts

<!-- -->
- AE-COMP-DISTRIBUTION-EVENT
  - Type is always set to `Suspicious`
  - Severity is always set to `High`
  - Metadata field contains:
    - Amount of COMP distributed
    - Amount of COMP accrued
    - Receiver address

## Autotask

This autotask will send alerts to the compound discord channel when the agent produces a finding.