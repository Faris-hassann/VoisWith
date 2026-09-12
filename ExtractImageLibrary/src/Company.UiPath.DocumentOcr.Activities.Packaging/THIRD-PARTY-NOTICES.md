# Third-Party Notices

This package contains or depends on third-party components used by the Document OCR UiPath activity.

Managed package dependencies:

- `System.Activities.ViewModels` `1.20260609.1`
- `PDFtoImage` `5.2.1`
- `SkiaSharp` `3.119.4`
- `BitMiracle.LibTiff.NET` `2.4.660`
- `Tesseract` `5.2.0`

Bundled runtime assets:

- `tessdata_fast` English trained data, distributed under the Apache License 2.0 by the upstream tessdata_fast project.
- Tesseract Windows native binaries from the `Tesseract` `5.2.0` NuGet package.
- Leptonica Windows native binaries from the `Tesseract` `5.2.0` NuGet package.

Native PDFium and Skia assets are supplied through the selected NuGet dependency graph, including the standard Windows RID assets from `PDFtoImage` and `SkiaSharp` dependencies.

No project-level license or copyright owner is asserted by this notice.
