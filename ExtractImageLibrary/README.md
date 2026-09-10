# Document OCR UiPath Activity

This repository contains a staged implementation of a UiPath custom activity that will eventually extract text from PDF and image documents.

Intended public activity name: `Extract Text From Document`

Current implementation phase: Phase 6 - UiPath Custom Activity and ViewModel

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

Phase 5 is implemented and verified:
- `DocumentOcrService` now orchestrates validation, PDF rendering, optional preprocessing, OCR recognition, page-text cleanup, and final result aggregation in `DocumentOcr.Core`.
- Service branching is extension-based after validation: `.pdf` inputs stream through `IDocumentPageRenderer`, and supported image inputs are opened directly as a single `DocumentPage` with read-only shared access.
- The service owns and disposes every raw and processed `DocumentPage` that it touches. Injected renderer, preprocessor, and OCR engine instances remain caller-owned.
- Optional preprocessing is enforced strictly: returning the original page instance, changing page numbers, or returning duplicate OCR page numbers is rejected.
- Page text cleanup normalizes line endings, trims trailing spaces and tabs before line feeds, collapses runs of three or more blank lines to exactly two, trims outer whitespace, and joins non-empty page texts with exactly one blank line between pages.
- Unexpected image-open, preprocessing, and OCR failures are contextualized while cancellation, provider exceptions, disposal errors, and domain exceptions continue to propagate.
- Core orchestration coverage now includes image/PDF branching, cleanup rules, aggregation ordering, ownership/disposal, duplicate-page rejection, invalid preprocessor/OCR outputs, stage-specific failure contextualization, OCR-provider argument preservation, and cancellation (`78` passing tests total in `DocumentOcr.Core.Tests`).
- Infrastructure integration coverage now includes real end-to-end orchestration with `PdfPageRenderer`, `ImagePreprocessor`, `TesseractOcrEngine`, the existing `ocr-hello.png` fixture, repeatability and file-lock-release checks, caller-owned engine disposal checks, and a visually verified two-page raster PDF OCR fixture (`68` passing tests total in `DocumentOcr.Infrastructure.Tests`).

Phase 6 is implemented and verified:
- `ExtractTextFromDocument` exposes the v1 UiPath-facing activity surface with required `FilePath`, defaulted `Language`, PDF scale, maximum page/file limits, preprocessing toggle, and text/page-count/confidence outputs.
- The activity maps arguments into `OcrOptions`, keeps auto-rotation enabled internally, awaits `DocumentOcrService.ExtractAsync`, and assigns outputs only after successful completion.
- Runtime composition is kept in the activity layer: `PdfPageRenderer`, `ImagePreprocessor`, and `TesseractOcrEngine` are constructed for execution, and the Tesseract engine is disposed deterministically.
- Service/domain exceptions and cancellation propagate without converting failures into empty successful outputs.
- `ExtractTextFromDocumentViewModel`, embedded `ActivitiesMetadata.json`, localized resource strings, and `Resources/Icons/document-ocr.svg` provide the Studio presentation metadata for display name, category, principal properties, advanced properties, outputs, ordering, and icon.
- Activity coverage verifies argument shape, required/default behavior, option mapping, output mapping, metadata/resources/icon embedding, exception/cancellation propagation, build output assets, deterministic `WorkflowInvoker` execution, and real PNG/PDF workflow execution (`10` passing tests total in `Company.UiPath.DocumentOcr.Activities.Tests`).

## Current architecture

- `src/DocumentOcr.Core`
  Technology-independent Core contracts, models, validation, domain exceptions, and the `DocumentOcrService` orchestration layer.
- `src/DocumentOcr.Infrastructure`
  Home for PDF rendering, image preprocessing, and the local Tesseract OCR engine. Future phases add orchestration and trained-data expansion.
- `src/Company.UiPath.DocumentOcr.Activities`
  UiPath-facing activity layer. It remains thin, maps Studio arguments to Core options, composes Infrastructure implementations, and depends on Core and Infrastructure.
- `src/Company.UiPath.DocumentOcr.Activities.Packaging`
  Packaging scaffold only. It is deliberately non-packable until supported UiPath packaging conventions are confirmed.
- `tests/DocumentOcr.Core.Tests`
  Unit tests for the implemented Core behavior.
- `tests/DocumentOcr.Infrastructure.Tests`
  Unit and integration tests for PDF rendering, image preprocessing, OCR behavior, and the real orchestrated pipeline.
- `tests/Company.UiPath.DocumentOcr.Activities.Tests`
  Activity-facing tests for the UiPath public surface, ViewModel metadata/resources, deterministic workflow execution, real OCR workflow execution, and output asset inspection.

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

## Selected UiPath Activity libraries

- `System.Activities.ViewModels` `1.20260609.1`
- `UiPath.Activities.Api` `24.10.1`
- `UiPath.Workflow` `6.0.0-20240401-07`

These packages are confined to `Company.UiPath.DocumentOcr.Activities` and its tests. `DocumentOcr.Core` and `DocumentOcr.Infrastructure` do not depend on UiPath SDK packages.

## Phase boundaries

The repository still does not include:
- Final packaging or runtime-distribution work
- UiPath Studio installation/runtime validation

Those remain deferred to Phase 7 in the blueprint.

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
& 'C:\Program Files\dotnet\dotnet.exe' test tests\Company.UiPath.DocumentOcr.Activities.Tests\Company.UiPath.DocumentOcr.Activities.Tests.csproj --no-build --no-restore
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

## Orchestration service behavior

- Public API:
  - `DocumentOcrService.ExtractAsync(string? filePath, OcrOptions? options = null, CancellationToken cancellationToken = default)`
- Validation:
  - always runs through `DocumentValidator.Validate(...)` before any rendering or OCR work starts
- Document branching:
  - `.pdf`: renders lazily and sequentially through `IDocumentPageRenderer`
  - supported image extensions: opens the canonical file directly as page `1`
- Ownership:
  - raw renderer/output pages and processed pages are service-owned and disposed by the service
  - injected renderer, preprocessor, and OCR engine instances are borrowed and never disposed by the service
- Aggregation:
  - all per-page OCR results remain in the final `OcrResult.Pages`
  - only non-empty cleaned page texts participate in `OcrResult.Text`
  - non-empty page texts are joined with exactly `\n\n`
- Cancellation:
  - cancellation is cooperative at validation, image open, page iteration, preprocessing, OCR, and aggregation boundaries
  - the service preserves provider-level cancellation behavior, so an in-progress native render or OCR call may still complete before cancellation surfaces

## Toolchain note

The local machine currently has the .NET 10 SDK and runtime available. Core, Infrastructure, and Activity tests were verified successfully by using a process-local major roll-forward from the `net6.0` test target to the installed .NET 10 runtime.

Native execution on an exact .NET 6 runtime has not been verified yet because that runtime is not installed locally.

UiPath Studio installation/runtime is NOT TESTED in this phase. Installation and final native package validation belong to Phase 7.

## Next phase

The next planned phase is Phase 7 - packaging, Studio installation, and final runtime-distribution validation.
