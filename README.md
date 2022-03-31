# Defender Autotask Testing

This repository contains code to facilitate development and testing of OpenZeppelin Defender Autotasks.

Rather than creating Autotask scripts in the Defender Web App and then waiting for appropriate blockchain events
to trigger a Forta Sentinel, this code allows a developer to specify a range of blocks to use for retrieving alerts
from the Forta Public API.  Those alerts are then fed directly into the Autotask in the same format that they would
have if they were occurring live.
