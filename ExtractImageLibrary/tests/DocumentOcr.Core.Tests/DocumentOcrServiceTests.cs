using System.Runtime.CompilerServices;
using System.Text;
using DocumentOcr.Core.Abstractions;
using DocumentOcr.Core.Exceptions;
using DocumentOcr.Core.Models;
using DocumentOcr.Core.Services;

namespace DocumentOcr.Core.Tests;

public sealed class DocumentOcrServiceTests
{
    [Fact]
    public void Constructor_RejectsNullDependencies()
    {
        var renderer = new TrackingRenderer(Array.Empty<DocumentPage>());
        var preprocessor = new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "processed")));
        var ocrEngine = new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "ok", 90)));

        Assert.Throws<ArgumentNullException>(() => new DocumentOcrService(null!, preprocessor, ocrEngine));
        Assert.Throws<ArgumentNullException>(() => new DocumentOcrService(renderer, null!, ocrEngine));
        Assert.Throws<ArgumentNullException>(() => new DocumentOcrService(renderer, preprocessor, null!));
    }

    [Fact]
    public async Task ExtractAsync_CancelsBeforeValidation()
    {
        using var cancellationSource = new CancellationTokenSource();
        cancellationSource.Cancel();
        var renderer = new TrackingRenderer(Array.Empty<DocumentPage>());
        var preprocessor = new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "processed")));
        var ocrEngine = new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 80)));
        var service = new DocumentOcrService(renderer, preprocessor, ocrEngine);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.ExtractAsync("ignored.pdf", cancellationToken: cancellationSource.Token));

        Assert.False(renderer.WasCalled);
        Assert.Equal(0, preprocessor.CallCount);
        Assert.Equal(0, ocrEngine.CallCount);
    }

    [Fact]
    public async Task ExtractAsync_UsesDefaultOptionsWhenNullAndForwardsSameInstance()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var imagePath = temporaryDirectory.CreateFile("image.png", new byte[] { 0x89, 0x50, 0x4E, 0x47 });
        OcrOptions? preprocessorOptions = null;
        OcrOptions? ocrOptions = null;

        var service = new DocumentOcrService(
            new TrackingRenderer(Array.Empty<DocumentPage>()),
            new TrackingPreprocessor((page, options, _) =>
            {
                preprocessorOptions = options;
                return Task.FromResult(CreateSeparatePage(page.PageNumber, "processed"));
            }),
            new TrackingOcrEngine((page, options, _) =>
            {
                ocrOptions = options;
                return Task.FromResult(new OcrPageResult(page.PageNumber, "default options", 95));
            }));

        var result = await service.ExtractAsync(imagePath);

        Assert.NotNull(preprocessorOptions);
        Assert.Same(preprocessorOptions, ocrOptions);
        Assert.Equal(new[] { "eng" }, preprocessorOptions!.Languages);
        Assert.Equal(3, preprocessorOptions.PdfScale);
        Assert.Equal(50, preprocessorOptions.MaximumPages);
        Assert.Equal(50, preprocessorOptions.MaximumFileSizeMb);
        Assert.True(preprocessorOptions.EnableAutoRotate);
        Assert.True(preprocessorOptions.EnablePreprocessing);
        Assert.Equal("default options", result.Text);
    }

    [Fact]
    public async Task ExtractAsync_ForwardsExactExplicitOptionsInstanceToAllDependencies()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("document.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        var rawPage = new DocumentPage(1, new TrackingMemoryStream(new byte[] { 0x01 }));
        var renderer = new TrackingRenderer(new[] { rawPage });
        var explicitOptions = new OcrOptions(new[] { "eng", "ara" }, pdfScale: 2, maximumPages: 7, maximumFileSizeMb: 9, enableAutoRotate: false, enablePreprocessing: true);
        OcrOptions? preprocessorOptions = null;
        OcrOptions? ocrOptions = null;
        var service = new DocumentOcrService(
            renderer,
            new TrackingPreprocessor((page, options, _) =>
            {
                preprocessorOptions = options;
                return Task.FromResult(CreateSeparatePage(page.PageNumber, "processed"));
            }),
            new TrackingOcrEngine((page, options, _) =>
            {
                ocrOptions = options;
                return Task.FromResult(new OcrPageResult(page.PageNumber, "forwarded", 92));
            }));

        var result = await service.ExtractAsync(pdfPath, explicitOptions);

        Assert.Same(explicitOptions, renderer.LastOptions);
        Assert.Same(explicitOptions, preprocessorOptions);
        Assert.Same(explicitOptions, ocrOptions);
        Assert.Equal("forwarded", result.Text);
    }

    [Fact]
    public async Task ExtractAsync_ValidationFailuresInvokeNoDependencies()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var missingPath = Path.Combine(temporaryDirectory.Path, "missing.png");
        var renderer = new TrackingRenderer(Array.Empty<DocumentPage>());
        var preprocessor = new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "processed")));
        var ocrEngine = new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 80)));
        var service = new DocumentOcrService(renderer, preprocessor, ocrEngine);

        await Assert.ThrowsAsync<FileNotFoundException>(() => service.ExtractAsync(missingPath));

        Assert.False(renderer.WasCalled);
        Assert.Equal(0, preprocessor.CallCount);
        Assert.Equal(0, ocrEngine.CallCount);
    }

    [Fact]
    public async Task ExtractAsync_ForImage_UsesCanonicalReadOnlyImageFlowAndSkipsRenderer()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var imagePath = temporaryDirectory.CreateFile(Path.Combine("nested", "..", "image.png"), new byte[] { 0x89, 0x50, 0x4E, 0x47 });
        var renderer = new TrackingRenderer(Array.Empty<DocumentPage>());
        var preprocessor = new TrackingPreprocessor((page, _, _) =>
        {
            var fileStream = Assert.IsType<FileStream>(page.ImageStream);
            Assert.Equal(Path.GetFullPath(imagePath), Path.GetFullPath(fileStream.Name));
            Assert.True(fileStream.CanRead);
            Assert.False(fileStream.CanWrite);
            Assert.ThrowsAny<IOException>(() => new FileStream(fileStream.Name, FileMode.Open, FileAccess.Write, FileShare.None));
            return Task.FromResult(CreateSeparatePage(page.PageNumber, "processed"));
        });
        var ocrEngine = new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "  HELLO OCR  \r\n\r\n\r\nWORLD\t \r\n", 91.5)));
        var service = new DocumentOcrService(renderer, preprocessor, ocrEngine);

        var result = await service.ExtractAsync(imagePath);

        Assert.False(renderer.WasCalled);
        Assert.Equal(1, preprocessor.CallCount);
        Assert.Equal(1, ocrEngine.CallCount);
        Assert.Equal("HELLO OCR\n\nWORLD", result.Text);
    }

    [Fact]
    public async Task ExtractAsync_SkipsPreprocessingWhenDisabled()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var imagePath = temporaryDirectory.CreateFile("image.png", new byte[] { 0x89, 0x50, 0x4E, 0x47 });
        var renderer = new TrackingRenderer(Array.Empty<DocumentPage>());
        var preprocessor = new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "unused")));
        var ocrEngine = new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "image", 80)));
        var service = new DocumentOcrService(renderer, preprocessor, ocrEngine);

        var result = await service.ExtractAsync(imagePath, new OcrOptions(enablePreprocessing: false));

        Assert.False(renderer.WasCalled);
        Assert.Equal(0, preprocessor.CallCount);
        Assert.Equal("image", result.Text);
    }

    [Fact]
    public async Task ExtractAsync_ForPdf_ProcessesPagesSequentiallyCleansTextAndDisposesOwnedPages()
    {
        var rawPageOneStream = new TrackingMemoryStream(new byte[] { 0x01 });
        var rawPageTwoStream = new TrackingMemoryStream(new byte[] { 0x02 });
        var rawPageThreeStream = new TrackingMemoryStream(new byte[] { 0x03 });
        var processedPageOneStream = new TrackingMemoryStream(new byte[] { 0x11 });
        var processedPageTwoStream = new TrackingMemoryStream(new byte[] { 0x12 });
        var processedPageThreeStream = new TrackingMemoryStream(new byte[] { 0x13 });

        var renderer = new TrackingRenderer(new[]
        {
            new DocumentPage(1, rawPageOneStream),
            new DocumentPage(2, rawPageTwoStream),
            new DocumentPage(3, rawPageThreeStream),
        });

        var preprocessor = new TrackingPreprocessor((page, _, _) => Task.FromResult(page.PageNumber switch
        {
            1 => new DocumentPage(1, processedPageOneStream),
            2 => new DocumentPage(2, processedPageTwoStream),
            3 => new DocumentPage(3, processedPageThreeStream),
            _ => throw new InvalidOperationException(),
        }));

        var observedOrder = new List<int>();
        var ocrEngine = new TrackingOcrEngine((page, _, _) =>
        {
            observedOrder.Add(page.PageNumber);
            return Task.FromResult(page.PageNumber switch
            {
                1 => new OcrPageResult(1, " First page\t \r\n\r\n\r\nLine two ", 97),
                2 => new OcrPageResult(2, " \r\n\r\n ", 88),
                3 => new OcrPageResult(3, "Third page\rLine three\t \n", 92),
                _ => throw new InvalidOperationException(),
            });
        });

        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("document.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        var service = new DocumentOcrService(renderer, preprocessor, ocrEngine);

        var result = await service.ExtractAsync(pdfPath, new OcrOptions());

        Assert.True(renderer.WasCalled);
        Assert.True(renderer.EnumeratorDisposed);
        Assert.Equal(Path.GetFullPath(pdfPath), renderer.LastFilePath);
        Assert.Equal(new[] { 1, 2, 3 }, observedOrder);
        Assert.Equal("First page\n\nLine two\n\nThird page\nLine three", result.Text);
        Assert.Equal(3, result.PageCount);
        Assert.Equal(new[] { 1, 2, 3 }, result.Pages.Select(page => page.PageNumber).ToArray());
        Assert.Equal("First page\n\nLine two", result.Pages[0].Text);
        Assert.Equal(string.Empty, result.Pages[1].Text);
        Assert.Equal("Third page\nLine three", result.Pages[2].Text);
        Assert.Equal((97d + 88d + 92d) / 3d, result.AverageConfidence);
        Assert.True(rawPageOneStream.IsDisposed);
        Assert.True(rawPageTwoStream.IsDisposed);
        Assert.True(rawPageThreeStream.IsDisposed);
        Assert.True(processedPageOneStream.IsDisposed);
        Assert.True(processedPageTwoStream.IsDisposed);
        Assert.True(processedPageThreeStream.IsDisposed);
    }

    [Fact]
    public async Task ExtractAsync_ForPdf_OrdersPagesByPageNumberBeforeAggregation()
    {
        var renderer = new TrackingRenderer(new[]
        {
            new DocumentPage(3, new TrackingMemoryStream(new byte[] { 0x03 })),
            new DocumentPage(1, new TrackingMemoryStream(new byte[] { 0x01 })),
            new DocumentPage(2, new TrackingMemoryStream(new byte[] { 0x02 })),
        });

        var service = new DocumentOcrService(
            renderer,
            new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, $"processed-{page.PageNumber}"))),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, $"page {page.PageNumber}", 80 + page.PageNumber))));

        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("document.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));

        var result = await service.ExtractAsync(pdfPath);

        Assert.Equal(new[] { 1, 2, 3 }, result.Pages.Select(page => page.PageNumber).ToArray());
        Assert.Equal("page 1\n\npage 2\n\npage 3", result.Text);
    }

    [Fact]
    public async Task ExtractAsync_ForPdf_ReturnsEmptyAggregatedTextWhenAllPagesAreBlank()
    {
        var renderer = new TrackingRenderer(new[]
        {
            new DocumentPage(1, new TrackingMemoryStream(new byte[] { 0x01 })),
            new DocumentPage(2, new TrackingMemoryStream(new byte[] { 0x02 })),
        });

        var service = new DocumentOcrService(
            renderer,
            new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, $"processed-{page.PageNumber}"))),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, " \r\n\t ", 50 + page.PageNumber))));

        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("blank.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));

        var result = await service.ExtractAsync(pdfPath);

        Assert.Equal(string.Empty, result.Text);
        Assert.Equal(2, result.PageCount);
        Assert.Equal(string.Empty, result.Pages[0].Text);
        Assert.Equal(string.Empty, result.Pages[1].Text);
        Assert.Equal((51d + 52d) / 2d, result.AverageConfidence);
    }

    [Fact]
    public async Task ExtractAsync_RejectsPreprocessorReturningOriginalPageInstance()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("document.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        var renderer = new TrackingRenderer(new[] { new DocumentPage(1, new TrackingMemoryStream(new byte[] { 0x01 })) });
        var service = new DocumentOcrService(
            renderer,
            new TrackingPreprocessor((page, _, _) => Task.FromResult(page)),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 90))));

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(() => service.ExtractAsync(pdfPath));

        Assert.Equal("Unable to preprocess document page 1.", exception.Message);
        Assert.IsType<InvalidOperationException>(exception.InnerException);
    }

    [Fact]
    public async Task ExtractAsync_RejectsPreprocessorPageNumberMismatch()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("document.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        var strayProcessedStream = new TrackingMemoryStream(new byte[] { 0x22 });
        var renderer = new TrackingRenderer(new[] { new DocumentPage(1, new TrackingMemoryStream(new byte[] { 0x01 })) });
        var service = new DocumentOcrService(
            renderer,
            new TrackingPreprocessor((page, _, _) => Task.FromResult<DocumentPage>(new DocumentPage(page.PageNumber + 1, strayProcessedStream))),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 90))));

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(() => service.ExtractAsync(pdfPath));

        Assert.Equal("Unable to preprocess document page 1.", exception.Message);
        Assert.IsType<InvalidOperationException>(exception.InnerException);
        Assert.True(strayProcessedStream.IsDisposed);
    }

    [Fact]
    public async Task ExtractAsync_RejectsOcrPageNumberMismatch()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("document.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        var renderer = new TrackingRenderer(new[] { new DocumentPage(1, new TrackingMemoryStream(new byte[] { 0x01 })) });
        var service = new DocumentOcrService(
            renderer,
            new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "processed"))),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber + 1, "wrong page", 90))));

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(() => service.ExtractAsync(pdfPath));

        Assert.Equal("OCR processing failed for page 1.", exception.Message);
        Assert.IsType<InvalidOperationException>(exception.InnerException);
    }

    [Fact]
    public async Task ExtractAsync_RejectsDuplicatePageNumbers()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("document.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        var renderer = new TrackingRenderer(new[]
        {
            new DocumentPage(1, new TrackingMemoryStream(new byte[] { 0x01 })),
            new DocumentPage(1, new TrackingMemoryStream(new byte[] { 0x02 })),
        });
        var service = new DocumentOcrService(
            renderer,
            new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, $"processed-{page.PageNumber}"))),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, $"page-{page.PageNumber}", 75))));

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(() => service.ExtractAsync(pdfPath));

        Assert.Contains("duplicate OCR page number 1", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ExtractAsync_WrapsUnexpectedPreprocessorArgumentException()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("document.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        var argumentException = new ArgumentException("provider validation failed", "languages");
        var service = new DocumentOcrService(
            new TrackingRenderer(new[] { new DocumentPage(1, new TrackingMemoryStream(new byte[] { 0x01 })) }),
            new ThrowingPreprocessor(argumentException),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 90))));

        var wrappedArgument = await Assert.ThrowsAsync<OcrProcessingException>(() => service.ExtractAsync(pdfPath));
        Assert.Equal("Unable to preprocess document page 1.", wrappedArgument.Message);
        Assert.Same(argumentException, wrappedArgument.InnerException);
    }

    [Fact]
    public async Task ExtractAsync_PreservesRendererDomainExceptions()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("document.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        var pageLimitException = new DocumentPageLimitExceededException(5, 4);
        var pageLimitService = new DocumentOcrService(
            new ThrowingRenderer(pageLimitException),
            new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "unused"))),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 90))));

        var preservedPageLimit = await Assert.ThrowsAsync<DocumentPageLimitExceededException>(() => pageLimitService.ExtractAsync(pdfPath));
        Assert.Same(pageLimitException, preservedPageLimit);
    }

    [Fact]
    public async Task ExtractAsync_PreservesProviderArgumentExceptionFromOcrEngine()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var imagePath = temporaryDirectory.CreateFile("image.png", new byte[] { 0x89, 0x50, 0x4E, 0x47 });
        var argumentException = new ArgumentException("unsupported language", "languages");
        var service = new DocumentOcrService(
            new TrackingRenderer(Array.Empty<DocumentPage>()),
            new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "processed"))),
            new ThrowingOcrEngine(argumentException));

        var preservedArgument = await Assert.ThrowsAsync<ArgumentException>(() => service.ExtractAsync(imagePath));
        Assert.Same(argumentException, preservedArgument);
    }

    [Fact]
    public async Task ExtractAsync_WrapsUnexpectedPreprocessorAndOcrFailuresWithExactMessages()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("document.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        var preprocessFailure = new InvalidOperationException("preprocessor bug");
        var preprocessService = new DocumentOcrService(
            new TrackingRenderer(new[] { new DocumentPage(1, new TrackingMemoryStream(new byte[] { 0x01 })) }),
            new ThrowingPreprocessor(preprocessFailure),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 90))));

        var preprocessException = await Assert.ThrowsAsync<OcrProcessingException>(() => preprocessService.ExtractAsync(pdfPath));
        Assert.Equal("Unable to preprocess document page 1.", preprocessException.Message);
        Assert.Same(preprocessFailure, preprocessException.InnerException);

        var imagePath = temporaryDirectory.CreateFile("image.png", new byte[] { 0x89, 0x50, 0x4E, 0x47 });
        var ocrFailure = new InvalidOperationException("ocr bug");
        var ocrService = new DocumentOcrService(
            new TrackingRenderer(Array.Empty<DocumentPage>()),
            new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "processed"))),
            new ThrowingOcrEngine(ocrFailure));

        var ocrException = await Assert.ThrowsAsync<OcrProcessingException>(() => ocrService.ExtractAsync(imagePath));
        Assert.Equal("OCR processing failed for page 1.", ocrException.Message);
        Assert.Same(ocrFailure, ocrException.InnerException);
    }

    [Fact]
    public async Task ExtractAsync_WrapsUnexpectedRendererFailuresWithCanonicalPdfPath()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("wrapped.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        var rendererFailure = new ArgumentException("renderer bug", "dpi");
        var service = new DocumentOcrService(
            new ThrowingRenderer(rendererFailure),
            new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "unused"))),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 90))));

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(() => service.ExtractAsync(pdfPath));

        Assert.Equal($"Unable to render PDF '{Path.GetFullPath(pdfPath)}'.", exception.Message);
        Assert.Same(rendererFailure, exception.InnerException);
    }

    [Fact]
    public async Task ExtractAsync_PreservesRendererPassThroughExceptions()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("renderer-pass-through.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        var existingProcessingException = new OcrProcessingException("existing renderer failure");

        var canceledService = new DocumentOcrService(
            new ThrowingRenderer(new OperationCanceledException("renderer canceled")),
            new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "unused"))),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 90))));
        var passthroughProcessingService = new DocumentOcrService(
            new ThrowingRenderer(existingProcessingException),
            new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "unused"))),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 90))));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => canceledService.ExtractAsync(pdfPath));
        var preservedProcessing = await Assert.ThrowsAsync<OcrProcessingException>(() => passthroughProcessingService.ExtractAsync(pdfPath));
        Assert.Same(existingProcessingException, preservedProcessing);
    }

    [Fact]
    public async Task ExtractAsync_WrapsUnexpectedImageOpenFailures()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var imagePath = temporaryDirectory.CreateFile("locked.png", new byte[] { 0x89, 0x50, 0x4E, 0x47 });
        using var fileLock = new FileStream(imagePath, FileMode.Open, FileAccess.Read, FileShare.None);
        var service = new DocumentOcrService(
            new TrackingRenderer(Array.Empty<DocumentPage>()),
            new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "processed"))),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 90))));

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(() => service.ExtractAsync(imagePath, new OcrOptions(enablePreprocessing: false)));

        Assert.Equal($"Unable to open image document '{Path.GetFullPath(imagePath)}'.", exception.Message);
        Assert.NotNull(exception.InnerException);
    }

    [Fact]
    public async Task ExtractAsync_StopsAfterFirstFailedPageAndDisposesEnumerator()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("document.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        var firstRaw = new TrackingMemoryStream(new byte[] { 0x01 });
        var secondRaw = new TrackingMemoryStream(new byte[] { 0x02 });
        var renderer = new TrackingRenderer(new[]
        {
            new DocumentPage(1, firstRaw),
            new DocumentPage(2, secondRaw),
        });
        var ocrFailure = new InvalidOperationException("ocr bug");
        var preprocessor = new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, $"processed-{page.PageNumber}")));
        var ocr = new TrackingOcrEngine((page, _, _) =>
        {
            if (page.PageNumber == 1)
            {
                throw ocrFailure;
            }

            return Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 90));
        });
        var service = new DocumentOcrService(renderer, preprocessor, ocr);

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(() => service.ExtractAsync(pdfPath));

        Assert.Equal("OCR processing failed for page 1.", exception.Message);
        Assert.True(renderer.EnumeratorDisposed);
        Assert.Equal(new[] { 1 }, preprocessor.ProcessedPageNumbers);
        Assert.Equal(new[] { 1 }, ocr.ProcessedPageNumbers);
        Assert.True(firstRaw.IsDisposed);
        Assert.False(secondRaw.IsDisposed);
    }

    [Fact]
    public async Task ExtractAsync_CancelsImmediatelyAfterPdfPageIsYieldedAndDisposesRawPage()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("cancel-after-yield.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        using var cancellationSource = new CancellationTokenSource();
        var rawPageStream = new TrackingMemoryStream(new byte[] { 0x01 });
        var renderer = new TrackingRenderer(
            new[] { new DocumentPage(1, rawPageStream) },
            onBeforeYield: _ => cancellationSource.Cancel());
        var preprocessor = new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "processed")));
        var ocr = new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 90)));
        var service = new DocumentOcrService(renderer, preprocessor, ocr);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.ExtractAsync(pdfPath, cancellationToken: cancellationSource.Token));

        Assert.True(renderer.EnumeratorDisposed);
        Assert.True(rawPageStream.IsDisposed);
        Assert.Equal(0, preprocessor.CallCount);
        Assert.Equal(0, ocr.CallCount);
    }

    [Fact]
    public async Task ExtractAsync_CancelsBetweenPreprocessAndOcrAndDisposesPages()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var imagePath = temporaryDirectory.CreateFile("image.png", new byte[] { 0x89, 0x50, 0x4E, 0x47 });
        using var cancellationSource = new CancellationTokenSource();
        TrackingMemoryStream? processedStream = null;
        var service = new DocumentOcrService(
            new TrackingRenderer(Array.Empty<DocumentPage>()),
            new TrackingPreprocessor((page, _, _) =>
            {
                processedStream = new TrackingMemoryStream(new byte[] { 0xAA });
                cancellationSource.Cancel();
                return Task.FromResult<DocumentPage>(new DocumentPage(page.PageNumber, processedStream));
            }),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "unused", 90))));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.ExtractAsync(imagePath, cancellationToken: cancellationSource.Token));

        Assert.NotNull(processedStream);
        Assert.True(processedStream!.IsDisposed);
    }

    [Fact]
    public async Task ExtractAsync_CancelsBetweenPagesWithoutProcessingFurtherPages()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CreateFile("document.pdf", Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF"));
        using var cancellationSource = new CancellationTokenSource();
        var renderer = new TrackingRenderer(new[]
        {
            new DocumentPage(1, new TrackingMemoryStream(new byte[] { 0x01 })),
            new DocumentPage(2, new TrackingMemoryStream(new byte[] { 0x02 })),
        });
        var preprocessor = new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, $"processed-{page.PageNumber}")));
        var ocr = new TrackingOcrEngine((page, _, _) =>
        {
            if (page.PageNumber == 1)
            {
                cancellationSource.Cancel();
            }

            return Task.FromResult(new OcrPageResult(page.PageNumber, $"page {page.PageNumber}", 90));
        });
        var service = new DocumentOcrService(renderer, preprocessor, ocr);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.ExtractAsync(pdfPath, cancellationToken: cancellationSource.Token));

        Assert.True(renderer.EnumeratorDisposed);
        Assert.Equal(new[] { 1 }, preprocessor.ProcessedPageNumbers);
        Assert.Equal(new[] { 1 }, ocr.ProcessedPageNumbers);
    }

    [Fact]
    public async Task ExtractAsync_ReleasesImageFileLockAfterSuccess()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var imagePath = temporaryDirectory.CreateFile("image.png", new byte[] { 0x89, 0x50, 0x4E, 0x47 });
        var service = new DocumentOcrService(
            new TrackingRenderer(Array.Empty<DocumentPage>()),
            new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "processed"))),
            new TrackingOcrEngine((page, _, _) => Task.FromResult(new OcrPageResult(page.PageNumber, "success", 90))));

        await service.ExtractAsync(imagePath);

        File.Delete(imagePath);
        Assert.False(File.Exists(imagePath));
    }

    [Fact]
    public async Task ExtractAsync_ReleasesImageFileLockAfterFailureAndReturnsNoPartialResult()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var imagePath = temporaryDirectory.CreateFile("image.png", new byte[] { 0x89, 0x50, 0x4E, 0x47 });
        var service = new DocumentOcrService(
            new TrackingRenderer(Array.Empty<DocumentPage>()),
            new TrackingPreprocessor((page, _, _) => Task.FromResult(CreateSeparatePage(page.PageNumber, "processed"))),
            new ThrowingOcrEngine(new InvalidOperationException("ocr bug")));

        await Assert.ThrowsAsync<OcrProcessingException>(() => service.ExtractAsync(imagePath));

        File.Delete(imagePath);
        Assert.False(File.Exists(imagePath));
    }

    private static DocumentPage CreateSeparatePage(int pageNumber, string contents)
    {
        return new DocumentPage(pageNumber, new TrackingMemoryStream(Encoding.UTF8.GetBytes(contents)));
    }

    private sealed class TrackingRenderer : IDocumentPageRenderer
    {
        private readonly IReadOnlyList<DocumentPage> _pages;

        private readonly Action<DocumentPage>? _onBeforeYield;

        public TrackingRenderer(IReadOnlyList<DocumentPage> pages, Action<DocumentPage>? onBeforeYield = null)
        {
            _pages = pages;
            _onBeforeYield = onBeforeYield;
        }

        public bool WasCalled { get; private set; }

        public bool EnumeratorDisposed { get; private set; }

        public string? LastFilePath { get; private set; }

        public OcrOptions? LastOptions { get; private set; }

        public async IAsyncEnumerable<DocumentPage> RenderAsync(string filePath, OcrOptions options, [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            WasCalled = true;
            LastFilePath = filePath;
            LastOptions = options;

            try
            {
                foreach (var page in _pages)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    await Task.Yield();
                    _onBeforeYield?.Invoke(page);
                    yield return page;
                }
            }
            finally
            {
                EnumeratorDisposed = true;
            }
        }
    }

    private sealed class ThrowingRenderer : IDocumentPageRenderer
    {
        private readonly Exception _exception;

        public ThrowingRenderer(Exception exception)
        {
            _exception = exception;
        }

        public async IAsyncEnumerable<DocumentPage> RenderAsync(string filePath, OcrOptions options, [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            await Task.Yield();

            if (Environment.TickCount == int.MinValue)
            {
                yield return null!;
            }

            throw _exception;
        }
    }

    private sealed class TrackingPreprocessor : IImagePreprocessor
    {
        private readonly Func<DocumentPage, OcrOptions, CancellationToken, Task<DocumentPage>> _callback;

        public TrackingPreprocessor(Func<DocumentPage, OcrOptions, CancellationToken, Task<DocumentPage>> callback)
        {
            _callback = callback;
        }

        public int CallCount { get; private set; }

        public List<int> ProcessedPageNumbers { get; } = new();

        public Task<DocumentPage> ProcessAsync(DocumentPage documentPage, OcrOptions options, CancellationToken cancellationToken)
        {
            CallCount++;
            ProcessedPageNumbers.Add(documentPage.PageNumber);
            return _callback(documentPage, options, cancellationToken);
        }
    }

    private sealed class ThrowingPreprocessor : IImagePreprocessor
    {
        private readonly Exception _exception;

        public ThrowingPreprocessor(Exception exception)
        {
            _exception = exception;
        }

        public Task<DocumentPage> ProcessAsync(DocumentPage documentPage, OcrOptions options, CancellationToken cancellationToken)
        {
            throw _exception;
        }
    }

    private sealed class TrackingOcrEngine : IOcrEngine
    {
        private readonly Func<DocumentPage, OcrOptions, CancellationToken, Task<OcrPageResult>> _callback;

        public TrackingOcrEngine(Func<DocumentPage, OcrOptions, CancellationToken, Task<OcrPageResult>> callback)
        {
            _callback = callback;
        }

        public int CallCount { get; private set; }

        public List<int> ProcessedPageNumbers { get; } = new();

        public Task<OcrPageResult> RecognizeAsync(DocumentPage documentPage, OcrOptions options, CancellationToken cancellationToken)
        {
            CallCount++;
            ProcessedPageNumbers.Add(documentPage.PageNumber);
            return _callback(documentPage, options, cancellationToken);
        }
    }

    private sealed class ThrowingOcrEngine : IOcrEngine
    {
        private readonly Exception _exception;

        public ThrowingOcrEngine(Exception exception)
        {
            _exception = exception;
        }

        public Task<OcrPageResult> RecognizeAsync(DocumentPage documentPage, OcrOptions options, CancellationToken cancellationToken)
        {
            throw _exception;
        }
    }

    private sealed class TrackingMemoryStream : MemoryStream
    {
        public TrackingMemoryStream(byte[] buffer)
            : base(buffer, writable: true)
        {
        }

        public bool IsDisposed { get; private set; }

        protected override void Dispose(bool disposing)
        {
            IsDisposed = true;
            base.Dispose(disposing);
        }

        public override ValueTask DisposeAsync()
        {
            IsDisposed = true;
            return base.DisposeAsync();
        }
    }
}
