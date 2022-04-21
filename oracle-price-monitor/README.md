# Compound Oracle Price Monitor Agent

## Description

This agent monitors the UniswapAnchoredProxy contract for PriceGuarded events which indicate that
a ValidatorProxy reported a cToken price that is outside of the Uniswap V2 TWAP percent threshold.

## Alerts

<!-- -->
- AE-COMP-CTOKEN-PRICE-REJECTED
  - Type is always set to `Degraded`
  - Severity is always set to `High`
  - Metadata field contains:
    - Address of the affected cToken
    - Address of the underlying token
    - Address of the respective ValidatorProxy contract
    - Anchor Price (current price)
    - Reporter Price (failed price)

## Autotask

This autotask will send alerts to the compound discord channel when the agent produces a finding.