# Development checks

These engineering checks were performed with Codex assistance on 24 November 2026. The creator supplied the recordings, set a brief and inspected the four-source result. These checks are separate from a participant study.

## Automated checks

The Python suite has 12 checks. It covers HTTP range playback, upload and original preservation, rejecting unconfirmed or invalid exports, mixed source sequence rendering, exact retained ranges, and rejecting a proposed cut that would discard a new instruction. Media tests generate temporary clips with FFmpeg. The JavaScript suite has five checks covering cut confirmation and restoration, preservation of earlier decisions, interval boundaries, overlapping cuts and source removal.

## Observed workflows

| Case | Observed behavior |
| --- | --- |
| Batch import in Safari | All five selected files loaded. They included the 4K 120 fps source and its 1080p copy. The original's 540 × 960 H.264 preview was about 8 MB and played in Safari. The source is about 490 MB. |
| Alternate copy | Picture and audio fingerprints paired the original and the H.264 conversion. The proposal kept the original in the timeline and made the copy available to include. |
| Three real sources, deliberately scrambled | Input order 5725, 5724, 5723. AI order 5723, 5725, 5724. The planner linked the later 13–16 seconds of 5723 to the spoken setup at 0–5 seconds. Combined preview and 1080 × 1920 export both measured 31.32 seconds. |
| Four sources with a brief in Safari | The order was 5721, 5725, 5724, 5723. The brief asked for device introductions and readiness to leave, keeping all devices and the reason for leaving. The proposal compared “Yeah” in 5724 (3–4 s) and 5721 (31–32 s). Before confirmation the draft was 71.0 s. The subsequent confirmed 4K portrait export measured 70.03 s. |
| Open filmed example | In a separate Safari project, the button loaded the four original MOV files, all with previews ready, and prefilled the creator's exact goal and preservation note. The converted copy was excluded. |
| Repeated speech fixture | A temporary, derived local test clip repeated an utterance and included different water and jacket actions. The planner linked 10–14 s to 0–5 s and left the distinct later material untouched. |
| 4K output | A two-second cut rendered from the 4K original as 2160 × 3840 H.264 at 30 fps, with audio. This checked resolution and source use on one supported file. |

Private recordings and raw inference outputs remain local. The public-facing figures use schematic clip labels.

## Limits

The four-source proposal demonstrates a model weakness. The same short word in different scenes may play a different role. The confirmed export records the editing decision. Its quality still depends on the creator's judgement about context. The system may also produce no proposed cuts. Groups of sampled frames can miss a brief action, and speech timestamps may need boundary adjustment. The original can be reviewed and intervals can be restored without repeating analysis. The current export normalizes format and does not preserve the original 120 fps or HDR. These checks apply to the observed workflows and device.
