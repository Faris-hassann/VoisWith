# Document OCR UiPath Activity

This repository contains a staged implementation of a UiPath custom activity that will eventually extract text from PDF and image documents.

Intended public activity name: `Extract Text From Document`

Current implementation phase: Phase 2 - Core Domain, Contracts, Validation, and Unit Tests

Version 1 target:
- UiPath Studio Windows projects
- Windows-first delivery
- `net6.0`

## Verified status

Phase 1 verification is complete:
- Solution membership, project XML, and dependency graph verified.
- `dotnet restore` and `dotnet build` succeeded with `0` warnings and `0` errors.
- Packaging remains intentionally non-packable.

Phase 2 is now implemented:
- Provider-neutral Core models for options, page ownership, and OCR results.
- Core contracts for OCR, page rendering, and image preprocessing.
- Input validation for path, supported extensions, and maximum file size.
- Focused domain exceptions for unsupported files, file size limits, page limits, and processing failures.
- Deterministic xUnit coverage for Core invariants and validation behavior.

## Current architecture

- `src/DocumentOcr.Core`
  Technology-independent Core contracts, models, validation, and domain exceptions.
- `src/DocumentOcr.Infrastructure`
  Future home for PDF rendering, image preprocessing, Tesseract integration, and trained data handling.
- `src/Company.UiPath.DocumentOcr.Activities`
  Future UiPath-facing activity layer. It remains thin and depends on Core and Infrastructure.
- `src/Company.UiPath.DocumentOcr.Activities.Packaging`
  Packaging scaffold only. It is deliberately non-packable until supported UiPath packaging conventions are confirmed.
- `tests/DocumentOcr.Core.Tests`
  Unit tests for the implemented Core behavior.
- `tests/Company.UiPath.DocumentOcr.Activities.Tests`
  Placeholder for later activity-facing tests.

## Project reference direction

- `DocumentOcr.Infrastructure` -> `DocumentOcr.Core`
- `Company.UiPath.DocumentOcr.Activities` -> `DocumentOcr.Core`, `DocumentOcr.Infrastructure`
- `Company.UiPath.DocumentOcr.Activities.Packaging` -> `Company.UiPath.DocumentOcr.Activities`
- `DocumentOcr.Core.Tests` -> `DocumentOcr.Core`
- `Company.UiPath.DocumentOcr.Activities.Tests` -> `Company.UiPath.DocumentOcr.Activities`

## Phase boundaries

The repository still does not include:
- PDF rendering implementation
- Image preprocessing implementation
- Tesseract or other OCR engine integration
- `DocumentOcrService`
- UiPath activity implementation
- Trained data files
- Packaging or runtime dependency work

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

Run Core tests:

```powershell
$env:DOTNET_ROLL_FORWARD = 'Major'
& 'C:\Program Files\dotnet\dotnet.exe' test tests\DocumentOcr.Core.Tests\DocumentOcr.Core.Tests.csproj --no-build --no-restore
Remove-Item Env:DOTNET_ROLL_FORWARD
```

## Toolchain note

The local machine currently has the .NET 10 SDK and runtime available. Core tests were verified successfully by using a process-local major roll-forward from the `net6.0` test target to the installed .NET 10 runtime.

Native execution on an exact .NET 6 runtime has not been verified yet because that runtime is not installed locally.

## Next phase

The next planned phase is Phase 3 - PDF Rendering and Image Preprocessing.
