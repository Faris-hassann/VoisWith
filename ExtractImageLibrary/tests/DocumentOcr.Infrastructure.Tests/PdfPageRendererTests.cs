using DocumentOcr.Core.Exceptions;
using DocumentOcr.Core.Models;
using DocumentOcr.Infrastructure.Pdf;
using SkiaSharp;

namespace DocumentOcr.Infrastructure.Tests;

public sealed class PdfPageRendererTests
{
    [Fact]
    public async Task RenderAsync_RendersSinglePagePdfAsPngStreamAtPositionZero()
    {
        var renderer = new PdfPageRenderer();

        var pages = await CollectPagesAsync(renderer.RenderAsync(FixturePaths.OnePagePdf, new OcrOptions(), CancellationToken.None));

        try
        {
            var page = Assert.Single(pages);
            Assert.Equal(1, page.PageNumber);
            Assert.Equal(0, page.ImageStream.Position);

            var bytes = ReadAllBytes(page.ImageStream);
            Assert.Equal(0x89, bytes[0]);
            Assert.Equal(0x50, bytes[1]);
            Assert.Equal(0x4E, bytes[2]);
            Assert.Equal(0x47, bytes[3]);

            using var bitmap = DecodeBitmap(bytes);
            Assert.NotNull(bitmap);
            Assert.True(bitmap.Width > 0);
            Assert.True(bitmap.Height > 0);
        }
        finally
        {
            await DisposePagesAsync(pages);
        }
    }

    [Fact]
    public async Task RenderAsync_RendersMultiplePagesInOrder()
    {
        var renderer = new PdfPageRenderer();

        var pages = await CollectPagesAsync(renderer.RenderAsync(FixturePaths.MultiPagePdf, new OcrOptions(), CancellationToken.None));

        try
        {
            Assert.Equal(new[] { 1, 2, 3 }, pages.Select(page => page.PageNumber).ToArray());

            foreach (var page in pages)
            {
                using var bitmap = DecodeBitmap(ReadAllBytes(page.ImageStream));
                Assert.NotNull(bitmap);
            }
        }
        finally
        {
            await DisposePagesAsync(pages);
        }
    }

    [Fact]
    public async Task RenderAsync_ThrowsPageLimitBeforeYieldingAnyPages()
    {
        var renderer = new PdfPageRenderer();
        var pages = renderer.RenderAsync(FixturePaths.MultiPagePdf, new OcrOptions(maximumPages: 2), CancellationToken.None);

        await using var enumerator = pages.GetAsyncEnumerator();

        var exception = await Assert.ThrowsAsync<DocumentPageLimitExceededException>(
            async () => await enumerator.MoveNextAsync().AsTask());

        Assert.Equal(3, exception.ObservedPageCount);
        Assert.Equal(2, exception.MaximumPageCount);
    }

    [Fact]
    public async Task RenderAsync_AllowsPageCountEqualToMaximum()
    {
        var renderer = new PdfPageRenderer();

        var pages = await CollectPagesAsync(renderer.RenderAsync(FixturePaths.MultiPagePdf, new OcrOptions(maximumPages: 3), CancellationToken.None));

        try
        {
            Assert.Equal(3, pages.Count);
        }
        finally
        {
            await DisposePagesAsync(pages);
        }
    }

    [Theory]
    [InlineData(nameof(FixturePaths.CorruptPdf), "Unable to render PDF")]
    [InlineData(nameof(FixturePaths.TruncatedPdf), "Unable to render PDF")]
    public async Task RenderAsync_WrapsPdfRenderingFailuresWithContext(string fixtureName, string expectedMessagePrefix)
    {
        var renderer = new PdfPageRenderer();
        var pdfPath = GetFixturePdfPath(fixtureName);

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(async () =>
        {
            await foreach (var page in renderer.RenderAsync(pdfPath, new OcrOptions(), CancellationToken.None))
            {
                await page.DisposeAsync();
            }
        });

        Assert.Contains(expectedMessagePrefix, exception.Message);
        Assert.Contains(Path.GetFullPath(pdfPath), exception.Message);
        Assert.NotNull(exception.InnerException);
    }

    [Fact]
    public async Task RenderAsync_WrapsUnreadablePdfFailuresWithContext()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var lockedPdfPath = temporaryDirectory.CopyFile(FixturePaths.OnePagePdf, "locked.pdf");
        using var fileLock = new FileStream(lockedPdfPath, FileMode.Open, FileAccess.Read, FileShare.None);
        var renderer = new PdfPageRenderer();

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(async () =>
        {
            await foreach (var page in renderer.RenderAsync(lockedPdfPath, new OcrOptions(), CancellationToken.None))
            {
                await page.DisposeAsync();
            }
        });

