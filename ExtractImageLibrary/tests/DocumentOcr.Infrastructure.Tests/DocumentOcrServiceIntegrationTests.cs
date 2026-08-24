using System.Text.RegularExpressions;
using DocumentOcr.Core.Models;
using DocumentOcr.Core.Services;
using DocumentOcr.Infrastructure.Imaging;
using DocumentOcr.Infrastructure.Ocr;
using DocumentOcr.Infrastructure.Pdf;

namespace DocumentOcr.Infrastructure.Tests;

public sealed class DocumentOcrServiceIntegrationTests
{
    [Fact]
    public async Task ExtractAsync_RecognizesExistingHelloImageWithRealPipeline()
    {
        using var engine = new TesseractOcrEngine();
        var service = new DocumentOcrService(new PdfPageRenderer(), new ImagePreprocessor(), engine);

        var result = await service.ExtractAsync(FixturePaths.OcrHelloPng);

        Assert.Equal(1, result.PageCount);
        Assert.Equal(1, result.Pages[0].PageNumber);
        Assert.Equal("HELLO OCR 123", NormalizeForAssertion(result.Text));
        Assert.Equal("HELLO OCR 123", NormalizeForAssertion(result.Pages[0].Text));
        Assert.InRange(result.AverageConfidence, 0d, 100d);
    }

    [Fact]
    public async Task ExtractAsync_IsRepeatableForImagePipeline()
    {
        using var engine = new TesseractOcrEngine();
        var service = new DocumentOcrService(new PdfPageRenderer(), new ImagePreprocessor(), engine);

        var firstResult = await service.ExtractAsync(FixturePaths.OcrHelloPng);
        var secondResult = await service.ExtractAsync(FixturePaths.OcrHelloPng);

        Assert.Equal("HELLO OCR 123", NormalizeForAssertion(firstResult.Text));
        Assert.Equal("HELLO OCR 123", NormalizeForAssertion(secondResult.Text));
        Assert.Equal(firstResult.PageCount, secondResult.PageCount);
    }

    [Fact]
    public async Task ExtractAsync_RecognizesTwoPageRasterPdfWithRealPipeline()
    {
        using var engine = new TesseractOcrEngine();
        var service = new DocumentOcrService(new PdfPageRenderer(), new ImagePreprocessor(), engine);

        var result = await service.ExtractAsync(FixturePaths.TwoPageRasterOcrPdf);

        Assert.Equal(2, result.PageCount);
        Assert.Equal(new[] { 1, 2 }, result.Pages.Select(page => page.PageNumber).ToArray());
        Assert.Equal("PHASE FIVE PAGE ONE", NormalizeForAssertion(result.Pages[0].Text));
        Assert.Equal("PHASE FIVE PAGE TWO", NormalizeForAssertion(result.Pages[1].Text));
        Assert.Equal("PHASE FIVE PAGE ONE\n\nPHASE FIVE PAGE TWO", result.Text);
        Assert.InRange(result.AverageConfidence, 0d, 100d);
    }

    [Fact]
    public async Task ExtractAsync_IsRepeatableForPdfPipeline()
    {
        using var engine = new TesseractOcrEngine();
        var service = new DocumentOcrService(new PdfPageRenderer(), new ImagePreprocessor(), engine);

        var firstResult = await service.ExtractAsync(FixturePaths.TwoPageRasterOcrPdf);
        var secondResult = await service.ExtractAsync(FixturePaths.TwoPageRasterOcrPdf);

        Assert.Equal("PHASE FIVE PAGE ONE\n\nPHASE FIVE PAGE TWO", firstResult.Text);
        Assert.Equal(firstResult.Text, secondResult.Text);
        Assert.Equal(new[] { 1, 2 }, secondResult.Pages.Select(page => page.PageNumber).ToArray());
    }

    [Fact]
    public async Task ExtractAsync_ReleasesImageFileLockAfterProcessing()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var copiedImagePath = temporaryDirectory.CopyFile(FixturePaths.OcrHelloPng, "locked-image.png");
        using var engine = new TesseractOcrEngine();
        var service = new DocumentOcrService(new PdfPageRenderer(), new ImagePreprocessor(), engine);

        var result = await service.ExtractAsync(copiedImagePath);

        Assert.Equal("HELLO OCR 123", NormalizeForAssertion(result.Text));
        File.Delete(copiedImagePath);
        Assert.False(File.Exists(copiedImagePath));
    }

    [Fact]
    public async Task ExtractAsync_ReleasesPdfFileLockAfterProcessing()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var copiedPdfPath = temporaryDirectory.CopyFile(FixturePaths.TwoPageRasterOcrPdf, "locked-pdf.pdf");
        using var engine = new TesseractOcrEngine();
        var service = new DocumentOcrService(new PdfPageRenderer(), new ImagePreprocessor(), engine);

        var result = await service.ExtractAsync(copiedPdfPath);

        Assert.Equal("PHASE FIVE PAGE ONE\n\nPHASE FIVE PAGE TWO", result.Text);
        File.Delete(copiedPdfPath);
        Assert.False(File.Exists(copiedPdfPath));
    }

    [Fact]
    public async Task ExtractAsync_DoesNotOwnSuppliedTesseractEngine()
    {
        using var engine = new TesseractOcrEngine();
        var service = new DocumentOcrService(new PdfPageRenderer(), new ImagePreprocessor(), engine);

        var serviceResult = await service.ExtractAsync(FixturePaths.OcrHelloPng);
        Assert.Equal("HELLO OCR 123", NormalizeForAssertion(serviceResult.Text));

        await using var page = new DocumentPage(1, new MemoryStream(File.ReadAllBytes(FixturePaths.OcrHelloPng)));
        var directResult = await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng" }), CancellationToken.None);
        Assert.Equal("HELLO OCR 123", NormalizeForAssertion(directResult.Text));

        engine.Dispose();

        await using var disposedPage = new DocumentPage(1, new MemoryStream(File.ReadAllBytes(FixturePaths.OcrHelloPng)));
        await Assert.ThrowsAsync<ObjectDisposedException>(
            async () => await engine.RecognizeAsync(disposedPage, new OcrOptions(new[] { "eng" }), CancellationToken.None));
    }
    private static string NormalizeForAssertion(string value)
    {
        return Regex.Replace(value.ToUpperInvariant(), @"\s+", " ").Trim();
    }
}
