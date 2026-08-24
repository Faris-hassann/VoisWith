# UiPath Custom Activity — Document OCR with Tesseract

## Project Blueprint and Implementation Plan

**Project:** Custom UiPath activity for extracting text from PDF and image documents  
**Primary Target:** UiPath Studio — Windows projects  
**Core Technology:** C# / .NET + Tesseract OCR  
**Reference Prototype:** Node.js + Tesseract.js  
**Final Distribution:** UiPath-compatible NuGet activity package  
**Recommended Implementation Phases:** **8**

---

# 1. Project Goal

Build a professional UiPath custom activity that accepts a PDF or image file as input and extracts the text contained inside the document using Tesseract OCR.

The activity should eventually appear inside UiPath Studio as a normal drag-and-drop activity.

Example:

```text
Document OCR
────────────────────────────

File
[ FilePath                    ]

Language
[ English                  ▼ ]

Advanced
────────────────────────────
PDF Scale
[ 3                          ]

Maximum Pages
[ 50                         ]

────────────────────────────
Outputs

Text
→ ExtractedText

Page Count
→ PageCount

Confidence
→ Confidence
```

The desired processing flow is:

```text
PDF / Image
     │
     ▼
Validate file
     │
     ├── Image ───────────────────┐
     │                            │
     └── PDF → Render each page ──┤
                                  ▼
                         Image preprocessing
                                  │
                                  ▼
                           Tesseract OCR
                                  │
                                  ▼
                         Clean extracted text
                                  │
                                  ▼
              Text + confidence + page information
```

---

# 2. High-Level Requirements

The activity must:

- Accept a local PDF or image file.
- Validate that the file exists.
- Validate supported file types.
- Validate maximum file size.
- Support scanned PDFs.
- Convert PDF pages into images before OCR.
- Preprocess images before OCR.
- Use Tesseract as the OCR engine.
- Reuse the OCR engine efficiently where appropriate.
- Return extracted text.
- Return page count.
- Return average OCR confidence.
- Optionally return per-page results internally.
- Clean OCR text before returning it.
- Handle invalid or corrupt files cleanly.
- Enforce a maximum PDF page count.
- Provide meaningful exceptions.
- Be unit testable.
- Be packaged as a UiPath NuGet custom activity.
- Be installable through UiPath Studio Package Manager.

---

# 3. Version 1 Scope

Version 1 should deliberately remain focused.

## Included

- Windows-first support.
- PDF files.
- PNG.
- JPG / JPEG.
- WebP.
- BMP.
- TIFF / TIF.
- English OCR.
- Optional architecture for adding more languages.
- Scanned PDFs.
- Multi-page PDFs.
- Image preprocessing.
- Page limits.
- File size limits.
- Confidence output.
- Unit tests.
- UiPath packaging.

## Not Required in Version 1

- Cloud OCR.
- AI document understanding.
- Handwriting recognition guarantees.
- Table reconstruction.
- Form field extraction.
- Barcode extraction.
- Automatic document classification.
- Cross-platform guarantee.
- Studio Web guarantee.
- GPU acceleration.
- Parallel OCR of many pages.
- OCR of password-protected PDFs.
- OCR from URLs.
- OCR from streams directly in the UiPath activity.

These can be added later.

---

# 4. Node.js Reference Implementation

The Node.js implementation is used as the behavior reference before translating the project into C#/.NET.

## Required Node.js Version

Recommended:

```text
Node.js 20+
```

## Required Libraries

Install:

```bash
npm install tesseract.js sharp pdf-to-img
```

Responsibilities:

```text
tesseract.js
    OCR engine

sharp
    Image cleanup and preprocessing

pdf-to-img
    PDF → page images

Node.js fs/path
    File validation and handling
```

---

# 5. Node.js Prototype Folder Structure

```text
document-ocr/
│
├── package.json
├── package-lock.json
│
├── src/
│   └── ocr.js
│
└── samples/
    ├── invoice.pdf
    └── receipt.jpg
```

---

# 6. Node.js package.json

```json
{
  "name": "document-ocr",
  "version": "1.0.0",
  "description": "Extract text from PDF and image files using Tesseract OCR",
  "type": "module",
  "private": true,
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "ocr": "node src/ocr.js"
  },
  "dependencies": {
    "pdf-to-img": "latest",
    "sharp": "latest",
    "tesseract.js": "latest"
  }
}
```

For production, exact tested dependency versions should be pinned instead of using `latest`.

---

# 7. Node.js Reference Code

Create:

```text
src/ocr.js
```

```javascript
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createWorker } from "tesseract.js";
import sharp from "sharp";
import { pdf } from "pdf-to-img";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff"
]);

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ...SUPPORTED_IMAGE_EXTENSIONS
]);

const DEFAULT_OPTIONS = {
  languages: ["eng"],
  pdfScale: 3,
  maxPages: 50,
  maxFileSizeMb: 50
};

function cleanText(text) {
  if (!text) {
    return "";
  }

  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function validateFile(filePath, maxFileSizeMb) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("A valid file path is required.");
  }

  const resolvedPath = path.resolve(filePath);

  try {
    await access(resolvedPath);
  } catch {
    throw new Error(`File does not exist: ${resolvedPath}`);
  }

  const fileInfo = await stat(resolvedPath);

  if (!fileInfo.isFile()) {
    throw new Error("The provided path is not a file.");
  }

  const extension = path.extname(resolvedPath).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported file type: ${extension}. ` +
      `Supported types: ${[...SUPPORTED_EXTENSIONS].join(", ")}`
    );
  }

  const fileSizeMb = fileInfo.size / (1024 * 1024);

  if (fileSizeMb > maxFileSizeMb) {
    throw new Error(
      `File exceeds the maximum allowed size of ${maxFileSizeMb} MB.`
    );
  }

  return {
    resolvedPath,
    extension,
    fileSizeMb
  };
}

