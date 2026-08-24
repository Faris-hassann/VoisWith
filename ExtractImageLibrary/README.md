# Document OCR UiPath Activity

This repository contains a staged implementation of a UiPath custom activity that will eventually extract text from PDF and image documents.

Intended public activity name: `Extract Text From Document`

Current implementation phase: Phase 3 - PDF Rendering and Image Preprocessing

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

## Current architecture

- `src/DocumentOcr.Core`
  Technology-independent Core contracts, models, validation, and domain exceptions.
- `src/DocumentOcr.Infrastructure`
  Home for PDF rendering and image preprocessing. Future phases add Tesseract integration and trained data handling.
- `src/Company.UiPath.DocumentOcr.Activities`
  Future UiPath-facing activity layer. It remains thin and depends on Core and Infrastructure.
- `src/Company.UiPath.DocumentOcr.Activities.Packaging`
  Packaging scaffold only. It is deliberately non-packable until supported UiPath packaging conventions are confirmed.
- `tests/DocumentOcr.Core.Tests`
  Unit tests for the implemented Core behavior.
- `tests/DocumentOcr.Infrastructure.Tests`
  Unit tests for PDF rendering and image preprocessing behavior.
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

These packages remain confined to `DocumentOcr.Infrastructure`. `DocumentOcr.Core` still has no package references and no dependency on Infrastructure or native imaging/PDF libraries.

## Phase boundaries

The repository still does not include:
- Tesseract or other OCR engine integration
- `DocumentOcrService`
- UiPath activity implementation
- Trained data files
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
- The Windows test output includes `runtimes\win-x64\native\pdfium.dll` and `runtimes\win-x64\native\libSkiaSharp.dll`, alongside other RID-specific native assets from the selected packages.
- PDF rendering is Windows-first for Version 1, but package restore currently brings along Linux and macOS native assets as transitive runtime content as well.
- PDF rendering cancellation is cooperative around page boundaries. Cancellation can stop before the next render starts or after a render completes, but an in-progress native page render is not interruptible mid-call.

## Toolchain note

The local machine currently has the .NET 10 SDK and runtime available. Core and Infrastructure tests were verified successfully by using a process-local major roll-forward from the `net6.0` test target to the installed .NET 10 runtime.

Native execution on an exact .NET 6 runtime has not been verified yet because that runtime is not installed locally.

## Next phase

The next planned phase is Phase 4 - Tesseract OCR Engine.
