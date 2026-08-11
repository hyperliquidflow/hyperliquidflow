# Liquidation gate false positives, restored 2026-08-11

Reversal record for the one-off remediation run by
`scripts/restore-liq-gate-false-positives.ts --apply` at 2026-08-11T19:12:04Z.

## What happened

Until 2026-08-11 the hygiene liquidation gate read `liq_buffer_pct`, which is
`(accountValue - totalMarginUsed) / accountValue`: the share of equity not
committed as margin. That is a leverage statistic. It says nothing about how far
price has to move before a position is liquidated, so a wallet running its whole
balance as margin scored 0 and was removed as "liquidation imminent" while
sitting a long way from its liquidation price.

Of 36 wallets removed on that gate in the 48 hours before the fix, 30 were
nowhere near liquidation: median true distance 25.6%, and only 2 were genuinely
inside the 5% threshold.

## What was restored

Each candidate was re-checked against live Hyperliquid state at run time rather
than trusted from a captured list, so wallets that had genuinely deteriorated
since removal stayed out.

| Verdict | Count | Meaning |
|---|---|---|
| restore | 22 | funded, holding, and passes the corrected gate |
| unfunded | 11 | drained below $10,000 since removal |
| still_at_risk | 3 | genuinely inside 5% of liquidation now |

Equity returned to the cohort: $6,828,130. Active wallet count went 76 to 98.

## Reversal

Setting `is_active = false` with `deactivation_reason = 'liq_imminent'` on every
address below marked `restore` returns the prior state.

| Address | Verdict | Equity at check | Positions | True distance to liquidation |
|---|---|---|---|---|
| 0xf79ff138ad12140c6d2d7ee8bae563addcc7ee09 | unfunded | $8,320 | 1 | n/a |
| 0x972b0f9cde1266e860e546ac92e783741769400f | restore | $97,381 | 6 | 68.8% |
| 0xbd7d7ea34d2999c67b5a51cf8d8dace4dff64c10 | restore | $56,200 | 1 | 10.7% |
| 0x42bc06d636e9a9a93edb1ddf781ee97821a73946 | unfunded | $645 | 1 | 72922.1% |
| 0xb8e462e6d1bede403b40afa364346b70b0fea206 | unfunded | $0 | 0 | n/a |
| 0x83016fe081f31a03be2bcb398c2b995d445ab6b1 | unfunded | $6,430 | 1 | 13.7% |
| 0xf1e2783541c3edbe783c6b89e7cfd493c7894af5 | restore | $963,790 | 2 | n/a |
| 0x970b206f3bfb86f06581bbec04dd2e703266fe84 | unfunded | $3,507 | 2 | 47.1% |
| 0x082654b2217afff4a7f29bff78102f2febc519cb | restore | $34,765 | 1 | 11.6% |
| 0x452ea0373056462c8e3b301c996ecfab3511d712 | restore | $61,832 | 3 | 10.7% |
| 0xec89639d883a9ff2086c6deb0d766064b5bbea03 | unfunded | $219 | 1 | 13658.9% |
| 0xa6181aac4474b43c3ca575ac8b1ad17643ec20b8 | restore | $1,039,651 | 2 | 7.6% |
| 0xfeec88b13fc0be31695069f02bac18538a154e9c | restore | $11,959 | 1 | 19.7% |
| 0xd46979f07f5d1e86ae2dcc5e6e0f3af5fe270471 | restore | $24,343 | 1 | 43.0% |
| 0x9aca58e24ff5845f245e7c2c897fef1bc59b3555 | restore | $70,105 | 2 | 24.5% |
| 0x7246180bc9134c95bf9fc35860d3c731a9a2f867 | restore | $17,863 | 1 | 52.1% |
| 0x51ead28bd827e7685aa131971d820c1c2bac9094 | still_at_risk | $33,396 | 2 | 1.5% |
| 0x8484f0d446694d9e4ac446c4d4616c67f7560534 | unfunded | $0 | 0 | n/a |
| 0x53f81d22b16ff1718ab8ee52bff0592685325f92 | unfunded | $9,402 | 2 | 35.4% |
| 0xf48d169abbcaecea883d4116913ac67563e4cd54 | restore | $262,786 | 1 | 175.7% |
| 0x6f577a1b7e3915d4d8c49c951e2332912a62d8a1 | restore | $12,279 | 1 | 89.8% |
| 0xfe8c8076596dd917a20a31007ced69ce339129a1 | unfunded | $7,899 | 1 | 81.6% |
| 0xcb735a17a743685df6b520ef0617102087e995da | restore | $27,991 | 1 | 19.8% |
| 0x362ad6209a5e904a5569f69884375809c5781d9f | restore | $3,439,606 | 1 | 28.6% |
| 0x5ab4c45896687bab14bbf73b78765e6dfac795ac | restore | $173,763 | 4 | 15.3% |
| 0x660316498c79ca048117198284f6f6faffaf45db | restore | $33,489 | 1 | 9.6% |
| 0xafaca2cae451403775504d63c57b400615e621cb | restore | $41,765 | 1 | 43.0% |
| 0x1f67d79afc8d0e7609ddba6c9b657cc635f69981 | restore | $17,183 | 1 | n/a |
| 0x095ac70965bed96cda5d80682ddecb6059f29559 | unfunded | $1,117 | 2 | 313.3% |
| 0xb7caf868835eac09f4fcb0ab85b942d8722c26de | restore | $23,144 | 1 | 105.6% |
| 0x06b0b7df4cbe61fa5344b07826dae297175c06ae | unfunded | $104 | 1 | 24.9% |
| 0x9d6ca7aad4c3cbb1cc18b5e7b8e59496a03bb22f | restore | $125,221 | 1 | 23.9% |
| 0xf08a8913f1d9693ea0285a3872ed1e98854f8d47 | restore | $278,848 | 1 | 196.6% |
| 0x431f1cbb550be14da5cb3da1157010d1e83a6cee | still_at_risk | $2,875,612 | 1 | 4.8% |
| 0x9d6468a5ab22fb02f990a778039443d264ef31fe | restore | $14,171 | 2 | 48.4% |
| 0x27aef25d774abc98ed55ec926c3e1461eca4184a | still_at_risk | $539,582 | 1 | 4.5% |
