# Brand images

These are the images Home Assistant shows for this integration — on its page
under Devices & services, in HACS, and in the card picker.

They are **not** read from here. Home Assistant loads them from
`brands.home-assistant.io`, which is fed by the
[home-assistant/brands](https://github.com/home-assistant/brands) repository.
Until they are merged there, Home Assistant shows "icon not available".

To submit them, copy this folder's PNGs to
`custom_integrations/family_tracking/` in a fork of that repository and open a
pull request. The requirements they already meet:

| File | Size | Requirement |
|---|---|---|
| `icon.png` | 256×256 | square, 256×256 |
| `icon@2x.png` | 512×512 | square, 512×512 |
| `logo.png` | 768×256 | shortest side 128–256 |
| `logo@2x.png` | 1536×512 | shortest side 256–512 |

All four carry transparency and are trimmed, as the repository asks.
