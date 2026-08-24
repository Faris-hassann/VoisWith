# Document OCR UiPath Activity

This repository contains a staged implementation of a UiPath custom activity that will eventually extract text from PDF and image documents.

Intended public activity name: `Extract Text From Document`

Current implementation phase: Phase 4 - Tesseract OCR Engine

Version 1 target:
- UiPath Studio Windows projects
- Windows-first delivery
- `net6.0`

## Verified status

Phase 1 verification is complete:
- Solution membership, project XML, and dependency graph verified.
- `dotnet restore` and `dotnet build` succeeded with `0` warnings and `0` errors.
- Packaging remains intentionally non-packable.

Phase 2 is implemented and verified:
- Provider-neutral Core models for options, page ownership, and OCR results.
- Core contracts for OCR, page rendering, and image preprocessing.
- Input validation for path, supported extensions, and maximum file size.
- Focused domain exceptions for unsupported files, file size limits, page limits, and processing failures.
- Deterministic xUnit coverage for Core invariants and validation behavior (`51` passing tests).

Phase 3 is implemented and verified:
- `PdfPageRenderer` renders local PDFs sequentially through `DocumentPage` without accumulating all pages in memory.
- `OcrOptions.PdfScale` maps to `72 × PdfScale` DPI. The default scale `3` renders at `216` DPI.
- Page-count validation happens before the first page is yielded. If the PDF exceeds `MaximumPages`, rendering fails with `DocumentPageLimitExceededException` and no partial result set is returned.
- `ImagePreprocessor` decodes PNG, JPEG, WebP, BMP, and TIFF inputs, applies conservative normalization, and returns lossless PNG output streams positioned at `0`.
- Preprocessing includes EXIF-orientation normalization when enabled, deterministic grayscale conversion with alpha preservation, conservative percentile-based contrast stretching, and mild fixed-kernel sharpening.
- TIFF decoding is limited to the first directory/page for this phase.
- Deterministic Infrastructure coverage verifies rendering, scale handling, page limits, cancellation, file-lock cleanup, format conversion, orientation handling, contrast improvement, sharpening behavior, and stream ownership (`33` passing tests).

Phase 4 is implemented and verified:
- `TesseractOcrEngine` performs local OCR for single `DocumentPage` images through the `IOcrEngine` contract.
- `Tesseract` `5.2.0` is confined to `DocumentOcr.Infrastructure`.
- English language data is bundled with the repository as `src/DocumentOcr.Infrastructure/TessData/eng.traineddata` from the official `tessdata_fast` `4.1.0` tag object `a8ba5063ab8013372a20e300da0c97ee46b92b07` / peeled commit `65727574dfcd264acbb0c3e07860e4e9e9b22185`, together with `LICENSE.tessdata_fast.txt`.
- The bundled `eng.traineddata` is pinned at exactly `4,113,088` bytes with SHA-256 `7D4322BD2A7749724879683FC3912CB542F19906C83BCC1A52132556427170B2`.
- Default TessData resolution is assembly-relative at `TessData` next to the built assembly; an explicit canonical override path is also supported.
- OCR languages are validated as lowercase provider-specific codes before any stream or native work starts. Combined expressions such as `eng+ara` are rejected at the API boundary; callers must pass `["eng", "ara"]` instead.
- Confidence is normalized from the native wrapper's `0.0..1.0` ratio to the Core `0..100` range exactly once.
- Engine access is serialized per instance with `SemaphoreSlim`, a compatible engine is reused by language, and recognition runs in `EngineMode.LstmOnly`.
- OCR remains local-only. The engine does not upload images, log raw image bytes, or persist recognized text.
- Deterministic Infrastructure coverage now includes real OCR, bundled data integrity checks, language validation, missing TessData, missing/corrupt traineddata handling, confidence range checks, cancellation, stream ownership, engine disposal, and recovery after failed native initialization (`61` passing tests total in `DocumentOcr.Infrastructure.Tests`).

## Current architecture

- `src/DocumentOcr.Core`
  Technology-independent Core contracts, models, validation, and domain exceptions.
- `src/DocumentOcr.Infrastructure`
  Home for PDF rendering, image preprocessing, and the local Tesseract OCR engine. Future phases add orchestration and trained-data expansion.
- `src/Company.UiPath.DocumentOcr.Activities`
  Future UiPath-facing activity layer. It remains thin and depends on Core and Infrastructure.
- `src/Company.UiPath.DocumentOcr.Activities.Packaging`
  Packaging scaffold only. It is deliberately non-packable until supported UiPath packaging conventions are confirmed.
- `tests/DocumentOcr.Core.Tests`
  Unit tests for the implemented Core behavior.
- `tests/DocumentOcr.Infrastructure.Tests`
  Unit tests for PDF rendering, image preprocessing, and OCR behavior.
- `tests/Company.UiPath.DocumentOcr.Activities.Tests`
  Placeholder for later activity-facing tests.

## Project reference direction

- `DocumentOcr.Infrastructure` -> `DocumentOcr.Core`
- `Company.UiPath.DocumentOcr.Activities` -> `DocumentOcr.Core`, `DocumentOcr.Infrastructure`
- `Company.UiPath.DocumentOcr.Activities.Packaging` -> `Company.UiPath.DocumentOcr.Activities`
- `DocumentOcr.Core.Tests` -> `DocumentOcr.Core`
- `DocumentOcr.Infrastructure.Tests` -> `DocumentOcr.Infrastructure`
- `Company.UiPath.DocumentOcr.Activities.Tests` -> `Company.UiPath.DocumentOcr.Activities`

## Selected Infrastructure libraries

- `PDFtoImage` `5.2.1`
- `SkiaSharp` `3.119.4`
- `BitMiracle.LibTiff.NET` `2.4.660`
- `Tesseract` `5.2.0`

