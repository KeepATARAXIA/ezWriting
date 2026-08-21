# Pagination Stress

## Section 01

Short paragraphs should stay in order when cards are measured and refilled. This sentence provides a stable amount of text for the first section.

## Section 02

Short paragraphs should stay in order when cards are measured and refilled. This sentence provides a stable amount of text for the second section.

## Section 03

1. Preserve the first item.
2. Preserve the second item.
3. Preserve the third item.
4. Preserve the fourth item.

## Section 04

> Quoted paragraphs may split between cards, but every sentence must remain present.
>
> A second quoted paragraph verifies that adjacent quote fragments can be merged again.

## Section 05

| Index | Result | Note |
| --- | --- | --- |
| 01 | pass | first row |
| 02 | pass | second row |
| 03 | pass | third row |
| 04 | pass | fourth row |
| 05 | pass | fifth row |

## Section 06

```text
line-01
line-02
line-03
line-04
line-05
line-06
line-07
line-08
```

## Section 07

The seventh section deliberately repeats a longer paragraph so the deterministic fallback paginator must create another card. Every clause remains meaningful to the regression: order is preserved, text is not duplicated, text is not dropped, and the final page remains readable after earlier pages have been filled.

The second paragraph in this section adds another stable block. It is long enough to exercise sentence splitting while remaining ordinary prose that can be compared directly in the combined paginated output.

## Section 08

The eighth section continues with a third long paragraph. Reliability checks should prefer synthetic repeatable content over private production articles, because contributors can run the same corpus locally and in continuous integration without exposing unpublished writing.

The final paragraph closes the fixture with the marker `final-reliability-marker`, which must survive every pagination strategy and appear exactly once in the reconstructed output.