        Assert.Equal($"Unable to render PDF '{Path.GetFullPath(lockedPdfPath)}'.", exception.Message);
        Assert.NotNull(exception.InnerException);
    }

    [Fact]
    public async Task RenderAsync_HonorsPdfScaleInRenderedDimensions()
    {
        var renderer = new PdfPageRenderer();
        var scaleOnePages = await CollectPagesAsync(renderer.RenderAsync(FixturePaths.OnePagePdf, new OcrOptions(pdfScale: 1), CancellationToken.None));
        var scaleTwoPages = await CollectPagesAsync(renderer.RenderAsync(FixturePaths.OnePagePdf, new OcrOptions(pdfScale: 2), CancellationToken.None));

        try
        {
            using var scaleOneBitmap = DecodeBitmap(ReadAllBytes(scaleOnePages[0].ImageStream));
            using var scaleTwoBitmap = DecodeBitmap(ReadAllBytes(scaleTwoPages[0].ImageStream));

            Assert.Equal(scaleOneBitmap.Width * 2, scaleTwoBitmap.Width);
            Assert.Equal(scaleOneBitmap.Height * 2, scaleTwoBitmap.Height);
        }
        finally
        {
            await DisposePagesAsync(scaleOnePages);
            await DisposePagesAsync(scaleTwoPages);
        }
    }

    [Fact]
    public async Task RenderAsync_HonorsPreCanceledToken()
    {
        var renderer = new PdfPageRenderer();
        using var cancellationSource = new CancellationTokenSource();
        cancellationSource.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
        {
            await foreach (var page in renderer.RenderAsync(FixturePaths.OnePagePdf, new OcrOptions(), cancellationSource.Token))
            {
                await page.DisposeAsync();
            }
        });
    }

    [Fact]
    public async Task RenderAsync_CancelsBeforeRenderingNextPage()
    {
        var renderer = new PdfPageRenderer();
        using var cancellationSource = new CancellationTokenSource();
        await using var enumerator = renderer
            .RenderAsync(FixturePaths.MultiPagePdf, new OcrOptions(), cancellationSource.Token)
            .GetAsyncEnumerator();

        Assert.True(await enumerator.MoveNextAsync());
        await using var firstPage = enumerator.Current;

        cancellationSource.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            async () => await enumerator.MoveNextAsync().AsTask());
    }

    [Fact]
    public async Task RenderAsync_ReleasesFileLockAfterEarlyEnumerationDisposal()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CopyFile(FixturePaths.MultiPagePdf, "early-dispose.pdf");
        var renderer = new PdfPageRenderer();

        await using (var enumerator = renderer.RenderAsync(pdfPath, new OcrOptions(), CancellationToken.None).GetAsyncEnumerator())
        {
            Assert.True(await enumerator.MoveNextAsync());
            await using var firstPage = enumerator.Current;
        }

        File.Delete(pdfPath);

        Assert.False(File.Exists(pdfPath));
    }

    [Fact]
    public async Task RenderAsync_ReleasesFileLockAfterFullEnumeration()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var pdfPath = temporaryDirectory.CopyFile(FixturePaths.MultiPagePdf, "full-enumeration.pdf");
        var renderer = new PdfPageRenderer();

        await foreach (var page in renderer.RenderAsync(pdfPath, new OcrOptions(), CancellationToken.None))
        {
            await page.DisposeAsync();
        }

        File.Delete(pdfPath);

        Assert.False(File.Exists(pdfPath));
    }

    private static string GetFixturePdfPath(string fixtureName) =>
        fixtureName switch
        {
            nameof(FixturePaths.CorruptPdf) => FixturePaths.CorruptPdf,
            nameof(FixturePaths.TruncatedPdf) => FixturePaths.TruncatedPdf,
            _ => throw new ArgumentOutOfRangeException(nameof(fixtureName)),
        };

    private static async Task<List<DocumentPage>> CollectPagesAsync(IAsyncEnumerable<DocumentPage> pages)
    {
        var results = new List<DocumentPage>();

        await foreach (var page in pages)
        {
            results.Add(page);
        }

        return results;
    }

    private static async Task DisposePagesAsync(IEnumerable<DocumentPage> pages)
    {
        foreach (var page in pages)
        {
            await page.DisposeAsync();
        }
    }

    private static byte[] ReadAllBytes(Stream stream)
    {
        if (stream.CanSeek)
        {
            stream.Position = 0;
        }

        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);

        if (stream.CanSeek)
        {
            stream.Position = 0;
        }

        return buffer.ToArray();
    }

    private static SKBitmap DecodeBitmap(byte[] bytes) =>
        SKBitmap.Decode(bytes) ?? throw new InvalidOperationException("Expected a decodable bitmap.");
}
