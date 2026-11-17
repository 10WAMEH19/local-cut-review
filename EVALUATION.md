# Development checks

These engineering checks on 17 November 2026 covered playback, decision state and MP4 output.

## Automated checks

Checks covered a real upload and export, request validation, source preservation and retained-frame comparisons. Direct HTTP checks covered browser byte-range seeking, missing confirmation, invalid token, invalid source identifier and stale source hash.

## Changes and unresolved limits

The browser check found a CSS issue with the hidden file input. Confirmation messages were tailored to the operation.

Working-edit playback skips confirmed ranges by browser seeking and is approximate at boundaries. Export trims video and audio against the source times, re-encodes them, and checks duration/audio before offering the file. These checks cannot prove that a creator agrees with the edit. A controlled evaluation with creators, predeclared important content and matched proposed omissions remains future work.