These packages remain confined to `DocumentOcr.Infrastructure`. `DocumentOcr.Core` still has no package references and no dependency on Infrastructure or native imaging/PDF libraries.

## Phase boundaries

The repository still does not include:
- `DocumentOcrService`
- UiPath activity implementation
- Final packaging or runtime-distribution work

Those remain deferred to later phases in the blueprint.

## Build and test

Restore:

```powershell
& 'C:\Program Files\dotnet\dotnet.exe' restore DocumentOcr.UiPath.sln
```

Build:

```powershell
& 'C:\Program Files\dotnet\dotnet.exe' build DocumentOcr.UiPath.sln --no-restore
```

Run verified tests:

```powershell
$env:DOTNET_ROLL_FORWARD = 'Major'
& 'C:\Program Files\dotnet\dotnet.exe' test tests\DocumentOcr.Core.Tests\DocumentOcr.Core.Tests.csproj --no-build --no-restore
& 'C:\Program Files\dotnet\dotnet.exe' test tests\DocumentOcr.Infrastructure.Tests\DocumentOcr.Infrastructure.Tests.csproj --no-build --no-restore
Remove-Item Env:DOTNET_ROLL_FORWARD
```

## Native/runtime notes

- `PDFtoImage` pulls native `pdfium` binaries.
- `SkiaSharp` pulls native Skia binaries.
- `Tesseract` pulls the managed `Tesseract.dll` wrapper together with native `tesseract50.dll` and `leptonica-1.82.0.dll` under `x64` and `x86`.
- Dependency license summary for this phase:
  - `Tesseract` wrapper: Apache-2.0
  - `tessdata_fast`: Apache-2.0
  - `Leptonica`: BSD-style / BSD-2-Clause
- The Windows test output includes `runtimes\win-x64\native\pdfium.dll` and `runtimes\win-x64\native\libSkiaSharp.dll`, alongside other RID-specific native assets from the selected packages.
- The Infrastructure test output and the Activities build output both include `Tesseract.dll`, `TessData\eng.traineddata`, `TessData\LICENSE.tessdata_fast.txt`, `x64\tesseract50.dll`, `x64\leptonica-1.82.0.dll`, `x86\tesseract50.dll`, and `x86\leptonica-1.82.0.dll`.
- The charlesw wrapper documents a prerequisite on the Microsoft Visual Studio 2019 x86 and x64 runtimes. That prerequisite remains external to this repository.
- The bundled native OCR assets are Windows `x86`/`x64` only. Windows ARM64 is not verified or supported in this phase.
- PDF rendering is Windows-first for Version 1, but package restore currently brings along Linux and macOS native assets as transitive runtime content as well.
- PDF rendering cancellation is cooperative around page boundaries. Cancellation can stop before the next render starts or after a render completes, but an in-progress native page render is not interruptible mid-call.
- OCR cancellation is likewise boundary-cooperative. Cancellation is checked before stream copy, before native OCR, and after native OCR, but the native recognition call itself is not interruptible mid-call.
- The OCR engine owns and disposes its internal `TesseractEngine`. Callers still own every `DocumentPage` and its borrowed image stream.

## OCR security and operational limits

- `TessDataDirectory` overrides are intended for trusted operators only. This phase does not attempt to sandbox or authenticate externally supplied `.traineddata` files.
- The upstream Tesseract project published `GHSA-x3vq-7rr7-5x3h` on July 15, 2026 and `GHSA-7j76-5rq5-5jg8` on August 4, 2026 for crafted `.traineddata` deserialization issues. The official `5.5.3` release tag object is `6951ffe10ce031374bcd04fe400811da1e7e04ad` and its peeled commit is `db0ec62f81b0737fbbe184d8fea40af5738f8eef`.
- `dotnet list package --vulnerable --include-transitive` reported no vulnerable NuGet packages for the resolved managed package graph, but that scan does not account for the embedded native Tesseract / traineddata advisories documented above.
- This repository still pins the managed wrapper package `Tesseract` `5.2.0`, so Phase 7 must re-evaluate the OCR stack against upstream `5.5.3+` before broader packaging or distribution work.
- Until that Phase 7 review happens, treat both document inputs and TessData overrides as trusted-only deployment surfaces.

## OCR engine behavior

- Bundled language(s): `eng`
- TessData lookup:
  - default: assembly-relative `TessData`
  - override: explicit canonical directory path passed to `TesseractOcrEngine` by a trusted operator
- Language handling:
  - accepted format: lowercase letters, digits, and underscores only, maximum length `64`
  - duplicates: rejected
  - combined expressions such as `eng+ara`: rejected at the API boundary; pass `["eng", "ara"]` instead
- Confidence behavior:
  - native wrapper: `0.0..1.0`
  - Core result: `0..100`
  - conversion: multiply by `100` once and clamp to the Core range
- Engine lifecycle:
  - one `TesseractEngine` instance cached per `TesseractOcrEngine` instance and current language expression
  - reused across repeated calls when the language expression is unchanged
  - disposed deterministically with the engine instance
  - recognition mode: `EngineMode.LstmOnly`
- Thread-safety:
  - access is serialized per `TesseractOcrEngine` instance with `SemaphoreSlim`
  - no static global engine cache is used

## Toolchain note

The local machine currently has the .NET 10 SDK and runtime available. Core and Infrastructure tests were verified successfully by using a process-local major roll-forward from the `net6.0` test target to the installed .NET 10 runtime.

Native execution on an exact .NET 6 runtime has not been verified yet because that runtime is not installed locally.

## Next phase

The next planned phase is Phase 5 - Complete OCR Orchestration Service.