async function preprocessImage(imageBuffer) {
  return sharp(imageBuffer, {
    failOn: "none"
  })
    .rotate()
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

async function* getDocumentPages(
  filePath,
  extension,
  pdfScale,
  maxPages
) {
  if (extension !== ".pdf") {
    const imageBuffer = await readFile(filePath);

    yield {
      pageNumber: 1,
      buffer: imageBuffer
    };

    return;
  }

  const document = await pdf(filePath, {
    scale: pdfScale
  });

  let pageNumber = 0;

  for await (const imageBuffer of document) {
    pageNumber++;

    if (pageNumber > maxPages) {
      throw new Error(
        `PDF contains more than the allowed ${maxPages} pages.`
      );
    }

    yield {
      pageNumber,
      buffer: Buffer.from(imageBuffer)
    };
  }
}

export async function extractTextFromDocument(
  filePath,
  options = {}
) {
  const settings = {
    ...DEFAULT_OPTIONS,
    ...options
  };

  const file = await validateFile(
    filePath,
    settings.maxFileSizeMb
  );

  const languages = Array.isArray(settings.languages)
    ? settings.languages
    : [settings.languages];

  const worker = await createWorker(languages);

  const pages = [];

  try {
    for await (
      const page of getDocumentPages(
        file.resolvedPath,
        file.extension,
        settings.pdfScale,
        settings.maxPages
      )
    ) {
      const processedImage = await preprocessImage(
        page.buffer
      );

      const result = await worker.recognize(
        processedImage,
        {
          rotateAuto: true
        }
      );

      const pageText = cleanText(result.data.text);

      pages.push({
        pageNumber: page.pageNumber,
        text: pageText,
        confidence: Number(
          result.data.confidence.toFixed(2)
        )
      });
    }
  } finally {
    await worker.terminate();
  }

  const text = pages
    .map((page) => page.text)
    .filter(Boolean)
    .join("\n\n");

  const averageConfidence =
    pages.length === 0
      ? 0
      : pages.reduce(
          (sum, page) => sum + page.confidence,
          0
        ) / pages.length;

  return {
    success: true,

    file: {
      path: file.resolvedPath,
      extension: file.extension,
      sizeMb: Number(file.fileSizeMb.toFixed(2))
    },

    language: languages,

    pageCount: pages.length,

    averageConfidence: Number(
      averageConfidence.toFixed(2)
    ),

    text,

    pages
  };
}

const currentFile = fileURLToPath(import.meta.url);
const executedFile = process.argv[1]
  ? path.resolve(process.argv[1])
  : null;

if (executedFile === currentFile) {
  const inputFile = process.argv[2];

  if (!inputFile) {
    console.error(
      "Usage: node src/ocr.js <file-path> [language]"
    );

    process.exitCode = 1;
  } else {
    const language = process.argv[3] ?? "eng";

    try {
      const result = await extractTextFromDocument(
        inputFile,
        {
          languages: [language]
        }
      );

      console.log(
        JSON.stringify(result, null, 2)
      );
    } catch (error) {
      console.error("OCR failed:");
      console.error(error.message);

      process.exitCode = 1;
    }
  }
}
```

---

# 8. Expected Node.js Output

Example:

```json
{
  "success": true,
  "file": {
    "path": "C:\\OCR\\samples\\invoice.pdf",
    "extension": ".pdf",
    "sizeMb": 1.42
  },
  "language": [
    "eng"
  ],
  "pageCount": 2,
  "averageConfidence": 94.73,
  "text": "INVOICE\nInvoice Number: 12345\nCustomer: John Smith...",
  "pages": [
    {
      "pageNumber": 1,
      "text": "INVOICE\nInvoice Number: 12345...",
      "confidence": 96.21
    },
    {
      "pageNumber": 2,
      "text": "Terms and Conditions...",
      "confidence": 93.25
    }
  ]
}
```

---

# 9. How the OCR Pipeline Works

## 9.1 Validation

Before doing OCR:

```text
Input path
   ↓
Exists?
   ↓
Is a file?
   ↓
Supported extension?
   ↓
Within maximum file size?
   ↓
Continue
```

This prevents unnecessary OCR initialization when the input is invalid.

---

## 9.2 PDF Processing

Tesseract operates on images.

Therefore:

```text
PDF
 ↓
PDF renderer
 ↓
Page 1 image
Page 2 image
Page 3 image
 ↓
OCR
```

Each page should be processed independently.

---

## 9.3 Streaming Pages

Do not convert a large PDF into every page image and hold all images in memory.

Preferred:

```text
Page 1 → preprocess → OCR → result
Page 2 → preprocess → OCR → result
Page 3 → preprocess → OCR → result
...
```

This keeps memory usage under control.

---

## 9.4 Image Preprocessing

Before OCR:

```text
Image
 ↓
Fix orientation
 ↓
Grayscale
 ↓
Normalize contrast
 ↓
Sharpen
 ↓
Convert to consistent image format
 ↓
Tesseract
```

This helps provide Tesseract with a more consistent source image.

---

## 9.5 OCR Worker Reuse

Do not initialize Tesseract for every page.

Preferred:

```text
Create Tesseract engine

Page 1 → recognize
Page 2 → recognize
Page 3 → recognize

Dispose Tesseract engine
```

This reduces unnecessary initialization overhead.

---

# 10. Final C# / .NET Architecture

The .NET implementation must not become one large class.

Use separation of concerns.

Recommended solution:

```text
DocumentOcr.UiPath/
│
├── DocumentOcr.UiPath.sln
│
├── src/
│   │
│   ├── DocumentOcr.Core/
│   │   │
│   │   ├── Abstractions/
│   │   │   ├── IOcrEngine.cs
│   │   │   ├── IDocumentPageRenderer.cs
│   │   │   └── IImagePreprocessor.cs
│   │   │
│   │   ├── Models/
│   │   │   ├── OcrOptions.cs
│   │   │   ├── OcrResult.cs
│   │   │   └── OcrPageResult.cs
│   │   │
│   │   ├── Services/
│   │   │   └── DocumentOcrService.cs
│   │   │
│   │   ├── Validation/
│   │   │   └── DocumentValidator.cs
│   │   │
│   │   ├── Exceptions/
│   │   │   ├── UnsupportedDocumentException.cs
│   │   │   └── OcrProcessingException.cs
│   │   │
│   │   └── DocumentOcr.Core.csproj
│   │
│   │
│   ├── DocumentOcr.Infrastructure/
│   │   │
│   │   ├── Ocr/
│   │   │   └── TesseractOcrEngine.cs
│   │   │
│   │   ├── Pdf/
│   │   │   └── PdfPageRenderer.cs
│   │   │
│   │   ├── Imaging/
│   │   │   └── ImagePreprocessor.cs
│   │   │
│   │   ├── TessData/
│   │   │   └── eng.traineddata
│   │   │
│   │   └── DocumentOcr.Infrastructure.csproj
│   │
│   │
│   ├── Company.UiPath.DocumentOcr.Activities/
│   │   │
│   │   ├── Activities/
│   │   │   └── ExtractTextFromDocument.cs
│   │   │
│   │   ├── ViewModels/
│   │   │   └── ExtractTextFromDocumentViewModel.cs
│   │   │
│   │   ├── Resources/
│   │   │   ├── Resources.resx
│   │   │   └── Icons/
│   │   │       └── document-ocr.svg
│   │   │
│   │   └── Company.UiPath.DocumentOcr.Activities.csproj
│   │
│   └── Company.UiPath.DocumentOcr.Activities.Packaging/
│       │
│       └── Company.UiPath.DocumentOcr.Activities.Packaging.csproj
│
├── tests/
│   │
│   ├── DocumentOcr.Core.Tests/
│   │   ├── DocumentValidatorTests.cs
│   │   └── DocumentOcrServiceTests.cs
│   │
│   ├── Company.UiPath.DocumentOcr.Activities.Tests/
│   │   └── ExtractTextFromDocumentTests.cs
│   │
│   └── Fixtures/
│       ├── Images/
│       │   ├── clean-text.png
│       │   ├── rotated-text.jpg
│       │   └── low-contrast.png
│       │
│       └── Pdf/
│           ├── one-page.pdf
│           └── multi-page.pdf
│
├── docs/
│   ├── architecture.md
│   └── usage.md
│
├── Directory.Build.props
├── README.md
└── .gitignore
```

---

# 11. Architectural Responsibilities

## DocumentOcr.Core

Contains logic that should not depend directly on UiPath.

Responsibilities:

- Models.
- Contracts/interfaces.
- Validation rules.
- OCR workflow orchestration.
- Domain exceptions.

It should know that OCR exists, but it should not care whether Tesseract, another OCR engine, or a mock implementation performs OCR.

---

## DocumentOcr.Infrastructure

Contains technology-specific implementations.

Responsibilities:

- Tesseract integration.
- PDF rendering.
- Image processing.
- TessData.
- Native dependencies.

Examples:

```text
IOcrEngine
    ↓ implemented by
TesseractOcrEngine

IDocumentPageRenderer
    ↓ implemented by
PdfPageRenderer

IImagePreprocessor
    ↓ implemented by
ImagePreprocessor
```

---

## UiPath Activities Project

Contains the activity exposed to UiPath Studio.

It should remain thin.

```text
UiPath Inputs
     ↓
ExtractTextFromDocument
     ↓
DocumentOcrService
     ↓
UiPath Outputs
```

The activity should not contain the entire OCR implementation.

---

## Packaging Project

Produces the final NuGet package.

Example output:

```text
Company.UiPath.DocumentOcr.Activities.1.0.0.nupkg
```

---

# 12. Suggested .NET Libraries

These should be validated against the actual UiPath target framework and packaging behavior during implementation.

## OCR

Candidate:

```text
Tesseract
```

Common .NET wrapper:

```text
charlesw/Tesseract
```

Purpose:

- Load trained data.
- Recognize image text.
- Return text.
- Return confidence.

---

## PDF Rendering

Candidate:

```text
PDFtoImage
```

Purpose:

```text
PDF page
   ↓
SkiaSharp image
   ↓
byte[] / stream
```

---

## Image Processing

Candidate:

```text
SkiaSharp
```

Purpose:

- Decode images.
- Normalize format.
- Resize if required.
- Grayscale.
- Adjust image before OCR.

Actual preprocessing functionality must be verified and implemented carefully.

---

# 13. Node.js → C# Mapping

```text
NODE.JS                     C# / .NET

ocr.js
   ↓
DocumentOcrService.cs


tesseract.js
   ↓
Tesseract .NET wrapper


pdf-to-img
   ↓
PDFtoImage


sharp
   ↓
SkiaSharp / image processing


Buffer
   ↓
byte[] / Stream


async generator
   ↓
IAsyncEnumerable<T>


Error
   ↓
Exception


object
   ↓
strongly typed C# class


languages
   ↓
OcrOptions.Languages


result.data.text
   ↓
OcrPageResult.Text


result.data.confidence
   ↓
OcrPageResult.Confidence
```

---

# 14. Core Models

Recommended model design.

## OcrOptions

Possible properties:

```text
Languages
PdfScale
MaximumPages
MaximumFileSizeMb
EnableAutoRotate
EnablePreprocessing
```

Recommended defaults:

```text
Languages = ["eng"]
PdfScale = 3
MaximumPages = 50
MaximumFileSizeMb = 50
EnableAutoRotate = true
EnablePreprocessing = true
```

---

## OcrPageResult

```text
PageNumber
Text
Confidence
```

---

## OcrResult

```text
Success
Text
PageCount
AverageConfidence
Pages
```

---

# 15. Core Interfaces

## IOcrEngine

Purpose:

```text
processed image
      ↓
    OCR
      ↓
text + confidence
```

Conceptually:

```csharp
public interface IOcrEngine
{
    Task<OcrPageResult> RecognizeAsync(
        Stream image,
        int pageNumber,
        OcrOptions options,
        CancellationToken cancellationToken = default);
}
```

---

## IDocumentPageRenderer

Purpose:

```text
PDF
 ↓
page stream
 ↓
page stream
 ↓
page stream
```

Conceptually:

```csharp
public interface IDocumentPageRenderer
{
    IAsyncEnumerable<DocumentPage> RenderAsync(
        string filePath,
        OcrOptions options,
        CancellationToken cancellationToken = default);
}
```

---

## IImagePreprocessor

Purpose:

```text
source image
      ↓
processed image
```

Conceptually:

```csharp
public interface IImagePreprocessor
{
    Task<Stream> ProcessAsync(
        Stream image,
        CancellationToken cancellationToken = default);
}
```

---

# 16. DocumentOcrService

This is the main orchestration service.

Flow:

```text
ExtractAsync(file)
       ↓
Validate file
       ↓
Determine document type
       ↓
Image?
 ├── yes → one document page
 │
 └── no → PDF renderer
              ↓
        enumerate pages
              ↓
        preprocess page
              ↓
           OCR page
              ↓
        collect result
              ↓
       combine page text
              ↓
      average confidence
              ↓
          OcrResult
```

The service should own workflow decisions.

Infrastructure classes should only perform their specific technical jobs.

---

# 17. File Validation

The validator must check:

```text
✓ FilePath is not empty
✓ File exists
✓ Path points to a file
✓ Extension is supported
✓ Size does not exceed configured maximum
✓ PDF page limit is enforced during rendering
```

Supported extensions in v1:

```text
.pdf
.png
.jpg
.jpeg
.webp
.bmp
.tif
.tiff
```

Recommended custom exceptions:

```text
UnsupportedDocumentException
OcrProcessingException
DocumentTooLargeException
DocumentPageLimitExceededException
```

Whether separate classes are needed for all cases can be decided during implementation.

---

# 18. TessData

The .NET solution needs Tesseract language data.

Version 1:

```text
TessData/
└── eng.traineddata
```

Future:

```text
TessData/
├── eng.traineddata
├── ara.traineddata
├── fra.traineddata
└── deu.traineddata
```

Do not assume language files are available globally on the UiPath Robot machine.

The package should provide a predictable strategy for locating required trained data.

---

# 19. UiPath Activity Design

Recommended activity name:

```text
Extract Text From Document
```

Recommended category:

```text
Document OCR
```

Suggested UiPath inputs:

```text
FilePath
Language
PdfScale
MaximumPages
MaximumFileSizeMb
EnablePreprocessing
```

Suggested outputs:

```text
ExtractedText
PageCount
Confidence
```

Optional advanced output for later:

```text
PageResults
```

Version 1 can keep the public output simple.

---

# 20. Conceptual UiPath Activity Properties

Final implementation depends on the current UiPath custom activity template.

Conceptually:

```csharp
[RequiredArgument]
public InArgument<string> FilePath { get; set; }

public InArgument<string> Language { get; set; }

public InArgument<int> PdfScale { get; set; }

public InArgument<int> MaximumPages { get; set; }

public OutArgument<string> ExtractedText { get; set; }

public OutArgument<int> PageCount { get; set; }

public OutArgument<double> Confidence { get; set; }
```

The actual base type, metadata registration, and implementation style must follow the UiPath template version used when the project is created.

Do not blindly copy outdated examples.

---

# 21. ViewModel

Create:

```text
ExtractTextFromDocumentViewModel.cs
```

Responsibilities:

- Display activity properties properly.
- Organize input/output sections.
- Provide friendly labels.
- Provide descriptions/tooltips.
- Define default values where appropriate.
- Keep advanced options separate from main properties when possible.

The UiPath activity should feel like a native UiPath activity.

---

# 22. Error Handling Requirements

Failures must produce useful information.

Bad:

```text
OCR failed
```

Better:

```text
Unable to process document because the file type '.docx' is unsupported.
```

Better:

```text
Unable to render PDF page 4.
```

Better:

```text
Tesseract language data for 'eng' could not be found.
```

Errors should preserve the underlying exception where useful.

Do not swallow errors silently.

---

# 23. Resource Handling

Every stream/native resource must be disposed correctly.

Examples:

```text
PDF handles
Image buffers
SkiaSharp objects
Streams
Tesseract engine
Pix instances
```

Use:

```text
using
await using
try/finally
IDisposable
IAsyncDisposable
```

where appropriate.

Resource cleanup is especially important for UiPath Robots that may repeatedly run the activity.

---

# 24. Performance Requirements

Version 1 should prioritize reliability over maximum throughput.

Recommended behavior:

```text
PDF pages processed sequentially
```

Reason:

- Lower RAM usage.
- Easier native dependency control.
- Tesseract instances can be expensive.
- Simpler failure behavior.
- Better first release.

Parallel OCR can be evaluated later.

---

# 25. Security Requirements

The activity handles local documents.

Required precautions:

- Never upload document contents anywhere.
- Do not log extracted document text by default.
- Do not log raw image contents.
- Avoid leaving temporary page images on disk if possible.
- If temporary files are unavoidable, delete them reliably.
- Validate all user-supplied paths.
- Do not execute files.
- Do not trust file extensions alone if a library can validate/decode actual contents.

---

# 26. Test Matrix

At minimum:

## Image Tests

```text
✓ clean-text.png
✓ receipt.jpg
✓ rotated-text.jpg
✓ low-contrast.png
✓ blank image
```

## PDF Tests

```text
✓ one-page scanned PDF
✓ multi-page scanned PDF
✓ PDF containing blank page
✓ PDF exceeding maximum page count
```

## Failure Tests

```text
✓ missing file
✓ directory passed instead of file
✓ unsupported extension
✓ corrupted image
✓ corrupted PDF
✓ file larger than configured maximum
✓ missing TessData
✓ unsupported language
```

## Output Tests

```text
✓ PageCount is correct
✓ ExtractedText contains expected words
✓ Confidence is within expected valid range
✓ Multiple pages are combined in correct order
✓ Blank pages do not destroy surrounding results
```

---

# 27. Acceptance Criteria for Version 1

The project is complete only when:

```text
[ ] Solution builds cleanly.

[ ] Node.js behavior has been mapped correctly to C#.

[ ] PNG OCR works.

[ ] JPG OCR works.

[ ] TIFF OCR works if included in supported formats.

[ ] Single-page PDF OCR works.

[ ] Multi-page PDF OCR works.

[ ] Scanned PDF OCR works.

[ ] File validation works.

[ ] Maximum file size works.

[ ] Maximum page count works.

[ ] Image preprocessing works.

[ ] Tesseract language data loads reliably.

[ ] Text is returned correctly.

[ ] Page count is returned correctly.

[ ] Confidence is returned correctly.

[ ] Invalid inputs produce clear errors.

[ ] Resources are disposed correctly.

[ ] Core unit tests pass.

[ ] Activity tests pass.

[ ] NuGet package builds.

[ ] Package installs in UiPath Studio.

[ ] Activity appears in Activities panel.

[ ] Activity can be dragged into a workflow.

[ ] Activity successfully processes a sample PDF from UiPath.

[ ] Activity successfully processes a sample image from UiPath.

[ ] Documentation explains installation and usage.
```

---

# 28. Implementation Strategy

The project should be built in **8 phases**.

Why 8?

Because the solution contains four different concerns:

```text
Core architecture
Technical OCR infrastructure
UiPath integration
Packaging + verification
```

Trying to build everything in one pass increases the chance of:

- dependency mistakes,
- UiPath packaging problems,
- native runtime problems,
- hard-to-test OCR code,
- mixed responsibilities,
- debugging difficulty.

Each phase must:

```text
1. Inspect existing repository state.
2. Plan the phase.
3. Explain the plan briefly.
4. Implement the phase.
5. Build or test the affected code.
6. Fix errors found.
7. Summarize what changed.
8. State any remaining risks.
```

---

# 29. Phase 1 — Repository, Solution and Architecture

## Goal

Create the solution from scratch using the final architecture.

Do not implement OCR behavior yet.

Create:

```text
DocumentOcr.UiPath.sln

DocumentOcr.Core
DocumentOcr.Infrastructure
Company.UiPath.DocumentOcr.Activities
Company.UiPath.DocumentOcr.Activities.Packaging

tests projects
docs folders
fixture folders
```

Also configure:

- project references,
- target frameworks,
- nullable reference types,
- implicit usings if appropriate,
- common build properties,
- naming conventions,
- initial README.

## Phase 1 Prompt

```text
You are implementing Phase 1 of a professional UiPath custom activity project called Document OCR.

The final goal is to build a UiPath activity called "Extract Text From Document" that accepts PDF/image files and extracts text using Tesseract OCR.

IMPORTANT WORKFLOW:
1. First inspect the entire repository and existing files.
2. Do not immediately write code.
3. Produce a concise implementation plan for this phase based on the actual repository state.
4. Then execute the plan fully.
5. Build the affected solution/projects.
6. Fix any build/configuration errors caused by your changes.
7. At the end, summarize exactly what was created, changed, tested, and any remaining risks.

PHASE 1 SCOPE:
Create the complete solution/repository structure only. Do not implement OCR yet.

Target architecture:

DocumentOcr.UiPath/
├── DocumentOcr.UiPath.sln
├── src/
│   ├── DocumentOcr.Core/
│   │   ├── Abstractions/
│   │   ├── Models/
│   │   ├── Services/
│   │   ├── Validation/
│   │   └── Exceptions/
│   ├── DocumentOcr.Infrastructure/
│   │   ├── Ocr/
│   │   ├── Pdf/
│   │   ├── Imaging/
│   │   └── TessData/
│   ├── Company.UiPath.DocumentOcr.Activities/
│   │   ├── Activities/
│   │   ├── ViewModels/
│   │   └── Resources/
│   └── Company.UiPath.DocumentOcr.Activities.Packaging/
├── tests/
│   ├── DocumentOcr.Core.Tests/
│   ├── Company.UiPath.DocumentOcr.Activities.Tests/
│   └── Fixtures/
└── docs/

Requirements:
- Use the current UiPath custom activity template/project conventions where applicable.
- Target UiPath Windows projects first.
- Keep Core independent from UiPath.
- Infrastructure may depend on Core.
- UiPath Activities may depend on Core and Infrastructure.
- Packaging must package the activity and required dependencies.
- Add appropriate .gitignore and shared build settings.
- Enable nullable reference types where appropriate.
- Do not add unnecessary dependencies.
- Do not implement fake OCR code.
- Do not add placeholder production behavior that could hide missing implementation.

Acceptance criteria:
- The solution structure exists.
- Project references are correct.
- Projects restore/build as far as their intentionally empty state allows.
- No circular dependencies exist.
- README explains the architecture briefly.

Plan first, then implement.
```

---

# 30. Phase 2 — Core Domain, Models and Validation

## Goal

Implement all technology-independent OCR contracts and models.

Create:

```text
IOcrEngine
IDocumentPageRenderer
IImagePreprocessor

OcrOptions
OcrResult
OcrPageResult
DocumentPage

DocumentValidator

custom exceptions
```

Write validation unit tests.

## Phase 2 Prompt

```text
You are implementing Phase 2 of the Document OCR UiPath custom activity project.

FIRST:
- Inspect the repository and Phase 1 implementation.
- Read the current architecture before making changes.
- Produce a concise plan.
- Then implement the plan completely.
- Build and run all relevant tests.
- Fix failures introduced by this phase.

PHASE 2 GOAL:
Implement the technology-independent Core layer.

Create or complete:

Abstractions:
- IOcrEngine
- IDocumentPageRenderer
- IImagePreprocessor

Models:
- OcrOptions
- OcrResult
- OcrPageResult
- DocumentPage or equivalent

Validation:
- DocumentValidator

Exceptions:
- UnsupportedDocumentException
- OcrProcessingException
- Additional focused validation exceptions only where they improve clarity.

Functional requirements:
- Supported extensions:
  .pdf
  .png
  .jpg
  .jpeg
  .webp
  .bmp
  .tif
  .tiff
- Default language: eng
- Default PDF scale: 3
- Default maximum pages: 50
- Default maximum file size: 50 MB
- Validate missing/empty paths.
- Validate file existence.
- Validate path points to a file.
- Validate supported extension.
- Validate file size.
- Keep PDF page count enforcement available to the renderer/orchestrator.
- Avoid UiPath references inside Core.
- Avoid Tesseract/PDFtoImage/SkiaSharp references inside Core.
- Models should be strongly typed.
- Public APIs should have useful XML documentation.
- Use CancellationToken where asynchronous operations can be cancelled.

Testing:
Add unit tests for:
- valid file
- missing file
- unsupported file
- oversized file
- option defaults
- invalid option values where appropriate

Do not implement the Tesseract engine yet.
Do not implement PDF rendering yet.
Do not implement the UiPath activity yet.

Plan first, then implement.
```

---

# 31. Phase 3 — PDF Rendering and Image Preprocessing

## Goal

Implement document-to-image handling.

Create:

```text
PdfPageRenderer
ImagePreprocessor
```

Use carefully selected .NET dependencies.

Requirements:

- Render PDFs page by page.
- Avoid loading all pages into memory.
- Enforce MaximumPages.
- Decode supported image formats.
- Normalize image format.
- Apply safe preprocessing.
- Dispose all native resources.

## Phase 3 Prompt

```text
You are implementing Phase 3 of the Document OCR UiPath custom activity project.

FIRST:
1. Inspect the existing repository.
2. Review Core contracts and tests.
3. Check the target framework and current package dependencies.
4. Produce a concise implementation plan.
5. Then execute it.
6. Build and run all relevant tests.
7. Fix all issues introduced by the phase.

PHASE 3 GOAL:
Implement PDF page rendering and image preprocessing in DocumentOcr.Infrastructure.

Implement:
- PdfPageRenderer : IDocumentPageRenderer
- ImagePreprocessor : IImagePreprocessor

Preferred dependency candidates:
- PDFtoImage for PDF rendering
- SkiaSharp for image processing

However:
- Verify package/framework compatibility with the current project before committing.
- Do not blindly install an incompatible version.
- Keep all PDF/image-specific dependencies out of DocumentOcr.Core.

PDF requirements:
- Accept local PDF path.
- Render pages sequentially.
- Return pages in correct order.
- Do not hold every rendered page in memory simultaneously.
- Enforce OcrOptions.MaximumPages.
- Use OcrOptions.PdfScale.
- Fail with clear exceptions for corrupted/unreadable PDFs.
- Dispose native resources correctly.

Image preprocessing requirements:
- Accept page/image data from the processing pipeline.
- Correct orientation where technically supported.
- Convert to grayscale where beneficial.
- Normalize or improve contrast where safely supported.
- Apply conservative sharpening if available and useful.
- Produce a consistent format suitable for Tesseract.
- Avoid destructive transformations.
- Do not write temporary images to disk unless unavoidable.
- If temporary files are required, guarantee cleanup.

Testing:
- one-page PDF
- multi-page PDF
- corrupted PDF
- maximum page count
- clean image
- rotated image where testable
- low-contrast image
- resource disposal

Do not implement OCR recognition yet.
Do not implement UiPath activity logic yet.

Plan first, then implement.
```

---

# 32. Phase 4 — Tesseract OCR Engine

## Goal

Implement:

```text
TesseractOcrEngine
```

Responsibilities:

- Load Tesseract.
- Locate trained data.
- Recognize page images.
- Return text.
- Return confidence.
- Support language configuration.
- Handle missing language files.
- Dispose resources.

## Phase 4 Prompt

```text
You are implementing Phase 4 of the Document OCR UiPath custom activity project.

FIRST:
- Inspect the repository.
- Review the Core contracts and Infrastructure implementation.
- Review the actual target framework and runtime.
- Produce a concise implementation plan.
- Then implement it fully.
- Build and run all relevant tests.
- Fix failures introduced by your work.

PHASE 4 GOAL:
Implement the Tesseract OCR infrastructure.

Implement:
- TesseractOcrEngine : IOcrEngine
- TessData discovery/loading strategy
- English trained data support for v1

Use a suitable current .NET Tesseract wrapper compatible with the target project.

Requirements:
- OCR must run locally.
- No cloud APIs.
- No document contents may be uploaded externally.
- Use language code "eng" by default.
- Design language handling so ara/fra/etc. can be added later.
- Recognize processed page images.
- Return:
  - page number
  - extracted text
  - confidence
- Normalize confidence into a clear documented range.
- Cleanly handle missing traineddata.
- Cleanly handle Tesseract initialization failure.
- Cleanly handle corrupt/unreadable page images.
- Dispose Tesseract/Pix/native resources correctly.
- Do not create a new expensive engine unnecessarily for every tiny operation if reuse within the service lifetime is safe.
- Do not introduce unsafe global mutable OCR state.
- Preserve thread-safety assumptions explicitly in code/documentation.

Text cleanup:
Do not aggressively rewrite OCR output in the engine.
Only perform minimal engine-level normalization.
Higher-level text cleanup belongs in the orchestration/service layer.

Testing:
- simple English image
- blank image
- missing traineddata
- invalid language
- valid confidence range
- repeated OCR calls
- resource cleanup

Do not implement the UiPath wrapper yet.

Plan first, then implement.
```

---

# 33. Phase 5 — Complete OCR Orchestration Service

## Goal

Implement:

```text
DocumentOcrService
```

This connects:

```text
validation
→ rendering
→ preprocessing
→ OCR
→ text cleanup
→ final result
```

## Phase 5 Prompt

```text
You are implementing Phase 5 of the Document OCR UiPath custom activity project.

FIRST:
1. Inspect all existing implementation from Phases 1-4.
2. Review contracts and current test coverage.
3. Produce a concise plan.
4. Then execute it.
5. Run all affected tests.
6. Fix failures.
7. Summarize completed behavior and remaining risks.

PHASE 5 GOAL:
Implement the complete technology-independent OCR workflow through DocumentOcrService.

Implement:
- DocumentOcrService
- any small internal helpers needed for text cleanup or page aggregation

Required flow:

Input file
→ validate
→ determine PDF vs image
→ obtain pages
→ preprocess each page
→ OCR each page
→ clean page text
→ preserve page order
→ combine page text
→ calculate average confidence
→ return OcrResult

Requirements:
- Image files are treated as one page.
- PDFs are processed page by page.
- Avoid loading every PDF page into memory.
- Respect CancellationToken.
- Respect MaximumPages.
- Respect MaximumFileSizeMb.
- Respect Language(s).
- Respect PdfScale.
- If preprocessing is configurable, respect EnablePreprocessing.
- Ensure page results remain ordered.
- Combine non-empty page text with sensible blank-line separation.
- Do not destroy legitimate paragraph/newline structure.
- Average confidence must be calculated deterministically.
- Blank pages must not cause failure.
- Exceptions should retain useful context such as page number.
- Do not log extracted text.

Testing:
- image end-to-end through service using real infrastructure where practical
- multi-page PDF
- blank page
- page ordering
- average confidence
- text aggregation
- cancellation
- validation failure propagation
- OCR failure on a specific page
- maximum page limit

After this phase, the OCR engine should work independently of UiPath.

Do not build the UiPath activity UI yet.

Plan first, then implement.
```

---

# 34. Phase 6 — UiPath Custom Activity and ViewModel

## Goal

Expose the working OCR service as a real UiPath activity.

Create:

```text
ExtractTextFromDocument.cs
ExtractTextFromDocumentViewModel.cs
Resources
Icon
metadata
```

## Phase 6 Prompt

```text
You are implementing Phase 6 of the Document OCR UiPath custom activity project.

FIRST:
- Inspect the current working OCR service.
- Inspect the UiPath activity project generated in Phase 1.
- Verify the current UiPath SDK/template conventions used by the repository.
- Do not copy outdated UiPath examples if they conflict with the installed/current template.
- Produce a concise plan.
- Then implement it completely.
- Build and run relevant tests.

PHASE 6 GOAL:
Create the actual UiPath custom activity "Extract Text From Document".

Public activity name:
Extract Text From Document

Category:
Document OCR

Main inputs:
- FilePath (required)
- Language (default eng)

Advanced inputs:
- PdfScale (default 3)
- MaximumPages (default 50)
- MaximumFileSizeMb (default 50)
- EnablePreprocessing (default true)

Outputs:
- ExtractedText
- PageCount
- Confidence

Requirements:
- Use the current UiPath custom activity SDK/template conventions in the repository.
- Keep UiPath wrapper logic thin.
- Delegate OCR work to DocumentOcrService.
- Provide user-friendly display names.
- Provide useful descriptions/tooltips.
- Mark FilePath as required.
- Apply safe defaults.
- Map exceptions into understandable UiPath execution errors without hiding the original cause.
- Do not expose unnecessary internal types in v1.
- Do not log the extracted text.
- Support cancellation if the UiPath SDK pattern supports it.
- Add an appropriate activity icon.
- Configure the ViewModel so properties are organized clearly.
- Ensure the activity feels native inside UiPath Studio.

Testing:
- activity property defaults
- required argument behavior
- input mapping
- output mapping
- service failure propagation
- successful image OCR through the activity
- successful PDF OCR through the activity where test framework allows

Acceptance criteria:
- Activities project builds.
- Activity metadata loads.
- ViewModel compiles.
- No Core logic has been duplicated into the activity.

Plan first, then implement.
```

---

# 35. Phase 7 — Packaging, Native Dependencies and UiPath Installation

## Goal

Produce a valid installable UiPath NuGet package.

This is one of the most important phases because Tesseract and PDF rendering may include native dependencies.

## Phase 7 Prompt

```text
You are implementing Phase 7 of the Document OCR UiPath custom activity project.

FIRST:
1. Inspect all project files and package references.
2. Inspect the packaging project.
3. Identify every managed and native runtime dependency required by:
   - Tesseract
   - PDF rendering
   - image processing
   - UiPath activity
4. Produce a concise packaging plan.
5. Then execute it.
6. Build the NuGet package.
7. Inspect the produced .nupkg contents.
8. Fix missing/duplicate/runtime dependency issues.

PHASE 7 GOAL:
Produce a reliable UiPath-installable NuGet package.

Requirements:
- Package the UiPath activity.
- Include required managed dependencies.
- Include required native runtime dependencies.
- Include required TessData files or provide a guaranteed package-relative lookup strategy.
- Ensure eng.traineddata can be found at runtime.
- Ensure dependencies required by the activity project are also represented correctly in the packaging project where UiPath requires this.
- Do not depend on developer-machine absolute paths.
- Do not assume Tesseract is separately installed on the robot unless the architecture explicitly requires it.
- Do not silently require manual copying of DLLs.
- Package version should start at 1.0.0 unless repository conventions say otherwise.
- Add package metadata:
  - title
  - description
  - authors/company placeholder if not known
  - tags
  - license metadata if known
- Keep package size reasonable.
- Do not package tests or fixtures into production package.
- Inspect final package entries after build.

UiPath verification:
If UiPath Studio is available in the environment:
- install the package into a local feed
- verify it appears in Package Manager
- verify activity appears in Activities panel
- create a simple workflow
- run one image OCR
- run one PDF OCR

If UiPath Studio cannot be executed in the environment:
- do not claim Studio verification passed
- verify the package structurally
- document the exact manual Studio verification steps that remain

Plan first, then implement.
```

---

# 36. Phase 8 — Full QA, Hardening and Release Documentation

## Goal

Perform final verification and prepare the project for release.

## Phase 8 Prompt

```text
You are implementing Phase 8, the final QA and release-hardening phase of the Document OCR UiPath custom activity.

FIRST:
- Inspect the entire repository.
- Review every previous phase.
- Review all tests.
- Review package contents.
- Review documentation.
- Produce a concise final QA plan.
- Then execute it.

PHASE 8 GOAL:
Verify the complete solution is production-ready for its defined v1 scope.

Run the full test matrix:

Images:
- PNG clean text
- JPG
- rotated JPG
- low-contrast image
- blank image

PDF:
- one-page scanned PDF
- multi-page scanned PDF
- blank page in PDF
- PDF over maximum page limit

Failures:
- missing file
- unsupported extension
- corrupt image
- corrupt PDF
- oversized file
- missing TessData
- unsupported language

Outputs:
- ExtractedText
- PageCount
- Confidence
- page order

Engineering review:
- no circular project references
- Core contains no UiPath-specific dependencies
- Core contains no Tesseract/PDF/SkiaSharp implementation dependencies
- resources are disposed correctly
- no temporary file leakage
- no document text logging
- no absolute development paths
- no secrets
- no dead code
- no placeholder fake OCR behavior
- nullable warnings reviewed
- compiler warnings reviewed
- package contents reviewed

Performance sanity:
- process a representative multi-page PDF
- observe memory behavior
- ensure pages are not all retained as raw images unnecessarily
- ensure repeated runs do not leak native resources

Documentation:
Update README.md with:
- project purpose
- supported formats
- requirements
- build steps
- package steps
- UiPath installation steps
- usage example
- inputs
- outputs
- limitations
- language-data instructions
- troubleshooting

Also add:
- architecture.md
- usage.md

Final report must clearly separate:
PASS
PARTIAL
NOT TESTED
FAILED

Do not mark anything PASS unless it was actually verified.

If UiPath Studio runtime execution was not available, state that installation/runtime verification remains NOT TESTED rather than PASS.

Plan first, then execute.
```

---

# 37. Phase Dependency Order

The phases must run in order.

```text
Phase 1
Repository / Solution
     │
     ▼
Phase 2
Core contracts / models / validation
     │
     ▼
Phase 3
PDF rendering / image preprocessing
     │
     ▼
Phase 4
Tesseract OCR engine
     │
     ▼
Phase 5
DocumentOcrService
     │
     ▼
Phase 6
UiPath activity
     │
     ▼
Phase 7
Packaging / native dependencies
     │
     ▼
Phase 8
QA / release
```

Do not begin Phase 6 before the OCR service works independently.

Do not call the project finished before Phase 7 and Phase 8 are complete.

---

# 38. Why the UiPath Layer Comes Late

The most reliable development strategy is:

```text
Get OCR working as normal .NET code
           ↓
Test it
           ↓
Then expose it to UiPath
```

Not:

```text
Build everything directly inside UiPath activity
           ↓
Debug OCR + UiPath + native dependencies together
```

Keeping the OCR system independent makes debugging substantially easier.

---

# 39. Recommended Development Sequence During Each Phase

Every phase prompt requires the coding agent to:

```text
Inspect
   ↓
Plan
   ↓
Implement
   ↓
Build
   ↓
Test
   ↓
Fix
   ↓
Report
```

The agent must not:

- modify unrelated code,
- remove existing working behavior without reason,
- claim tests passed when not run,
- skip native dependency validation,
- silently change architecture,
- hide build warnings,
- invent missing requirements.

---

# 40. Quality Rules

## Code Quality

Use:

- clear names,
- small focused methods,
- dependency inversion,
- async where useful,
- cancellation support,
- immutable/read-only models where practical,
- XML docs for public APIs,
- nullable analysis,
- meaningful exceptions.

Avoid:

- giant classes,
- static global mutable state,
- unnecessary service locators,
- unnecessary abstractions,
- reflection hacks,
- swallowing exceptions,
- hidden file system writes.

---

# 41. Logging Rules

Allowed:

```text
OCR started for document
Processing page 2 of 5
OCR completed
Elapsed processing time
```

Avoid logging:

```text
Full extracted text
Customer document content
Raw image bytes
Personally identifiable document contents
```

If logging is added later, it should be opt-in and privacy-conscious.

---

# 42. Example Final User Workflow

```text
Start
  │
  ▼
Assign FilePath
  │
  ▼
Extract Text From Document
  │
  ├── FilePath = invoice.pdf
  ├── Language = eng
  ├── PdfScale = 3
  └── MaximumPages = 50
  │
  ▼
ExtractedText
PageCount
Confidence
  │
  ▼
Use extracted text in next automation step
```

Possible downstream UiPath use cases:

- invoice processing,
- document classification,
- data extraction,
- keyword checks,
- sending text to an API,
- storing text in a database,
- AI summarization,
- CRM automation.

---

# 43. Future Versions

After v1 is stable, possible future phases include:

## v1.1

- Arabic trained data.
- Multi-language OCR.
- Page-specific public results.
- More preprocessing controls.

## v1.2

- Deskew.
- Adaptive thresholding.
- Better low-quality scan preprocessing.
- OCR page selection.

## v2

- Automatic language detection.
- Table detection.
- Structured OCR results.
- Region-based OCR.
- Bounding boxes.
- HOCR / TSV outputs.

## v3

- Optional cloud OCR providers.
- Azure Document Intelligence.
- Google Document AI.
- AWS Textract.
- Local/cloud provider abstraction.

These are outside the initial eight phases.

---

# 44. Definition of Done

Version 1 is considered done when:

```text
Source Code
    ✓

Core OCR Pipeline
    ✓

Image OCR
    ✓

Scanned PDF OCR
    ✓

Error Handling
    ✓

Tests
    ✓

UiPath Activity
    ✓

NuGet Package
    ✓

UiPath Studio Verification
    ✓ or explicitly documented NOT TESTED

Documentation
    ✓
```

A build succeeding alone is not enough.

A NuGet package being produced alone is not enough.

The desired end result is a UiPath activity that is understandable, maintainable, installable, testable, and reliably processes supported documents.

---

# 45. Final Recommended Phase Count

**Total: 8 implementation phases**

```text
1. Repository and solution architecture
2. Core contracts, models and validation
3. PDF rendering and image preprocessing
4. Tesseract OCR engine
5. OCR orchestration service
6. UiPath activity and ViewModel
7. Packaging and native dependency verification
8. Full QA, hardening and release documentation
```

This provides the best balance between:

- development speed,
- separation of responsibilities,
- ease of debugging,
- reliable testing,
- UiPath packaging complexity,
- native dependency risk,
- maintainability.

---

# 46. Starting Point

When development begins, use **Phase 1 Prompt** first.

After Phase 1 is fully completed and verified, use Phase 2.

Continue sequentially until Phase 8.

Do not send all eight prompts to a coding agent at once.

Each phase should be completed, reviewed, built and tested before moving to the next phase.
