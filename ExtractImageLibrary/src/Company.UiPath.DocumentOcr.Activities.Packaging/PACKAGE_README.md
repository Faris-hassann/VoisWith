# Document OCR Activities for UiPath

This package provides the `Extract Text From Document` custom activity for UiPath Windows projects.

The activity extracts OCR text from local PDF and image documents using the repository's Core and Infrastructure assemblies. It bundles the pinned English `tessdata_fast` trained data and Windows x86/x64 Tesseract native binaries needed by the `Tesseract` managed wrapper.

Supported Phase 7 runtime target:

- UiPath Studio/Robot Windows projects
- .NET 6 activity target
- Windows x64 verified when recorded in the repository README
- Windows x86 packaged but not verified unless explicitly stated in the repository README
- Windows ARM64 out of scope

Security note: this package supports the bundled official `eng.traineddata` file. External TessData overrides must come from trusted operators only. The upstream Tesseract project has published crafted-traineddata advisories for versions before 5.5.3, while the compatible `charlesw/Tesseract` NuGet wrapper remains pinned at `5.2.0` for this phase.
